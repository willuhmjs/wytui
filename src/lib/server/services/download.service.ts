import { prisma } from '../db';
import { ytdlpService } from './ytdlp.service';
import { queueService } from './queue.service';
import { sseEmitter } from '../sse/emitter';
import { DownloadStatus } from '@prisma/client';
import type { ChildProcess } from 'child_process';
import type { Download } from '$lib/types';
import { unlink, stat, readdir } from 'fs/promises';
import { dirname, basename, extname, join } from 'path';
import { libraryService } from './library.service';
import { channelOverrideService } from './channel-override.service';
import { notificationService } from './notification.service';
import { subtitleService } from './subtitle.service';
import { extractVideoId } from '$lib/utils/youtube';
import { libraryAccessStatus, type LibraryAccess } from '$lib/server/permissions';
import { ffmpegPercent } from './download-progress';

/**
 * Thrown when a download is deliberately abandoned before any bytes are
 * fetched (excluded short, upcoming premiere). The record is already cleaned
 * up by the thrower; callers must not retry or mark it failed.
 */
class DownloadSkippedError extends Error {
	constructor(reason: string) {
		super(reason);
		this.name = 'DownloadSkippedError';
	}
}

/**
 * Serialize download object for JSON responses
 * Converts BigInt fields to strings
 */
function serializeDownload(download: any): any {
	return {
		...download,
		filesize: download.filesize?.toString() || null,
		downloadedBytes: download.downloadedBytes?.toString() || null,
		totalBytes: download.totalBytes?.toString() || null,
	};
}

/** Map yt-dlp post-processing module names to task types */
const MODULE_TO_TASK_TYPE: Record<string, string> = {
	SponsorBlock: 'sponsorblock',
	ModifyChapters: 'sponsorblock',
	Merger: 'merge',
	Metadata: 'metadata',
	EmbedSubtitle: 'subtitle',
	EmbedThumbnail: 'thumbnail',
	ExtractAudio: 'convert',
	FFmpegVideoConvertor: 'convert',
	FFmpegMetadata: 'metadata',
	ThumbnailsConvertor: 'thumbnail',
	FixupM3u8: 'merge',
	FixupDuplicateMoov: 'merge',
	FixupStretchedRatio: 'merge',
};

class DownloadService {
	// Track active download processes
	private activeProcesses = new Map<string, ChildProcess>();

	// Last time we saw progress/output from a download's process (for stall detection)
	private lastActivity = new Map<string, number>();

	// Track download ownership for SSE filtering
	private downloadOwners = new Map<string, string>();

	// Debounce DB updates (max 1 update per second per download)
	private updateDebounce = new Map<string, NodeJS.Timeout>();

	// Track retry timeouts so we can cancel them
	private retryTimeouts = new Map<string, NodeJS.Timeout>();

	// Guard against multiple error handler invocations per download
	private handlingError = new Set<string>();

	// Downloads the user has cancelled. Marked synchronously at the start of
	// cancelDownload so the process `close` handler and handleDownloadError can
	// tell a deliberate kill (yt-dlp exits with code null on SIGTERM) apart from a
	// real failure — otherwise the close event races the async CANCELLED write and
	// schedules a retry that respawns the process.
	private cancelledDownloads = new Set<string>();

	// Track which tasks have been created for a download
	private downloadTaskIds = new Map<string, Map<string, string>>();

	// Track the last post-processing module name for ffmpeg progress mapping
	private lastPostProcessModule = new Map<string, string>();

	// Last fatal "ERROR:" line emitted by yt-dlp on stderr, used to enrich the
	// failure message. Individual stderr lines are NOT treated as fatal — only a
	// non-zero exit code fails the download (see executeDownload).
	private lastErrorLine = new Map<string, string>();

	/** Drop all per-download bookkeeping for a finished/cancelled download. */
	private clearDownloadState(downloadId: string): void {
		// Cancel any pending debounced progress write so it can't overwrite a
		// completed/failed/cancelled record's fields a second later.
		this.clearProgressDebounce(downloadId);
		this.processingSteps.delete(downloadId);
		this.downloadDurations.delete(downloadId);
		this.downloadTaskIds.delete(downloadId);
		this.lastPostProcessModule.delete(downloadId);
		this.lastErrorLine.delete(downloadId);
		this.lastActivity.delete(downloadId);
	}

	/** Cancel and forget any pending debounced progress write for a download. */
	private clearProgressDebounce(downloadId: string): void {
		const debounceTimeout = this.updateDebounce.get(downloadId);
		if (debounceTimeout) {
			clearTimeout(debounceTimeout);
			this.updateDebounce.delete(downloadId);
		}
	}

	private emitToOwner(event: string, data: any, downloadId: string): void {
		const userId = this.downloadOwners.get(downloadId);
		if (userId) {
			sseEmitter.broadcastToUser(event, data, userId);
		} else {
			sseEmitter.broadcast(event, data);
		}
	}

	/**
	 * Remove a download record that was deliberately abandoned before any bytes
	 * were fetched (excluded short, upcoming premiere). The UI lists don't show
	 * cancelled rows, so deleting keeps the table clean; child rows cascade.
	 */
	private async discardDownloadRecord(downloadId: string): Promise<void> {
		this.clearDownloadState(downloadId);
		await prisma.download.delete({ where: { id: downloadId } }).catch(() => {});
		this.emitToOwner('download:deleted', { id: downloadId }, downloadId);
		this.downloadOwners.delete(downloadId);
	}

