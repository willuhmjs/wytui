import { prisma } from '../db';
import { downloadService } from './download.service';
import { ytdlpService } from './ytdlp.service';
import { sseEmitter } from '../sse/emitter';
import { spawn, type ChildProcess } from 'child_process';
import type { Monitor } from '@prisma/client';

class MonitorService {
	private activeMonitors = new Map<string, ChildProcess>();
	private checkInterval: NodeJS.Timeout | null = null;

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

		const args = [
			'--wait-for-video', '30',
			'--simulate',
			'--no-warnings',
			monitor.url,
		];

		const proc = spawn(ytdlpService.getPath(), args, {
			detached: true,
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		this.activeMonitors.set(monitor.id, proc);

		proc.stdout.on('data', async (data) => {
			const output = data.toString();
			console.log(`[Monitor ${monitor.name}] ${output}`);

			// Check for live status or wait time
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
		});

		proc.stderr.on('data', (data) => {
			console.error(`[Monitor ${monitor.name}] Error: ${data.toString()}`);
		});

		proc.on('close', (code) => {
			this.activeMonitors.delete(monitor.id);
			console.log(`[Monitor ${monitor.name}] Process exited with code ${code}`);

			// Restart if still enabled
			this.restartMonitorIfEnabled(monitor.id);
		});
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
				undefined
			);
			console.log(`[Monitor ${monitor.name}] Started download`);
		}

		// Stop monitoring this stream (it's now live)
		this.stopMonitor(monitor.id);

		// Mark as not live after a delay (assume stream ends)
		setTimeout(async () => {
			await prisma.monitor.update({
				where: { id: monitor.id },
				data: { isLive: false },
			});
		}, 3600000); // 1 hour
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
			const args = ['--simulate', '--get-title', monitor.url];
			const proc = spawn(ytdlpService.getPath(), args);

			let success = false;

			proc.on('close', async (code) => {
				if (code === 0 && !monitor.isLive) {
					// Stream is live and wasn't before
					await this.handleStreamLive(monitor);
				} else if (code !== 0 && monitor.isLive) {
					// Stream ended
					await prisma.monitor.update({
						where: { id: monitor.id },
						data: { isLive: false },
					});
				}
			});
		} catch (error) {
			console.error(`[Monitor ${monitor.name}] Check failed:`, error);
		}
	}

	/**
	 * Restart monitor if still enabled
	 */
	private async restartMonitorIfEnabled(monitorId: string): Promise<void> {
		const monitor = await prisma.monitor.findUnique({
			where: { id: monitorId },
			include: { profile: true },
		});

		if (monitor && monitor.enabled && !monitor.isLive) {
			console.log(`[Monitor ${monitor.name}] Restarting...`);
			setTimeout(() => {
				this.startMonitor(monitor);
			}, 5000); // Wait 5 seconds before restart
		}
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
