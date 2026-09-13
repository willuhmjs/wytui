import { prisma } from '../db';
import { downloadService } from './download.service';
import { ytdlpService } from './ytdlp.service';
import { subscriptionService } from './subscription.service';
import { sseEmitter } from '../sse/emitter';
import { spawn, type ChildProcess } from 'child_process';
import { isRateLimitedError, isAuthError } from '../utils/ytdlp-json';
import type { Monitor } from '@prisma/client';

class MonitorService {
	private activeMonitors = new Map<string, ChildProcess>();
	private checkInterval: NodeJS.Timeout | null = null;
	private restartCounts = new Map<string, number>();
	private static MAX_RESTARTS = 10;
	private static MAX_BACKOFF_MS = 300000; // 5 minutes

	/**
	 * Start monitor service
	 */
	async startMonitoring(): Promise<void> {
		console.log('[Monitors] Starting monitoring service...');

		// Load all enabled monitors
		const monitors = await prisma.monitor.findMany({
			where: { enabled: true },
			include: { profile: true },
		});

		for (const monitor of monitors) {
			await this.startMonitor(monitor);
		}

		// Start periodic check for monitor status
		this.checkInterval = setInterval(() => {
			this.checkAllMonitors();
		}, 60000); // Check every minute

		console.log(`[Monitors] Started monitoring ${monitors.length} streams`);
	}

	/**
	 * Start monitoring a stream
	 */
	async startMonitor(monitor: any): Promise<void> {
		// Stop existing monitor if any
		this.stopMonitor(monitor.id);

		if (monitor.type === 'YOUTUBE_LIVE') {
			await this.startYouTubeMonitor(monitor);
		} else if (monitor.type === 'TWITCH') {
			// Twitch monitoring via API polling (simpler than yt-dlp)
			await this.startTwitchMonitor(monitor);
		}
	}

