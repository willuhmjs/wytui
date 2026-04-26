import { spawn, type ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import type { DownloadMetadata } from '$lib/types';

export class YtdlpService {
	private ytdlpPath: string;

	constructor(ytdlpPath = '/usr/local/bin/yt-dlp') {
		this.ytdlpPath = ytdlpPath;
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
		});
	}

	/**
	 * Validate URL to prevent command injection
	 */
	private validateUrl(url: string): void {
		if (!url || typeof url !== 'string') {
			throw new Error('Invalid URL: must be a non-empty string');
		}

		// Check for command injection attempts
		const dangerousPatterns = [';', '&&', '||', '|', '$', '`', '\n', '\r'];
		for (const pattern of dangerousPatterns) {
			if (url.includes(pattern)) {
				throw new Error('Invalid URL: contains forbidden characters');
			}
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
	 * Fetch video metadata using -J flag
	 */
	async fetchMetadata(url: string): Promise<DownloadMetadata> {
		this.validateUrl(url);
		return new Promise((resolve, reject) => {
			const proc = spawn(this.ytdlpPath, ['-J', '--no-warnings', url]);
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
						resolve({
							title: info.title,
							thumbnail: info.thumbnail,
							duration: info.duration,
							uploader: info.uploader || info.channel,
							uploadDate: info.upload_date ? this.parseUploadDate(info.upload_date) : undefined,
							format: info.format,
							filesize: info.filesize ? BigInt(info.filesize) : undefined,
						});
					} catch (e) {
						reject(new Error(`Failed to parse metadata: ${e}`));
					}
				} else {
					reject(new Error(`yt-dlp failed: ${error}`));
				}
			});
		});
	}

	/**
	 * Filter dangerous flags from custom flags
	 */
	private filterDangerousFlags(flags: string[]): string[] {
		const dangerousFlags = [
			'--exec',
			'--exec-before-download',
			'--config-location',
			'--config-locations',
			'--batch-file',
			'--load-info-json',
			'--cookies-from-browser',
		];

		const dangerousPatterns = [
			/--exec/i,
			/--config/i,
			/--batch/i,
			/--load-info/i,
			/[;&|$`]/,  // Shell metacharacters
		];

		return flags.filter((flag) => {
			// Check against dangerous flags list
			if (dangerousFlags.some((df) => flag.toLowerCase().startsWith(df))) {
				console.warn(`Filtered dangerous flag: ${flag}`);
				return false;
			}

			// Check against patterns
			if (dangerousPatterns.some((pattern) => pattern.test(flag))) {
				console.warn(`Filtered dangerous flag: ${flag}`);
				return false;
			}

			return true;
		});
	}

	/**
	 * Sanitize filename template to prevent path traversal
	 */
	private sanitizeFilenameTemplate(template: string): string {
		// Remove path traversal attempts
		return template.replace(/\.\./g, '').replace(/\//g, '_').replace(/\\/g, '_');
	}

	/**
	 * Build yt-dlp arguments from profile settings
	 */
	buildArgs(
		url: string,
		outputPath: string,
		customFlags: string[] = []
	): string[] {
		this.validateUrl(url);

		const args = [
			// Progress template for JSON output
			'--newline',
			'--progress',
			'--progress-template',
			'{"status":"downloading","progress":"%(progress._percent_str)s","speed":"%(progress._speed_str)s","eta":"%(progress._eta_str)s","downloaded":"%(progress.downloaded_bytes)s","total":"%(progress.total_bytes)s"}',
			// Output settings
			'-o',
			join(outputPath, '%(title)s.%(ext)s'),
			// Restrict filenames to prevent path traversal
			'--restrict-filenames',
			// Misc
			'--no-warnings',
			'--no-colors',
		];

		// Add custom flags with filtering
		if (customFlags.length > 0) {
			const safeFlags = this.filterDangerousFlags(customFlags);
			args.push(...safeFlags);
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
		onError?: (error: string) => void
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
						if (onProgress) onProgress(data);
					} catch {
						// Non-JSON line, could be regular output or destination info
						console.log('[yt-dlp]', line);

						// Check if this is a destination line: [download] Destination: /path/to/file.ext
						if (line.includes('[download] Destination:')) {
							const match = line.match(/\[download\] Destination: (.+)/);
							if (match && onProgress) {
								onProgress({ type: 'destination', filepath: match[1].trim() });
							}
						}
						// Check if this is a merge line: [Merger] Merging formats into "/path/to/file.ext"
						else if (line.includes('[Merger] Merging formats into')) {
							const match = line.match(/\[Merger\] Merging formats into "(.+)"/);
							if (match && onProgress) {
								onProgress({ type: 'destination', filepath: match[1].trim() });
							}
						}
					}
				}
			});
		}

		if (proc.stderr) {
			proc.stderr.on('data', (chunk) => {
				const error = chunk.toString();
				console.error('[yt-dlp error]', error);
				if (onError) onError(error);
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
		});
	}
}

// Singleton instance
export const ytdlpService = new YtdlpService();
