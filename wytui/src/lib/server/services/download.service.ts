import { prisma } from '../db';
import { ytdlpService } from './ytdlp.service';
import { queueService } from './queue.service';
import { sseEmitter } from '../sse/emitter';
import { DownloadStatus } from '@prisma/client';
import type { ChildProcess } from 'child_process';
import type { Download } from '$lib/types';

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

class DownloadService {
	// Track active download processes
	private activeProcesses = new Map<string, ChildProcess>();

	// Track download ownership for SSE filtering
	private downloadOwners = new Map<string, string>();

	// Debounce DB updates (max 1 update per second per download)
	private updateDebounce = new Map<string, NodeJS.Timeout>();

	private emitToOwner(event: string, data: any, downloadId: string): void {
		const userId = this.downloadOwners.get(downloadId);
		if (userId) {
			sseEmitter.broadcastToUser(event, data, userId);
		} else {
			sseEmitter.broadcast(event, data);
		}
	}

	/**
	 * Create a new download
	 */
	async createDownload(
		url: string,
		profileId: string,
		userId?: string,
		subscriptionId?: string
	): Promise<Download> {
		console.log('[DownloadService] Creating download:', { url, profileId, userId });

		// Validate URL
		if (!url || !url.startsWith('http')) {
			throw new Error('Invalid URL');
		}

		// Create download record
		const download = await prisma.download.create({
			data: {
				url,
				status: DownloadStatus.PENDING,
				profileId,
				userId,
				subscriptionId,
			},
			include: {
				profile: true,
			},
		});

		console.log('[DownloadService] Download created in DB:', download.id);

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
		await queueService.enqueueMetadata(async () => {
			await this.fetchMetadata(downloadId);
		});

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
			const metadata = await ytdlpService.fetchMetadata(download.url);

			const updated = await this.updateDownload(downloadId, {
				title: metadata.title,
				thumbnail: metadata.thumbnail,
				duration: metadata.duration,
				uploader: metadata.uploader,
				uploadDate: metadata.uploadDate,
				format: metadata.format,
				filesize: metadata.filesize,
			});

			this.emitToOwner('download:metadata', updated, downloadId);
		} catch (error) {
			throw new Error(`Metadata fetch failed: ${error}`);
		}
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

		// Build yt-dlp arguments
		const args = ytdlpService.buildArgs(
			download.url,
			outputPath,
			download.profile.customFlags
		);

		// Spawn download process
		const proc = ytdlpService.spawnDownload(
			args,
			(data) => this.handleProgress(downloadId, data),
			(error) => this.handleDownloadError(downloadId, error)
		);

		// Store process reference
		this.activeProcesses.set(downloadId, proc);

		// Wait for completion
		await new Promise<void>((resolve, reject) => {
			proc.on('close', async (code) => {
				this.activeProcesses.delete(downloadId);

				if (code === 0) {
					await this.completeDownload(downloadId);
					resolve();
				} else {
					reject(new Error(`yt-dlp exited with code ${code}`));
				}
			});

			proc.on('error', (error) => {
				this.activeProcesses.delete(downloadId);
				reject(error);
			});
		});
	}

	/**
	 * Handle progress updates from yt-dlp
	 */
	private handleProgress(downloadId: string, data: any): void {
		// Handle file destination info
		if (data.type === 'destination' && data.filepath) {
			const filepath = data.filepath;
			const filename = filepath.split('/').pop() || '';
			console.log('[DownloadService] Captured file:', filename, 'at', filepath);

			// Update immediately (not debounced)
			this.updateDownload(downloadId, {
				filename,
				filepath,
			});
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
			}, 1000)
		);

		this.emitToOwner('download:progress', {
			id: downloadId,
			progress,
			speed,
			eta,
			downloadedBytes: downloadedBytes?.toString(),
			totalBytes: totalBytes?.toString(),
		}, downloadId);
	}

	/**
	 * Complete download
	 */
	private async completeDownload(downloadId: string): Promise<void> {
		const download = await this.updateDownload(downloadId, {
			status: DownloadStatus.COMPLETED,
			progress: 100,
			completedAt: new Date(),
		});

		// Add to archive if enabled
		const settings = await this.getSettings();
		if (settings.enableArchive && download.title) {
			await this.addToArchive(download.url, download.title);
		}

		this.emitToOwner('download:complete', { id: downloadId, download }, downloadId);
	}

	/**
	 * Handle download error
	 */
	private async handleDownloadError(downloadId: string, error: string): Promise<void> {
		const download = await prisma.download.findUnique({
			where: { id: downloadId },
		});

		if (!download) return;

		// Check if we should retry
		if (download.retryCount < 3) {
			await this.updateDownload(downloadId, {
				retryCount: download.retryCount + 1,
				error,
			});

			// Retry after exponential backoff
			const delay = Math.pow(2, download.retryCount) * 1000;
			setTimeout(() => {
				this.processDownload(downloadId);
			}, delay);
		} else {
			// Max retries reached, mark as failed
			await this.updateDownload(downloadId, {
				status: DownloadStatus.FAILED,
				error,
			});

			this.emitToOwner('download:failed', { id: downloadId, error }, downloadId);
		}
	}

	/**
	 * Cancel download
	 */
	async cancelDownload(downloadId: string): Promise<void> {
		const proc = this.activeProcesses.get(downloadId);
		if (proc) {
			await ytdlpService.killProcess(proc);
			this.activeProcesses.delete(downloadId);
		}

		await this.updateDownload(downloadId, {
			status: DownloadStatus.CANCELLED,
		});

		this.emitToOwner('download:cancelled', { id: downloadId }, downloadId);
	}

	/**
	 * Delete download
	 */
	async deleteDownload(downloadId: string): Promise<void> {
		// Cancel if active
		await this.cancelDownload(downloadId);

		// Delete from DB
		await prisma.download.delete({
			where: { id: downloadId },
		});

		// TODO: Delete file from filesystem

		this.emitToOwner('download:deleted', { id: downloadId }, downloadId);
		this.downloadOwners.delete(downloadId);
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
		offset = 0
	): Promise<Download[]> {
		const where: any = {};

		// Only add fields if they have actual values
		if (userId !== undefined && userId !== null) {
			where.userId = userId;
		}
		if (status !== undefined && status !== null) {
			where.status = status;
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
	async getActiveDownloads(userId?: string): Promise<Download[]> {
		const downloads = await prisma.download.findMany({
			where: {
				userId,
				status: {
					in: [
						DownloadStatus.PENDING,
						DownloadStatus.FETCHING_INFO,
						DownloadStatus.DOWNLOADING,
						DownloadStatus.PROCESSING,
					],
				},
			},
			include: { profile: true },
			orderBy: { createdAt: 'desc' },
		});

		return downloads.map(serializeDownload);
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
			this.emitToOwner('download:status', {
				id: downloadId,
				status: data.status,
				...serialized,
			}, downloadId);
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
	 * Extract video ID from URL
	 */
	private extractVideoId(url: string): string | null {
		try {
			const urlObj = new URL(url);
			if (urlObj.hostname.includes('youtube.com')) {
				return urlObj.searchParams.get('v');
			} else if (urlObj.hostname.includes('youtu.be')) {
				return urlObj.pathname.slice(1);
			}
			return null;
		} catch {
			return null;
		}
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