	/**
	 * Create a new download
	 */
	async createDownload(
		url: string,
		profileId: string,
		userId?: string,
		subscriptionId?: string,
		saveToLibrary?: boolean,
		customFlags?: string[],
	): Promise<Download> {
		console.log('[DownloadService] Creating download:', { url, profileId, userId });

		// Validate URL
		if (!url || !url.startsWith('http')) {
			throw new Error('Invalid URL');
		}

		// Validate custom flags
		if (customFlags?.length) {
			const badFlag = ytdlpService.findDangerousFlag(customFlags);
			if (badFlag) {
				throw new Error(`Forbidden flag: ${badFlag}`);
			}
		}

		const existing = await prisma.download.findFirst({
			where: {
				url,
				status: {
					in: [
						DownloadStatus.PENDING,
						DownloadStatus.FETCHING_INFO,
						DownloadStatus.DOWNLOADING,
						DownloadStatus.PROCESSING,
					],
				},
			},
		});
		if (existing) {
			throw new Error('This URL is already being downloaded');
		}

		// Resolve effective library access for the requesting user. Direct library
		// saves require 'allowed'; in 'request' mode we save to cache and file a
		// pending request for admin approval; 'denied' silently falls back to cache.
		let useLibrary = false;
		let fileLibraryRequest = false;
		if (saveToLibrary) {
			const access = await this.resolveLibraryAccess(userId);
			if (access === 'allowed') useLibrary = true;
			else if (access === 'request') fileLibraryRequest = true;
			// 'denied' -> stays cache
		}

		// Create download record. Derive videoId from the URL up front so the
		// record is detectable (e.g. by the extension lookup) immediately, before
		// phase-1 metadata runs and sets the canonical id.
		const download = await prisma.download.create({
			data: {
				url,
				videoId: extractVideoId(url) ?? undefined,
				status: DownloadStatus.PENDING,
				profileId,
				userId,
				subscriptionId,
				storagePool: useLibrary ? 'library' : 'cache',
				customFlags: customFlags ?? [],
			},
			include: {
				profile: true,
			},
		});

		console.log('[DownloadService] Download created in DB:', download.id);

		if (fileLibraryRequest && userId) {
			await prisma.libraryRequest
				.create({
					data: { downloadId: download.id, userId, status: 'pending' },
				})
				.catch((e) => console.error('Failed to create library request:', e));
		}

		if (userId) {
			this.downloadOwners.set(download.id, userId);
		}

		// Broadcast new download
		const serialized = serializeDownload(download);
		console.log('[DownloadService] Broadcasting download:created:', serialized.id);
		this.emitToOwner('download:created', serialized, download.id);

		// Start download process
		this.processDownload(download.id).catch((error) => {
			console.error(`Failed to process download ${download.id}:`, error);
			this.handleDownloadError(download.id, error.message);
		});

		return serialized;
	}

	/**
	 * Process download in two phases: metadata → download
	 */
	private async processDownload(downloadId: string): Promise<void> {
		// Phase 1: Fetch metadata (sequential queue)
		try {
			await queueService.enqueueMetadata(async () => {
				await this.fetchMetadata(downloadId);
			});
		} catch (err: any) {
			// A deliberate skip (excluded short, upcoming premiere) has already
			// removed the record — abort the pipeline without error handling.
			if (err instanceof DownloadSkippedError) return;
			throw err;
		}

		// Phase 2: Download file (parallel queue)
		await queueService.enqueueDownload(async () => {
			await this.executeDownload(downloadId);
		});
	}

