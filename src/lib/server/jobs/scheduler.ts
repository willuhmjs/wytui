import cron, { type ScheduledTask } from 'node-cron';
import { subscriptionService } from '../services/subscription.service';
import { monitorService } from '../services/monitor.service';
import { ytdlpService } from '../services/ytdlp.service';
import { libraryService } from '../services/library.service';
import { prisma } from '../db';

class JobScheduler {
	private ytdlpUpdateTask: ScheduledTask | null = null;
	private cacheCleanupTask: ScheduledTask | null = null;

	/**
	 * Start all background jobs
	 */
	async start(): Promise<void> {
		console.log('[Scheduler] Starting background jobs...');

		// Start subscription monitoring
		await subscriptionService.startScheduler();

		// Start livestream monitoring
		await monitorService.startMonitoring();

		// Schedule yt-dlp updates (daily at 3 AM)
		this.ytdlpUpdateTask = cron.schedule('0 3 * * *', async () => {
			await this.checkYtdlpUpdate();
		});

		// Schedule cache quota enforcement and file reconciliation (every 5 minutes)
		this.cacheCleanupTask = cron.schedule('*/5 * * * *', async () => {
			try {
				await libraryService.reconcileFiles();
				await libraryService.enforceCacheQuota();
			} catch (error) {
				console.error('[Scheduler] Cache cleanup/reconciliation failed:', error);
			}
		});

		console.log('[Scheduler] All background jobs started');
	}

	/**
	 * Check and update yt-dlp if needed
	 */
	private async checkYtdlpUpdate(): Promise<void> {
		try {
			const settings = await prisma.settings.findUnique({
				where: { id: 'singleton' },
			});

			if (!settings || !settings.autoUpdateYtdlp) {
				return;
			}

			console.log('[Scheduler] Checking for yt-dlp updates...');

			const currentVersion = await ytdlpService.getVersion();
			const updateOutput = await ytdlpService.updateBinary();

			const newVersion = await ytdlpService.getVersion();

			if (currentVersion !== newVersion) {
				console.log(`[Scheduler] Updated yt-dlp: ${currentVersion} → ${newVersion}`);

				await prisma.settings.update({
					where: { id: 'singleton' },
					data: {
						ytdlpVersion: newVersion,
						lastYtdlpUpdate: new Date(),
					},
				});
			} else {
				console.log('[Scheduler] yt-dlp is up to date');
			}
		} catch (error) {
			console.error('[Scheduler] yt-dlp update failed:', error);
		}
	}

	/**
	 * Stop all background jobs
	 */
	stop(): void {
		console.log('[Scheduler] Stopping background jobs...');

		subscriptionService.stopAll();
		monitorService.stopAll();

		if (this.ytdlpUpdateTask) {
			this.ytdlpUpdateTask.stop();
			this.ytdlpUpdateTask = null;
		}

		if (this.cacheCleanupTask) {
			this.cacheCleanupTask.stop();
			this.cacheCleanupTask = null;
		}

		console.log('[Scheduler] All background jobs stopped');
	}
}

// Singleton instance
export const jobScheduler = new JobScheduler();
