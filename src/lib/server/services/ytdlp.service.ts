import { spawn, type ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import type { DownloadMetadata } from '$lib/types';

export class YtdlpService {
	private readonly WHITELISTED_FLAGS = new Set([
		'-f', '--format',
		'-S', '--format-sort',
		'--audio-format',
		'--audio-quality',
		'--remux-video',
		'--recode-video',
		'--embed-subs',
		'--sub-langs',
		'--embed-thumbnail',
		'--embed-metadata',
		'--embed-chapters',
		'--write-auto-subs',
		'--write-subs',
		'--sub-format',
		'--sponsorblock-mark',
		'--sponsorblock-remove',
		'--sponsorblock-chapter-title',
		'--sponsorblock-api',
		'--sleep-requests',
		'--sleep-interval',
		'--max-sleep-interval',
		'--limit-rate',
		'--fragment-retries',
		'--retries',
		'--file-access-retries',
		'--force-ipv4',
		'--force-ipv6',
		'--geo-verification-proxy',
		'--geo-bypass',
		'--geo-bypass-country',
		'--geo-bypass-ip-block',
		'--yes-playlist',
		'--no-playlist',
		'--playlist-items',
		'--min-filesize',
		'--max-filesize',
		'--date',
		'--datebefore',
		'--dateafter',
		'--match-filter',
		'--extract-audio',
		'-x',
		'--split-chapters',
		'--concurrent-fragments',
		'-N',
		'--downloader',
		'--downloader-args',
		'--http-chunk-size'
	]);

	private isFlagAllowed(flag: string): boolean {
		if (!flag.startsWith('-')) return true;
		const baseFlag = flag.split('=')[0];
		return this.WHITELISTED_FLAGS.has(baseFlag);
	}

	findDangerousFlag(flags: string[]): string | null {
		for (const flag of flags) {
			if (/[;&|$`]/.test(flag)) {
				return flag;
			}
		}
		for (const flag of flags) {
			if (flag.startsWith('-') && !this.isFlagAllowed(flag)) {
				return flag;
			}
		}
		return null;
	}
	private ytdlpPath: string;
	private aria2cAvailableCache: boolean | null = null;

	constructor(ytdlpPath = '/usr/local/bin/yt-dlp') {
		this.ytdlpPath = ytdlpPath;
	}

	getPath(): string {
		return this.ytdlpPath;
	}

	async isAria2cAvailable(): Promise<boolean> {
		if (this.aria2cAvailableCache !== null) return this.aria2cAvailableCache;
		const available = await new Promise<boolean>((resolve) => {
			const p = spawn('aria2c', ['--version'], { stdio: 'ignore' });
			p.on('error', () => resolve(false));
			p.on('close', (code) => resolve(code === 0));
		});
		this.aria2cAvailableCache = available;
		return available;
	}

	/**
	 * Check if yt-dlp binary exists and is executable
	 */
	async ensureBinary(): Promise<boolean> {
		try {
			await fs.access(this.ytdlpPath, fs.constants.X_OK);
			return true;
		} catch {
			throw new Error(`yt-dlp not found at ${this.ytdlpPath}`);
		}
	}

	/**
	 * Get yt-dlp version
	 */
	async getVersion(): Promise<string> {
		return new Promise((resolve, reject) => {
			const proc = spawn(this.ytdlpPath, ['--version']);
			let output = '';

			proc.stdout.on('data', (data) => {
				output += data.toString();
			});

			proc.on('close', (code) => {
				if (code === 0) {
					resolve(output.trim());
				} else {
					reject(new Error('Failed to get yt-dlp version'));
				}
			});

			proc.on('error', (err) => reject(err));
		});
	}

	/**
	 * Validate URL format
	 */
	validateUrl(url: string): void {
		if (!url || typeof url !== 'string') {
			throw new Error('Invalid URL: must be a non-empty string');
		}

		// Validate URL format
		try {
			const urlObj = new URL(url);
			const allowedProtocols = ['http:', 'https:'];
			if (!allowedProtocols.includes(urlObj.protocol)) {
				throw new Error('Invalid URL: only HTTP(S) protocols allowed');
			}
		} catch {
			throw new Error('Invalid URL format');
		}
	}

	/**
	 * Fetch channel/playlist name from a URL
	 */
	async fetchChannelName(url: string): Promise<string | null> {
		this.validateUrl(url);
		return new Promise((resolve) => {
			const proc = spawn(this.ytdlpPath, [
				'--flat-playlist',
				'--playlist-items',
				'0',
				'-J',
				'--no-warnings',
				url,
			]);
			let output = '';

			proc.stdout.on('data', (data) => {
				output += data.toString();
			});

			proc.on('close', (code) => {
				if (code === 0) {
					try {
						const info = JSON.parse(output);
						const name = info.channel || info.uploader || null;
						resolve(name);
					} catch {
						resolve(null);
					}
				} else {
					resolve(null);
				}
			});

			proc.on('error', () => resolve(null));
		});
	}

	async fetchChannelThumbnail(channelUrl: string): Promise<Buffer | null> {
		this.validateUrl(channelUrl);
		return new Promise((resolve) => {
			const proc = spawn(this.ytdlpPath, [
				'--flat-playlist',
				'--playlist-items',
				'0',
				'-J',
				'--no-warnings',
				channelUrl,
			]);
			let output = '';

			proc.stdout.on('data', (data) => {
				output += data.toString();
			});

			proc.on('close', async (code) => {
				if (code !== 0) {
					resolve(null);
					return;
				}
				try {
					const info = JSON.parse(output);
					const thumbnails: { url: string; width?: number; height?: number }[] =
						info.thumbnails || [];
					const avatar = thumbnails.find((t) => {
						if (!t.width || !t.height) return false;
						const ratio = t.width / t.height;
						return ratio > 0.8 && ratio < 1.3;
					});
					const thumbUrl = avatar?.url || thumbnails[0]?.url;
					if (!thumbUrl) {
						resolve(null);
						return;
					}
					const res = await fetch(thumbUrl);
					if (!res.ok) {
						resolve(null);
						return;
					}
					resolve(Buffer.from(await res.arrayBuffer()));
				} catch {
					resolve(null);
				}
			});

			proc.on('error', () => resolve(null));
		});
	}

	/**
	 * Fetch video metadata using -J flag
	 */
	async fetchMetadata(
		url: string,
		options?: { cookiePath?: string | null; proxyUrl?: string | null; extraFlags?: string[] },
	): Promise<DownloadMetadata> {
		this.validateUrl(url);
		return new Promise((resolve, reject) => {
			const args = ['-J', '--no-warnings'];
			if (options?.cookiePath) {
				args.push('--cookies', options.cookiePath);
			}
			if (options?.proxyUrl) {
				args.push('--proxy', options.proxyUrl);
			}
			if (options?.extraFlags?.length) {
				args.push(...options.extraFlags);
			}
			args.push(url);
			const proc = spawn(this.ytdlpPath, args);
			let output = '';
			let error = '';

			proc.stdout.on('data', (data) => {
				output += data.toString();
			});

			proc.stderr.on('data', (data) => {
				error += data.toString();
			});

			proc.on('close', (code) => {
				if (code === 0) {
					try {
						const info = JSON.parse(output);

						let videoType: string | undefined;
						if (info.is_live || info.was_live) {
							videoType = 'stream';
						} else {
							// Shorts can be up to 3 minutes long and are frequently reached
							// via /watch/ URLs (channel tab listings), where the URL alone
							// doesn't identify them. A vertical video (9:16) under 3 minutes
							// is the reliable marker.
							const shortsUrl =
								info.webpage_url?.includes('/shorts/') || info.original_url?.includes('/shorts/');
							const vertical =
								typeof info.width === 'number' &&
								typeof info.height === 'number' &&
								info.height > info.width;
							const duration = typeof info.duration === 'number' ? info.duration : 0;
							videoType =
								shortsUrl || (vertical && duration > 0 && duration <= 180) ? 'short' : 'regular';
						}

						resolve({
							title: info.title,
							thumbnail: info.thumbnail,
							duration: info.duration,
							uploader: info.uploader || info.channel,
							channelUrl: info.channel_url || info.uploader_url || undefined,
							uploadDate: info.upload_date ? this.parseUploadDate(info.upload_date) : undefined,
							format: info.format,
							filesize: info.filesize ? BigInt(info.filesize) : undefined,
							artist: info.artist || info.creator || undefined,
							track: info.track || undefined,
							album: info.album || undefined,
							releaseYear: info.release_year || undefined,
							videoType,
							liveStatus: info.live_status ?? null,
							description: info.description || undefined,
							category: info.categories?.[0] || undefined,
							tags: info.tags?.length ? info.tags : undefined,
							videoId: info.id || undefined,
							height: info.height || undefined,
						});
					} catch (e) {
						reject(new Error(`Failed to parse metadata: ${e}`));
					}
				} else {
					reject(new Error(`yt-dlp failed: ${error}`));
				}
			});

			proc.on('error', (err) => reject(err));
		});
	}

	/**
	 * Sanitize filename template to prevent path traversal
	 */
	private sanitizeFilenameTemplate(template: string): string {
		// Remove path traversal attempts
		return template.replace(/\.\./g, '').replace(/\//g, '_').replace(/\\/g, '_');
	}

	private isYouTubeUrl(url: string): boolean {
		try {
			const host = new URL(url).hostname.toLowerCase();
			return (
				host.includes('youtube.com') ||
				host.includes('youtu.be') ||
				host.includes('youtube-nocookie.com')
			);
		} catch {
			return false;
		}
	}

	private static readonly SPONSORBLOCK_FLAGS = new Set([
		'--sponsorblock-mark',
		'--sponsorblock-remove',
		'--sponsorblock-chapter-title',
		'--sponsorblock-api',
	]);

	stripSponsorBlockFlags(flags: string[]): string[] {
		const result: string[] = [];
		for (let i = 0; i < flags.length; i++) {
			if (YtdlpService.SPONSORBLOCK_FLAGS.has(flags[i])) {
				if (i + 1 < flags.length && !flags[i + 1].startsWith('--')) {
					i++;
				}
				continue;
			}
			result.push(flags[i]);
		}
		return result;
	}

	/**
	 * Args carrying the global yt-dlp defaults (outbound proxy + extra default
	 * flags) for invocations that don't go through {@link buildArgs}. Extra
	 * flags pass through the same whitelist as per-download custom flags.
	 */
	buildDefaultsArgs(defaults: {
		proxyUrl?: string | null;
		extraFlags?: string[] | null;
	}): string[] {
		const args: string[] = [];
		if (defaults?.proxyUrl) {
			args.push('--proxy', defaults.proxyUrl);
		}
		if (defaults?.extraFlags?.length) {
			args.push(...defaults.extraFlags);
		}
		return args;
	}

	/**
	 * Build yt-dlp arguments from profile settings
	 */
	buildArgs(
		url: string,
		outputPath: string,
		customFlags: string[] = [],
		options?: {
			rateLimit?: string | null;
			sleepInterval?: number | null;
			cookiePath?: string | null;
			proxyUrl?: string | null;
			concurrentFragments?: number | null;
			useAria2c?: boolean;
			httpChunkSize?: string | null;
			aria2cAvailable?: boolean;
		},
	): string[] {
		this.validateUrl(url);

		const args = [
			// Progress template for JSON output
			'--newline',
			'--progress-template',
			'download:{"type":"download","filename":%(info._filename)j,"progress":{"status":"%(progress.status)s","progress":"%(progress._percent_str)s","speed":"%(progress._speed_str)s","eta":"%(progress._eta_str)s","downloaded":"%(progress.downloaded_bytes)s","total":"%(progress.total_bytes)s"}}',
			'--progress-template',
			'postprocess:{"type":"postprocess","module":"%(progress.postprocessor)s","status":"%(progress.status)s"}',
			// Output settings
			'-o',
			join(outputPath, '%(title)s.%(ext)s'),
			// Restrict filenames to prevent path traversal
			'--restrict-filenames',
			// Misc
			'--no-warnings',
			'--no-colors',
		];

		// Rate limiting
		if (options?.rateLimit) {
			args.push('--limit-rate', options.rateLimit);
		}
		if (options?.sleepInterval && options.sleepInterval > 0) {
			args.push('--sleep-interval', String(options.sleepInterval));
		}

		// Concurrent fragment downloads (biggest free speedup for DASH/HLS)
		if (options?.concurrentFragments && options.concurrentFragments > 1) {
			args.push('--concurrent-fragments', String(options.concurrentFragments));
		}
		// HTTP chunk size tuning for large sequential downloads
		if (options?.httpChunkSize) {
			args.push('--http-chunk-size', options.httpChunkSize);
		}
		// External downloader (aria2c) when enabled and present on PATH
		if (options?.useAria2c && options.aria2cAvailable) {
			args.push('--downloader', 'aria2c', '--downloader-args', 'aria2c:-x16 -s16 -k1M');
		}

		// Add cookie authentication if configured
		if (options?.cookiePath) {
			args.push('--cookies', options.cookiePath);
		}

		// Route through the configured outbound proxy (SOCKS/HTTP)
		if (options?.proxyUrl) {
			args.push('--proxy', options.proxyUrl);
		}

		// Add custom flags
		if (customFlags.length > 0) {
			let finalFlags = [...customFlags];
			if (!this.isYouTubeUrl(url)) {
				finalFlags = this.stripSponsorBlockFlags(finalFlags);
			}
			// Strip --embed-subs if audio-only to prevent ffmpeg errors
			const hasExtractAudio = finalFlags.includes('--extract-audio') || finalFlags.includes('-x');
			if (hasExtractAudio) {
				const embedSubsIdx = finalFlags.indexOf('--embed-subs');
				if (embedSubsIdx !== -1) {
					console.log('[YtdlpService] Removing --embed-subs for audio-only download');
					finalFlags.splice(embedSubsIdx, 1);
				}
			}
			args.push(...finalFlags);
		}

		args.push(url);
		return args;
	}

	/**
	 * Spawn yt-dlp download process
	 */
	spawnDownload(
		args: string[],
		onProgress?: (data: any) => void,
		onError?: (error: string) => void,
	): ChildProcess {
		const proc = spawn(this.ytdlpPath, args, {
			detached: true,
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		if (proc.stdout) {
			proc.stdout.on('data', (chunk) => {
				const lines = chunk.toString().split('\n');
				for (const line of lines) {
					if (!line.trim()) continue;

					try {
						const data = JSON.parse(line);
						
						if (data.type === 'download') {
							if (data.filename && onProgress) {
								onProgress({ type: 'destination', filepath: data.filename });
							}
							if (data.progress && onProgress) {
								onProgress(data.progress);
							}
						} else if (data.type === 'postprocess') {
							const module = data.module;
							if (module && onProgress) {
								const ignoredModules = new Set([
									'download',
									'info',
									'debug',
									'generic',
									'youtube',
									'youtube:tab',
								]);
								if (!ignoredModules.has(module)) {
									const stepMap: Record<string, string> = {
										SponsorBlock: 'SponsorBlock',
										ModifyChapters: 'Removing chapters',
										Merger: 'Merging formats',
										Metadata: 'Embedding metadata',
										EmbedSubtitle: 'Embedding subtitles',
										EmbedThumbnail: 'Embedding thumbnail',
										ExtractAudio: 'Extracting audio',
										FFmpegVideoConvertor: 'Converting video',
										FFmpegMetadata: 'Embedding metadata',
										ThumbnailsConvertor: 'Converting thumbnail',
										FixupM3u8: 'Fixing container',
										FixupDuplicateMoov: 'Fixing container',
										FixupStretchedRatio: 'Fixing aspect ratio',
									};
									const step = stepMap[module] || `Processing (${module})`;
									onProgress({ type: 'postprocess', step, module });
								}
							}
						} else {
							// Fallback for other JSON types or legacy format
							if (onProgress) onProgress(data);
						}
					} catch {
						// Non-JSON line (e.g. from generic yt-dlp logging)
						console.log('[yt-dlp]', line);
					}
				}
			});
		}

		if (proc.stderr) {
			proc.stderr.on('data', (chunk) => {
				const lines = chunk.toString().split('\n');
				for (const line of lines) {
					if (!line.trim()) continue;



					console.error('[yt-dlp error]', line);
					if (onError) onError(line);
				}
			});
		}

		return proc;
	}

	/**
	 * Kill a yt-dlp process and its children
	 */
	async killProcess(proc: ChildProcess): Promise<void> {
		if (!proc.pid) return;

		try {
			// Kill the process group (negative PID)
			process.kill(-proc.pid, 'SIGTERM');

			// Wait 5 seconds, then force kill
			await new Promise((resolve) => setTimeout(resolve, 5000));

			if (!proc.killed) {
				process.kill(-proc.pid, 'SIGKILL');
			}
		} catch (e) {
			console.error('Failed to kill process:', e);
		}
	}

	/**
	 * Parse upload date from YYYYMMDD format
	 */
	private parseUploadDate(dateStr: string): Date {
		const year = parseInt(dateStr.substring(0, 4));
		const month = parseInt(dateStr.substring(4, 6)) - 1;
		const day = parseInt(dateStr.substring(6, 8));
		return new Date(year, month, day);
	}

	/**
	 * Update yt-dlp binary
	 */
	async updateBinary(): Promise<string> {
		return new Promise((resolve, reject) => {
			const proc = spawn(this.ytdlpPath, ['-U']);
			let output = '';
			let error = '';

			proc.stdout.on('data', (data) => {
				output += data.toString();
			});

			proc.stderr.on('data', (data) => {
				error += data.toString();
			});

			proc.on('close', (code) => {
				if (code === 0) {
					resolve(output);
				} else {
					reject(new Error(`Failed to update yt-dlp: ${error}`));
				}
			});

			proc.on('error', (err) => reject(err));
		});
	}
}

// Singleton instance
export const ytdlpService = new YtdlpService();