	/**
	 * Phase 1: Fetch metadata
	 */
	private async fetchMetadata(downloadId: string): Promise<void> {
		const download = await prisma.download.findUnique({
			where: { id: downloadId },
		});

		if (!download || download.status === DownloadStatus.CANCELLED) {
			return;
		}

		// Update status
		await this.updateDownload(downloadId, {
			status: DownloadStatus.FETCHING_INFO,
			startedAt: new Date(),
		});

		try {
			// Get settings for cookie path
			const settings = await this.getSettings();
			const metadata = await ytdlpService.fetchMetadata(download.url, {
				cookiePath: settings.cookiePath,
				proxyUrl: settings.ytdlpProxyUrl,
				extraFlags: settings.ytdlpExtraFlags,
			});

			// Upcoming premieres aren't downloadable yet. Drop the record without
			// archiving so the subscription checker naturally re-queues it once the
			// stream actually starts — and don't burn the 3-retry cycle on it.
			if (metadata.liveStatus === 'is_upcoming') {
				console.log(
					`[DownloadService] ${download.url} is an upcoming premiere — skipping until it goes live`,
				);
				await this.discardDownloadRecord(downloadId);
				throw new DownloadSkippedError('upcoming');
			}

			// Subscription-level short exclusion. Shorts can arrive via /watch/ URLs
			// where the URL alone doesn't identify them, so the aspect-ratio check in
			// fetchMetadata is the authoritative classifier. Archive with a reason so
			// the checker never re-queues the same short.
			if (metadata.videoType === 'short' && download.subscriptionId) {
				const sub = await prisma.subscription.findUnique({
					where: { id: download.subscriptionId },
					select: { excludeShorts: true },
				});
				if (sub?.excludeShorts) {
					const videoId = this.extractVideoId(download.url) ?? metadata.videoId;
					if (videoId) {
						await prisma.archive
							.upsert({
								where: { videoId },
								update: { reason: 'short' },
								create: {
									videoId,
									url: download.url,
									title: metadata.title ?? videoId,
									reason: 'short',
								},
							})
							.catch(() => {});
					}
					console.log(
						`[DownloadService] Skipped short ${videoId ?? download.url} (excluded by subscription)`,
					);
					await this.discardDownloadRecord(downloadId);
					throw new DownloadSkippedError('short');
				}
			}

			// Check duration limit
			if (settings.maxDurationSeconds && metadata.duration) {
				if (metadata.duration > settings.maxDurationSeconds) {
					throw new Error(
						`Video duration (${Math.round(metadata.duration / 60)} min) exceeds limit (${Math.round(settings.maxDurationSeconds / 60)} min)`,
					);
				}
			}

			let dislikeCount: number | undefined;
			if (metadata.videoId && settings.rydEnabled) {
				try {
					const rydRes = await fetch(
						`https://returnyoutubedislikeapi.com/votes?videoId=${metadata.videoId}`,
					);
					if (rydRes.ok) {
						const rydData = await rydRes.json();
						dislikeCount = rydData.dislikes ?? undefined;
					}
				} catch {}
			}

			const updated = await this.updateDownload(downloadId, {
				title: metadata.title,
				thumbnail: metadata.thumbnail,
				duration: metadata.duration,
				uploader: metadata.uploader,
				channelUrl: metadata.channelUrl,
				uploadDate: metadata.uploadDate,
				format: metadata.format,
				filesize: metadata.filesize,
				artist: metadata.artist,
				album: metadata.album,
				releaseYear: metadata.releaseYear,
				videoType: metadata.videoType,
				description: metadata.description,
				category: metadata.category,
				tags: metadata.tags ?? [],
				videoId: metadata.videoId,
				height: metadata.height,
				...(dislikeCount !== undefined && { dislikeCount }),
			});

			// Look up channel override and apply profile if one exists
			if (metadata.channelUrl) {
				const override = await channelOverrideService.getByChannelUrl(metadata.channelUrl);
				if (override?.profileId) {
					await this.updateDownload(downloadId, { profileId: override.profileId });
				}
			}

			this.emitToOwner('download:metadata', updated, downloadId);
		} catch (error) {
			throw new Error(`Metadata fetch failed: ${error}`);
		}
	}

	/**
	 * Create initial download tasks for expected processing steps
	 */
	private async createInitialTasks(downloadId: string, customFlags: string[]): Promise<void> {
		const taskTypes = ['download'];

		// Detect expected post-processing steps from flags
		const flagStr = customFlags.join(' ').toLowerCase();
		if (flagStr.includes('--embed-thumbnail') || flagStr.includes('--write-thumbnail')) {
			taskTypes.push('thumbnail');
		}
		if (
			flagStr.includes('--embed-subs') ||
			flagStr.includes('--write-sub') ||
			flagStr.includes('--write-auto-sub')
		) {
			taskTypes.push('subtitle');
		}
		if (flagStr.includes('--embed-metadata') || flagStr.includes('--add-metadata')) {
			taskTypes.push('metadata');
		}
		if (flagStr.includes('--sponsorblock-mark') || flagStr.includes('--sponsorblock-remove')) {
			taskTypes.push('sponsorblock');
		}
		if (flagStr.includes('--extract-audio') || flagStr.includes('-x')) {
			taskTypes.push('convert');
		}
		if (flagStr.includes('--recode-video') || flagStr.includes('--remux-video')) {
			taskTypes.push('convert');
		}

		// Always expect merge (yt-dlp often merges audio+video)
		if (!taskTypes.includes('merge')) {
			taskTypes.push('merge');
		}

		// Deduplicate
		const uniqueTypes = [...new Set(taskTypes)];

		const taskMap = new Map<string, string>();

		for (const type of uniqueTypes) {
			const task = await prisma.downloadTask.create({
				data: {
					downloadId,
					type,
					status: 'pending',
				},
			});
			taskMap.set(type, task.id);
		}

		this.downloadTaskIds.set(downloadId, taskMap);

		// Broadcast initial tasks
		const tasks = await prisma.downloadTask.findMany({ where: { downloadId } });
		this.emitToOwner('download:tasks', { id: downloadId, tasks }, downloadId);
	}

	/**
	 * Update a task's status and broadcast the change
	 */
	private async updateTask(
		downloadId: string,
		taskType: string,
		data: {
			status?: string;
			progress?: number;
			message?: string;
			startedAt?: Date;
			completedAt?: Date;
		},
	): Promise<void> {
		const taskMap = this.downloadTaskIds.get(downloadId);
		let taskId = taskMap?.get(taskType);

		// If no task exists for this type, create one dynamically
		if (!taskId) {
			const task = await prisma.downloadTask.create({
				data: {
					downloadId,
					type: taskType,
					status: 'pending',
				},
			});
			taskId = task.id;
			if (!taskMap) {
				this.downloadTaskIds.set(downloadId, new Map([[taskType, taskId]]));
			} else {
				taskMap.set(taskType, taskId);
			}
		}

		const updated = await prisma.downloadTask.update({
			where: { id: taskId },
			data,
		});

		this.emitToOwner('download:task', { id: downloadId, task: updated }, downloadId);
	}