	/**
	 * Start YouTube livestream monitor
	 */
	private async startYouTubeMonitor(monitor: any): Promise<void> {
		ytdlpService.validateUrl(monitor.url);

		// Route monitor traffic through the same per-account proxy/flags as
		// subscriptions and downloads — unproxied monitor polls from the bare
		// server IP are a classic bot-check trigger.
		const defaults = await subscriptionService
			.getYtdlpDefaults({ userId: monitor.userId })
			.catch(() => ({ proxyUrl: null, extraFlags: [] }));

		const args = [
			'--wait-for-video',
			'30',
			'--simulate',
			'--no-warnings',
			...ytdlpService.buildDefaultsArgs(defaults),
			monitor.url,
		];

		const proc = spawn(ytdlpService.getPath(), args, {
			detached: true,
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		this.activeMonitors.set(monitor.id, proc);

		proc.stdout.on('data', (data) => {
			const output = data.toString();
			console.log(`[Monitor ${monitor.name}] ${output}`);

			// Async work in an event callback becomes an unhandled rejection
			// if it throws — route it through .catch explicitly.
			void this.handleMonitorOutput(monitor, output).catch((err) => {
				console.error(`[Monitor ${monitor.name}] Output handling failed:`, err);
			});
		});

		proc.stderr.on('data', (data) => {
			const text = data.toString();
			console.error(`[Monitor ${monitor.name}] Error: ${text}`);
			if (isRateLimitedError(text) || isAuthError(text)) {
				console.error(
					`[Monitor ${monitor.name}] yt-dlp reported ${isRateLimitedError(text) ? 'a rate limit' : 'an auth failure'} — monitor polling is degraded`,
				);
			}
		});

		proc.on('close', (code) => {
			this.activeMonitors.delete(monitor.id);
			console.log(`[Monitor ${monitor.name}] Process exited with code ${code}`);

			// Restart if still enabled
			this.restartMonitorIfEnabled(monitor.id);
		});

		proc.on('error', (err) => {
			this.activeMonitors.delete(monitor.id);
			console.error(`[Monitor ${monitor.name}] Process error:`, err);

			// Restart if still enabled (same cleanup path as 'close')
			this.restartMonitorIfEnabled(monitor.id);
		});
	}

	/**
	 * React to a --wait-for-video stdout chunk: detect the stream going live
	 * and surface the next-attempt countdown.
	 */
	private async handleMonitorOutput(monitor: any, output: string): Promise<void> {
		this.restartCounts.delete(monitor.id);

		if (output.includes('is live')) {
			await this.handleStreamLive(monitor);
		} else if (output.includes('Remaining time until next attempt')) {
			const waitTime = this.parseWaitTime(output);
			if (waitTime) {
				await this.updateMonitorStatus(monitor.id, {
					waitTime,
					liveDate: new Date(Date.now() + waitTime * 1000),
				});
			}
		}
	}

	/**
	 * Start Twitch monitor (API polling)
	 */
	private async startTwitchMonitor(monitor: any): Promise<void> {
		// For Twitch, we'll check via periodic polling rather than spawning a process
		// This is handled in checkAllMonitors
		console.log(`[Monitor ${monitor.name}] Twitch monitoring via API polling`);
	}

	/**
	 * Stop monitoring a stream
	 */
	stopMonitor(monitorId: string): void {
		const proc = this.activeMonitors.get(monitorId);
		if (proc) {
			proc.kill('SIGTERM');
			this.activeMonitors.delete(monitorId);
		}
		this.restartCounts.delete(monitorId);
	}

	/**
	 * Handle stream going live
	 */
	private async handleStreamLive(monitor: any): Promise<void> {
		console.log(`[Monitor ${monitor.name}] STREAM IS LIVE!`);

		// Update monitor status
		await prisma.monitor.update({
			where: { id: monitor.id },
			data: {
				isLive: true,
				lastChecked: new Date(),
			},
		});

		// Broadcast event
		sseEmitter.broadcast('monitor:live', {
			id: monitor.id,
			name: monitor.name,
			isLive: true,
		});

		// Auto-download if enabled
		if (monitor.autoDownload) {
			await downloadService.createDownload(
				monitor.url,
				monitor.profileId,
				undefined,
				undefined,
				false,
				monitor.customFlags?.length ? monitor.customFlags : undefined,
			);
			console.log(`[Monitor ${monitor.name}] Started download`);
		}

		// Stop monitoring this stream (it's now live)
		this.stopMonitor(monitor.id);

		setTimeout(async () => {
			try {
				const current = await prisma.monitor.findUnique({ where: { id: monitor.id } });
				if (current?.isLive) {
					await prisma.monitor.update({
						where: { id: monitor.id },
						data: { isLive: false },
					});
				}
			} catch {
				// Monitor may have been deleted
			}
		}, 3600000);
	}

	/**
	 * Parse wait time from yt-dlp output
	 */
	private parseWaitTime(output: string): number | null {
		// Format: "Remaining time until next attempt: HH:MM:SS"
		const match = output.match(/Remaining time until next attempt: (\d+):(\d+):(\d+)/);
		if (match) {
			const hours = parseInt(match[1]);
			const minutes = parseInt(match[2]);
			const seconds = parseInt(match[3]);
			return hours * 3600 + minutes * 60 + seconds;
		}
		return null;
	}

	/**
	 * Update monitor status
	 */
	private async updateMonitorStatus(monitorId: string, data: any): Promise<void> {
		await prisma.monitor.update({
			where: { id: monitorId },
			data: {
				...data,
				lastChecked: new Date(),
			},
		});

		// Broadcast update
		sseEmitter.broadcast('monitor:update', {
			id: monitorId,
			...data,
		});
	}

	/**
	 * Check all monitors
	 */
	private async checkAllMonitors(): Promise<void> {
		const monitors = await prisma.monitor.findMany({
			where: { enabled: true, type: 'TWITCH' },
		});

		for (const monitor of monitors) {
			await this.checkTwitchStream(monitor);
		}
	}

	/**
	 * Check Twitch stream status via simple URL check
	 */
	private async checkTwitchStream(monitor: any): Promise<void> {
		try {
			ytdlpService.validateUrl(monitor.url);
			const defaults = await subscriptionService
				.getYtdlpDefaults({ userId: monitor.userId })
				.catch(() => ({ proxyUrl: null, extraFlags: [] }));
			const args = [
				'--simulate',
				'--get-title',
				'--no-warnings',
				...ytdlpService.buildDefaultsArgs(defaults),
				monitor.url,
			];
			const proc = spawn(ytdlpService.getPath(), args);

			let error = '';
			proc.stderr.on('data', (data) => {
				error += data.toString();
			});

			// Bound the check: a hung spawn would hold this monitor's state.
			const timeout = setTimeout(() => {
				try {
					proc.kill('SIGKILL');
				} catch {}
			}, 60000);
			proc.on('close', () => clearTimeout(timeout));

			proc.on('close', async (code) => {
				// A failed check is not evidence the stream ended — a rate limit,
				// auth failure, or network blip must not flip an active stream
				// to offline. Only a clean "no title" exit counts.
				if (code !== 0) {
					if (isRateLimitedError(error) || isAuthError(error)) {
						console.error(
							`[Monitor ${monitor.name}] Check failed (${isRateLimitedError(error) ? 'rate limited' : 'auth failure'}), keeping state`,
						);
					} else {
						console.error(
							`[Monitor ${monitor.name}] Check failed: ${error.trim().slice(-300) || `exit code ${code}`}`,
						);
						if (monitor.isLive) {
							await prisma.monitor.update({
								where: { id: monitor.id },
								data: { isLive: false },
							});
						}
					}
					return;
				}
				if (!monitor.isLive) {
					// Stream is live and wasn't before
					await this.handleStreamLive(monitor);
				}
			});

			proc.on('error', (err) => {
				console.error(`[Monitor ${monitor.name}] Check process error:`, err);
			});
		} catch (error) {
			console.error(`[Monitor ${monitor.name}] Check failed:`, error);
		}
	}

	/**
	 * Restart monitor if still enabled, with exponential backoff
	 */
	private async restartMonitorIfEnabled(monitorId: string): Promise<void> {
		const monitor = await prisma.monitor.findUnique({
			where: { id: monitorId },
			include: { profile: true },
		});

		if (!monitor || !monitor.enabled || monitor.isLive) return;

		const count = (this.restartCounts.get(monitorId) || 0) + 1;
		this.restartCounts.set(monitorId, count);

		if (count > MonitorService.MAX_RESTARTS) {
			console.error(
				`[Monitor ${monitor.name}] Max restarts (${MonitorService.MAX_RESTARTS}) exceeded, disabling`,
			);
			await prisma.monitor.update({
				where: { id: monitorId },
				data: { enabled: false },
			});
			this.restartCounts.delete(monitorId);
			return;
		}

		const delay = Math.min(5000 * Math.pow(2, count - 1), MonitorService.MAX_BACKOFF_MS);
		console.log(
			`[Monitor ${monitor.name}] Restarting in ${Math.round(delay / 1000)}s (attempt ${count}/${MonitorService.MAX_RESTARTS})`,
		);
		setTimeout(() => {
			this.startMonitor(monitor);
		}, delay);
	}

	/**
	 * Stop all monitors
	 */
	stopAll(): void {
		for (const [id, proc] of this.activeMonitors.entries()) {
			proc.kill('SIGTERM');
		}
		this.activeMonitors.clear();

		if (this.checkInterval) {
			clearInterval(this.checkInterval);
			this.checkInterval = null;
		}

		console.log('[Monitors] Stopped all monitors');
	}
}

// Singleton instance
export const monitorService = new MonitorService();