	/**
	 * Phase 2: Execute download
	 */
	private async executeDownload(downloadId: string): Promise<void> {
		const download = await prisma.download.findUnique({
			where: { id: downloadId },
			include: { profile: true },
		});

		if (!download || download.status === DownloadStatus.CANCELLED) {
			return;
		}

		// Update status
		await this.updateDownload(downloadId, {
			status: DownloadStatus.DOWNLOADING,
		});

		// Get settings for download path
		const settings = await this.getSettings();
		const outputPath = settings.downloadPath;

		// Pre-flight disk space check: yt-dlp always writes to outputPath first
		// regardless of storagePool (library saves are copied over after completion),
		// so check the real filesystem here rather than trusting the DB-tallied cache
		// quota, which only tracks storagePool: 'cache' and can't see this coming.
		const MIN_FREE_DISK_BYTES = BigInt(1_073_741_824); // 1 GiB floor when size is unknown
		const requiredBytes = download.filesize
			? (download.filesize * BigInt(120)) / BigInt(100) // 20% buffer for merge/remux overhead
			: MIN_FREE_DISK_BYTES;
		const { sufficient } = await libraryService.ensureFreeDiskSpace(outputPath, requiredBytes);
		if (!sufficient) {
			throw new Error('Insufficient disk space to start download');
		}

		// Build yt-dlp arguments (merge profile flags with per-download overrides).
		// Global default flags come first so more specific flags can override them
		// (yt-dlp honors the last occurrence of a repeated flag).
		let mergedFlags = [
			...settings.ytdlpExtraFlags,
			...download.profile.customFlags,
			...download.customFlags,
		];

		// Apply channel override flags and sponsorblock setting
		if (download.channelUrl) {
			const effective = await channelOverrideService.getEffectiveFlags(
				download.channelUrl,
				mergedFlags,
			);
			mergedFlags = effective.flags;
			// If sponsorblock is disabled by override, strip SB flags from mergedFlags
			if (!effective.sponsorblock) {
				mergedFlags = ytdlpService.stripSponsorBlockFlags(mergedFlags);
			}
		}

		const aria2cAvailable = settings.useAria2c ? await ytdlpService.isAria2cAvailable() : false;
		const args = ytdlpService.buildArgs(download.url, outputPath, mergedFlags, {
			rateLimit: settings.rateLimit,
			sleepInterval: settings.sleepInterval,
			cookiePath: settings.cookiePath,
			proxyUrl: settings.ytdlpProxyUrl,
			concurrentFragments: settings.concurrentFragments,
			useAria2c: settings.useAria2c,
			httpChunkSize: settings.httpChunkSize,
			aria2cAvailable,
		});

		const durationSeconds = download.duration ?? null;
		if (durationSeconds && durationSeconds > 0) {
			this.downloadDurations.set(downloadId, durationSeconds);
		}

		// Create initial task records for this download
		await this.createInitialTasks(downloadId, mergedFlags);

		// Mark download task as in_progress
		await this.updateTask(downloadId, 'download', {
			status: 'in_progress',
			startedAt: new Date(),
		});

		// Spawn download process (clear any stale error from a prior attempt)
		this.lastErrorLine.delete(downloadId);
		const proc = ytdlpService.spawnDownload(
			args,
			(data) => this.handleProgress(downloadId, data),
			// Capture yt-dlp's fatal error line for the failure message, but do
			// NOT fail/retry per stderr line — yt-dlp prints warnings/notices to
			// stderr while still succeeding. Only a non-zero exit code is fatal.
			(line) => {
				if (line.startsWith('ERROR')) this.lastErrorLine.set(downloadId, line);
			},
		);

		// Store process reference
		this.activeProcesses.set(downloadId, proc);
		this.lastActivity.set(downloadId, Date.now());

		// Wait for completion, with a stall watchdog so a hung yt-dlp can't hold a
		// concurrency slot forever.
		const stallTimeoutMs = (settings.downloadStallTimeoutSeconds ?? 600) * 1000;
		await new Promise<void>((resolve, reject) => {
			let settled = false;

			const cleanup = () => {
				if (watchdog) clearInterval(watchdog);
				this.activeProcesses.delete(downloadId);
				this.lastActivity.delete(downloadId);
			};

			const watchdog =
				stallTimeoutMs > 0
					? setInterval(() => {
							const last = this.lastActivity.get(downloadId) ?? Date.now();
							if (Date.now() - last > stallTimeoutMs) {
								if (settled) return;
								settled = true;
								console.error(
									`[DownloadService] Download ${downloadId} stalled (no progress for ` +
										`${Math.round(stallTimeoutMs / 1000)}s) — killing process`,
								);
								ytdlpService.killProcess(proc).catch(() => {});
								cleanup();
								reject(
									new Error(
										`Download stalled (no progress for ${Math.round(stallTimeoutMs / 1000)}s)`,
									),
								);
							}
						}, 15000)
					: null;

			proc.on('close', async (code) => {
				if (settled) return;
				settled = true;
				cleanup();

				// A user cancel kills the process group, so yt-dlp exits via signal
				// (code === null). That's an expected stop, not a failure — resolve
				// cleanly so it never reaches handleDownloadError and triggers a retry.
				if (this.cancelledDownloads.has(downloadId)) {
					resolve();
				} else if (code === 0) {
					await this.completeDownload(downloadId);
					resolve();
				} else {
					const detail = this.lastErrorLine.get(downloadId);
					reject(new Error(detail || `yt-dlp exited with code ${code}`));
				}
			});

			proc.on('error', (error) => {
				if (settled) return;
				settled = true;
				cleanup();
				reject(error);
			});
		});
	}

	/**
	 * Handle progress updates from yt-dlp
	 */
	private processingSteps = new Map<string, string>();
	private downloadDurations = new Map<string, number>();

	private static readonly MEDIA_EXTENSIONS = new Set([
		'mp4',
		'webm',
		'mkv',
		'flv',
		'mov',
		'avi',
		'mp3',
		'm4a',
		'aac',
		'flac',
		'opus',
		'ogg',
		'wav',
	]);

	private handleProgress(downloadId: string, data: any): void {
		// Record activity for the stall watchdog (any output counts as progress).
		this.lastActivity.set(downloadId, Date.now());

		// Handle file destination info (only for media files, not subtitles/thumbnails)
		if (data.type === 'destination' && data.filepath) {
			const filepath = data.filepath;
			const filename = filepath.split('/').pop() || '';
			const ext = filename.split('.').pop()?.toLowerCase() || '';
			console.log('[DownloadService] Captured file:', filename, 'at', filepath);

			if (!DownloadService.MEDIA_EXTENSIONS.has(ext)) return;

			// Update immediately (not debounced)
			this.updateDownload(downloadId, {
				filename,
				filepath,
			});
			return;
		}

		// Handle ffmpeg progress during post-processing
		if (data.type === 'ffmpeg_progress') {
			const step = this.processingSteps.get(downloadId) || 'Processing';
			const duration = this.downloadDurations.get(downloadId);
			let detail = '';
			const pctOrNull = data.timeSeconds ? ffmpegPercent(data.timeSeconds, duration) : null;
			let pct: number | undefined = pctOrNull ?? undefined;
			if (pct !== undefined) {
				detail = data.speed ? `${pct}% · ${data.speed}` : `${pct}%`;
			} else if (data.speed) {
				detail = data.speed;
			}
			const processingStep = detail ? `${step} (${detail})` : step;

			// Update in-progress task with ffmpeg progress percentage
			if (pct !== undefined) {
				const taskMap = this.downloadTaskIds.get(downloadId);
				if (taskMap) {
					for (const [type, taskId] of taskMap) {
						// Find the currently in_progress task and update its progress
						// We use the last known step to infer the current task type
						const currentModule = this.lastPostProcessModule.get(downloadId);
						const taskType = currentModule ? MODULE_TO_TASK_TYPE[currentModule] : undefined;
						if (taskType && type === taskType) {
							this.updateTask(downloadId, taskType, {
								progress: pct,
								message: processingStep,
							});
							break;
						}
					}
				}
			}

			const progressData: any = {
				id: downloadId,
				status: 'PROCESSING',
				processingStep,
				indeterminate: pct === undefined,
			};
			// Only emit top-level progress field when we have a known percent
			if (pct !== undefined) {
				progressData.progress = pct;
			}

			this.emitToOwner('download:progress', progressData, downloadId);
			return;
		}

		// Handle post-processing step
		if (data.type === 'postprocess' && data.step) {
			if (!this.processingSteps.has(downloadId)) {
				// Mark download task as completed when entering post-processing
				this.updateTask(downloadId, 'download', {
					status: 'completed',
					progress: 100,
					completedAt: new Date(),
				});
				this.updateDownload(downloadId, {
					status: DownloadStatus.PROCESSING,
					speed: null,
					eta: null,
				});
			}

			// Map the step name back to a task type and update it
			if (data.module) {
				const taskType = MODULE_TO_TASK_TYPE[data.module];
				if (taskType) {
					// Complete the previous task of same type if re-entering
					this.updateTask(downloadId, taskType, {
						status: 'in_progress',
						message: data.step,
						startedAt: new Date(),
					});
				}
			}

			this.processingSteps.set(downloadId, data.step);
			this.emitToOwner(
				'download:progress',
				{
					id: downloadId,
					status: 'PROCESSING',
					processingStep: data.step,
					indeterminate: true,
					stepStartedAt: Date.now(),
				},
				downloadId,
			);
			return;
		}

		if (!data.progress) return;

		const progress = parseFloat(data.progress.replace('%', '')) || 0;
		const speed = data.speed || null;
		const eta = data.eta || null;
		const downloadedBytes = data.downloaded ? BigInt(data.downloaded) : null;
		const totalBytes = data.total ? BigInt(data.total) : null;

		// Debounced DB update (max 1/sec)
		if (this.updateDebounce.has(downloadId)) {
			clearTimeout(this.updateDebounce.get(downloadId)!);
		}

		this.updateDebounce.set(
			downloadId,
			setTimeout(() => {
				this.updateDownload(downloadId, {
					progress,
					speed,
					eta,
					downloadedBytes,
					totalBytes,
				});
				this.updateDebounce.delete(downloadId);
			}, 1000),
		);

		// Update the download task progress (debounced alongside DB update)
		this.updateTask(downloadId, 'download', {
			progress,
			message: speed ? `${speed} - ETA ${eta}` : undefined,
		});

		this.emitToOwner(
			'download:progress',
			{
				id: downloadId,
				progress,
				speed,
				eta,
				downloadedBytes: downloadedBytes?.toString(),
				totalBytes: totalBytes?.toString(),
			},
			downloadId,
		);
	}

	/**
	 * Complete download
	 */
	private async completeDownload(downloadId: string): Promise<void> {
		const current = await prisma.download.findUnique({ where: { id: downloadId } });
		let filesize: bigint | undefined;
		if (current?.filepath) {
			try {
				const st = await stat(current.filepath);
				filesize = BigInt(st.size);
			} catch {}
		}

		const download = await this.updateDownload(downloadId, {
			status: DownloadStatus.COMPLETED,
			progress: 100,
			completedAt: new Date(),
			error: null,
			...(filesize !== undefined && { filesize }),
		});

		// Add to archive if enabled
		const settings = await this.getSettings();
		if (settings.enableArchive && download.title) {
			await this.addToArchive(download.url, download.title);
		}

		// Index subtitles if any exist alongside the video
		try {
			const indexedCount = await subtitleService.indexSubtitles(downloadId);
			if (indexedCount > 0) {
				console.log(`[DownloadService] Indexed ${indexedCount} subtitle lines for ${downloadId}`);
			}
		} catch (error) {
			console.error(`[DownloadService] Failed to index subtitles: ${error}`);
		}

		// Move to library if requested
		if (download.storagePool === 'library' && settings.libraryPath) {
			try {
				await libraryService.promoteToLibrary(downloadId);
			} catch (error) {
				console.error(`[DownloadService] Failed to move to library: ${error}`);
			}
		} else if (download.storagePool === 'cache' && settings.libraryPath) {
			// Fulfil a library request that an admin already approved while the
			// download was still in flight.
			const req = await prisma.libraryRequest.findUnique({ where: { downloadId } });
			if (req?.status === 'approved') {
				try {
					await libraryService.promoteToLibrary(downloadId);
				} catch (error) {
					console.error(`[DownloadService] Failed to fulfil approved library request: ${error}`);
				}
			}
		}

		// Mark all remaining pending/in_progress tasks as completed (or skipped)
		await prisma.downloadTask.updateMany({
			where: {
				downloadId,
				status: { in: ['in_progress'] },
			},
			data: { status: 'completed', completedAt: new Date() },
		});
		await prisma.downloadTask.updateMany({
			where: {
				downloadId,
				status: 'pending',
			},
			data: { status: 'skipped' },
		});

		this.clearDownloadState(downloadId);
		this.emitToOwner('download:complete', { id: downloadId, download }, downloadId);
		this.downloadOwners.delete(downloadId);

		// Send notification
		notificationService.notifyComplete(download.title || download.url).catch(() => {});

		// Enforce cache quota asynchronously — per-user so each user is evicted
		// against their own limit, then globally against the total cache cap.
		libraryService.enforceCacheQuota(download.userId ?? undefined).catch((error) => {
			console.error('[DownloadService] Cache quota enforcement failed:', error);
		});
		libraryService.enforceTotalCacheQuota().catch((error) => {
			console.error('[DownloadService] Total cache quota enforcement failed:', error);
		});
	}

	/**
	 * Handle download error
	 */
	/**
	 * Delete the tracked output file plus any yt-dlp working artifacts left next to it
	 * (.part, .ytdl, pre-merge fragment streams, etc). yt-dlp writes those under the
	 * same stem as the final filename, and only unlinking the tracked `filepath` leaves
	 * them orphaned on disk with no DB row to ever reclaim them.
	 */
	private async cleanupPartialFiles(filepath: string): Promise<void> {
		try {
			const dir = dirname(filepath);
			const stem = basename(filepath, extname(filepath));
			const entries = await readdir(dir);
			for (const entry of entries) {
				if (entry === basename(filepath) || entry.startsWith(stem + '.')) {
					try {
						await unlink(join(dir, entry));
					} catch {}
				}
			}
		} catch {}
	}

	private async handleDownloadError(downloadId: string, error: string): Promise<void> {
		// A cancelled download must never be retried, even if an error from the
		// dying process slips through before the CANCELLED status is written.
		if (this.cancelledDownloads.has(downloadId)) return;
		if (this.handlingError.has(downloadId)) return;
		this.handlingError.add(downloadId);

		try {
			const download = await prisma.download.findUnique({
				where: { id: downloadId },
			});

			if (!download || download.status === DownloadStatus.CANCELLED) return;

			if (download.retryCount < 3) {
				await this.updateDownload(downloadId, {
					retryCount: download.retryCount + 1,
					error,
				});

				const delay = Math.pow(2, download.retryCount) * 1000;
				const timeout = setTimeout(() => {
					this.retryTimeouts.delete(downloadId);
					this.processDownload(downloadId).catch((retryError) => {
						console.error(`Retry failed for download ${downloadId}:`, retryError);
						this.handleDownloadError(downloadId, retryError.message);
					});
				}, delay);
				this.retryTimeouts.set(downloadId, timeout);
			} else {
				// Terminal failure: drop the record entirely rather than leaving a
				// FAILED row that's invisible in every list (which only query COMPLETED
				// or the in-progress statuses) yet still reachable at /downloads/:id.
				// Notify first — we still hold the record — then delete file, archive
				// entry, and the row (child rows cascade).
				this.clearDownloadState(downloadId);

				if (download.filepath) {
					await this.cleanupPartialFiles(download.filepath);
				}

				const videoId = this.extractVideoId(download.url);
				if (videoId) {
					await prisma.archive.deleteMany({ where: { videoId } });
				}

				await prisma.download.delete({ where: { id: downloadId } }).catch(() => {});

				this.emitToOwner('download:failed', { id: downloadId, error }, downloadId);
				this.downloadOwners.delete(downloadId);

				// Send failure notification
				notificationService.notifyFail(download.title || download.url, error).catch(() => {});
			}
		} finally {
			this.handlingError.delete(downloadId);
		}
	}

	/**
	 * Cancel download
	 */
	async cancelDownload(downloadId: string): Promise<void> {
		// Mark cancellation synchronously — BEFORE any await — so the process
		// `close` handler and handleDownloadError see it the instant the killed
		// process emits its (signal-driven, code === null) exit.
		this.cancelledDownloads.add(downloadId);

		// Clear pending timers up front so an already-scheduled retry can't fire
		// while we're waiting for the process to die.
		const retryTimeout = this.retryTimeouts.get(downloadId);
		if (retryTimeout) {
			clearTimeout(retryTimeout);
			this.retryTimeouts.delete(downloadId);
		}

		const debounceTimeout = this.updateDebounce.get(downloadId);
		if (debounceTimeout) {
			clearTimeout(debounceTimeout);
			this.updateDebounce.delete(downloadId);
		}

		try {
			const proc = this.activeProcesses.get(downloadId);
			if (proc) {
				await ytdlpService.killProcess(proc);
				this.activeProcesses.delete(downloadId);
			}

			// Cancelling mid-download otherwise leaves yt-dlp's partial file (and any
			// .part/.ytdl/fragment artifacts) on disk forever — there's no COMPLETED row
			// to ever make cache/library quota logic notice or clean them up.
			const download = await prisma.download.findUnique({ where: { id: downloadId } });
			if (download?.filepath) {
				await this.cleanupPartialFiles(download.filepath);
			}

			await this.updateDownload(downloadId, {
				status: DownloadStatus.CANCELLED,
			});

			this.clearDownloadState(downloadId);
			this.emitToOwner('download:cancelled', { id: downloadId }, downloadId);
			this.downloadOwners.delete(downloadId);
		} finally {
			this.cancelledDownloads.delete(downloadId);
		}
	}

	/**
	 * Delete download
	 */
	async deleteDownload(downloadId: string): Promise<void> {
		await this.cancelDownload(downloadId);

		const download = await prisma.download.findUnique({
			where: { id: downloadId },
		});

		if (download) {
			const videoId = this.extractVideoId(download.url);
			if (videoId) {
				await prisma.archive.deleteMany({
					where: { videoId },
				});
			}

			if (download.filepath) {
				try {
					await unlink(download.filepath);
				} catch {
					// File may already be gone
				}
			}
		}

		await prisma.download.delete({
			where: { id: downloadId },
		});

		this.emitToOwner('download:deleted', { id: downloadId }, downloadId);
		this.downloadOwners.delete(downloadId);
	}

	/**
	 * Admin: delete every download (any status/storage pool), optionally scoped to
	 * a single user. Each is removed via deleteDownload so in-progress processes
	 * are cancelled and files/archives cleaned up. Returns the number deleted.
	 */
	async clearAllDownloads(userId?: string): Promise<number> {
		const downloads = await prisma.download.findMany({
			where: userId ? { userId } : {},
			select: { id: true },
		});

		let deleted = 0;
		for (const { id } of downloads) {
			try {
				await this.deleteDownload(id);
				deleted++;
			} catch (e) {
				console.error(`[DownloadService] Failed to clear download ${id}:`, e);
			}
		}

		return deleted;
	}

	/**
	 * Resume a PENDING download (e.g. after server restart)
	 */
	resumeDownload(downloadId: string, userId?: string): void {
		if (userId) {
			this.downloadOwners.set(downloadId, userId);
		}
		this.processDownload(downloadId).catch((error) => {
			console.error(`Failed to resume download ${downloadId}:`, error);
			this.handleDownloadError(downloadId, error.message);
		});
	}

	/**
	 * Refresh metadata for an existing download
	 */
	async refreshMetadata(downloadId: string): Promise<any> {
		const download = await prisma.download.findUnique({ where: { id: downloadId } });
		if (!download) throw new Error('Download not found');

		const settings = await this.getSettings();
		const metadata = await ytdlpService.fetchMetadata(download.url, {
			cookiePath: settings.cookiePath,
			proxyUrl: settings.ytdlpProxyUrl,
			extraFlags: settings.ytdlpExtraFlags,
		});

		// Fetch RYD dislike count if enabled
		let dislikeCount: number | undefined;
		if (metadata.videoId && settings.rydEnabled) {
			try {
				const rydRes = await fetch(
					`https://returnyoutubedislikeapi.com/votes?videoId=${metadata.videoId}`,
				);
				if (rydRes.ok) {
					const rydData = await rydRes.json();
					dislikeCount = rydData.dislikes ?? undefined;
				}
			} catch {}
		}

		const updated = await prisma.download.update({
			where: { id: downloadId },
			data: {
				title: metadata.title,
				thumbnail: metadata.thumbnail,
				duration: metadata.duration,
				uploader: metadata.uploader,
				channelUrl: metadata.channelUrl,
				uploadDate: metadata.uploadDate,
				format: metadata.format,
				filesize: metadata.filesize,
				artist: metadata.artist,
				album: metadata.album,
				releaseYear: metadata.releaseYear,
				videoType: metadata.videoType,
				description: metadata.description,
				category: metadata.category,
				tags: metadata.tags ?? [],
				videoId: metadata.videoId,
				height: metadata.height,
				...(dislikeCount !== undefined && { dislikeCount }),
			},
			include: { profile: true },
		});

		return {
			...updated,
			filesize: updated.filesize?.toString() ?? null,
			downloadedBytes: updated.downloadedBytes?.toString() ?? null,
			totalBytes: updated.totalBytes?.toString() ?? null,
		};
	}

	/**
	 * Get tasks for a download
	 */
	async getTasksForDownload(downloadId: string): Promise<any[]> {
		return prisma.downloadTask.findMany({
			where: { downloadId },
			orderBy: { createdAt: 'asc' },
		});
	}

	/**
	 * Get download by ID
	 */
	async getDownload(downloadId: string): Promise<Download | null> {
		const download = await prisma.download.findUnique({
			where: { id: downloadId },
			include: { profile: true },
		});
		return download ? serializeDownload(download) : null;
	}

	/**
	 * List downloads with filters
	 */
	async listDownloads(
		userId?: string,
		status?: DownloadStatus,
		limit = 50,
		offset = 0,
		watchState?: 'watched' | 'unwatched' | 'in_progress',
		filters?: {
			minHeight?: number;
			maxHeight?: number;
			dateFrom?: Date;
			dateTo?: Date;
		},
	): Promise<Download[]> {
		const where: any = {};

		// Only add fields if they have actual values
		if (userId !== undefined && userId !== null) {
			where.userId = userId;
		}
		if (status !== undefined && status !== null) {
			where.status = status;
		}

		// Filter by watch state using watchProgress relation
		if (watchState && userId) {
			switch (watchState) {
				case 'watched':
					where.watchProgress = {
						some: {
							userId,
							watched: true,
						},
					};
					break;
				case 'unwatched':
					where.NOT = {
						watchProgress: {
							some: {
								userId,
								OR: [{ watched: true }, { position: { gt: 0 } }],
							},
						},
					};
					break;
				case 'in_progress':
					where.watchProgress = {
						some: {
							userId,
							watched: false,
							position: { gt: 0 },
						},
					};
					break;
			}
		}

		// Resolution (height) filters
		if (filters?.minHeight || filters?.maxHeight) {
			where.height = {};
			if (filters.minHeight) where.height.gte = filters.minHeight;
			if (filters.maxHeight) where.height.lte = filters.maxHeight;
		}

		// Date range filters (based on createdAt / download date)
		if (filters?.dateFrom || filters?.dateTo) {
			where.createdAt = {};
			if (filters.dateFrom) where.createdAt.gte = filters.dateFrom;
			if (filters.dateTo) {
				// Set to end of day
				const endOfDay = new Date(filters.dateTo);
				endOfDay.setHours(23, 59, 59, 999);
				where.createdAt.lte = endOfDay;
			}
		}

		const downloads = await prisma.download.findMany({
			where,
			include: { profile: true },
			orderBy: { createdAt: 'desc' },
			take: limit,
			skip: offset,
		});

		return downloads.map(serializeDownload);
	}

	/**
	 * Get active downloads
	 */
	async getActiveDownloads(userId?: string): Promise<any[]> {
		// Guard against Prisma treating `{ userId: undefined }` as "no filter", which would
		// leak every user's active downloads to an anonymous SSE connection.
		const where: any = {
			status: {
				in: [
					DownloadStatus.PENDING,
					DownloadStatus.FETCHING_INFO,
					DownloadStatus.DOWNLOADING,
					DownloadStatus.PROCESSING,
				],
			},
		};
		if (userId != null) {
			where.userId = userId;
		}

		const downloads = await prisma.download.findMany({
			where,
			include: { profile: true },
			orderBy: { createdAt: 'desc' },
		});

		return downloads.map((d: any) => {
			const serialized = serializeDownload(d);
			const step = this.processingSteps.get(d.id);
			if (step) serialized.processingStep = step;
			return serialized;
		});
	}

	/**
	 * Update download
	 */
	private async updateDownload(downloadId: string, data: any): Promise<Download> {
		const download = await prisma.download.update({
			where: { id: downloadId },
			data,
			include: { profile: true },
		});

		const serialized = serializeDownload(download);

		// Broadcast status changes to frontend
		if (data.status) {
			console.log('[DownloadService] Status change:', downloadId, '→', data.status);
			this.emitToOwner(
				'download:status',
				{
					id: downloadId,
					status: data.status,
					...serialized,
				},
				downloadId,
			);
		}

		return serialized;
	}

	/**
	 * Add to archive
	 */
	private async addToArchive(url: string, title: string): Promise<void> {
		try {
			// Extract video ID from URL (for YouTube)
			const videoId = this.extractVideoId(url);
			if (!videoId) return;

			await prisma.archive.upsert({
				where: { videoId },
				update: {},
				create: {
					videoId,
					url,
					title,
				},
			});
		} catch (error) {
			console.error('Failed to add to archive:', error);
		}
	}

	/**
	 * Extract video ID from URL (shared with the lookup route via $lib/utils/youtube)
	 */
	private extractVideoId(url: string): string | null {
		return extractVideoId(url);
	}

	/**
	 * Resolve a user's effective library-save access ('allowed' | 'request' | 'denied').
	 * Anonymous (no userId) downloads cannot use the library.
	 */
	async resolveLibraryAccess(userId?: string): Promise<LibraryAccess> {
		if (!userId) return 'denied';
		const [user, settings] = await Promise.all([
			prisma.user.findUnique({
				where: { id: userId },
				select: { libraryAccess: true, isAdmin: true },
			}),
			this.getSettings(),
		]);
		return libraryAccessStatus(user, settings);
	}

	/**
	 * Get settings
	 */
	private async getSettings() {
		let settings = await prisma.settings.findUnique({
			where: { id: 'singleton' },
		});

		if (!settings) {
			settings = await prisma.settings.create({
				data: { id: 'singleton' },
			});
		}

		return settings;
	}
}

// Singleton instance
export const downloadService = new DownloadService();

// Set up SSE initial state callback
sseEmitter.setInitialStateCallback(async (userId) => {
	return downloadService.getActiveDownloads(userId);
});
