import cron, { type ScheduledTask } from 'node-cron';
import { subscriptionService } from '../services/subscription.service';
import { monitorService } from '../services/monitor.service';
import { ytdlpService } from '../services/ytdlp.service';
import { libraryService } from '../services/library.service';
import { cleanupService } from '../services/cleanup.service';
import { prisma } from '../db';
import { autoDeleteService } from '../services/auto-delete.service';
import { backupService } from '../services/backup.service';
import { youtubeSyncService } from '../services/youtube-sync.service';

export interface JobInfo {
	name: string;
	cron: string;
	enabled: boolean;
	description: string;
}

class JobScheduler {
	private ytdlpUpdateTask: ScheduledTask | null = null;
	private cacheCleanupTask: ScheduledTask | null = null;
	private watchedCleanupTask: ScheduledTask | null = null;
	private autoDeleteTask: ScheduledTask | null = null;
	private backupTask: ScheduledTask | null = null;
	private youtubeSyncTask: ScheduledTask | null = null;

	private jobRegistry = new Map<string, JobInfo>();

	/** Names of jobs currently executing, to prevent overlapping runs piling up. */
	private runningJobs = new Set<string>();

	/**
	 * Log a job run to the database
	 */
	private async logJobRun(jobName: string, fn: () => Promise<void>): Promise<void> {
		// Skip if a previous run of this job is still in flight (e.g. a slow cache-cleanup
		// on a large library that takes longer than its 5-minute interval).
		if (this.runningJobs.has(jobName)) {
			console.warn(`[Scheduler] Skipping ${jobName}: previous run still in progress`);
			return;
		}
		this.runningJobs.add(jobName);

		const run = await prisma.scheduledJobRun.create({
			data: { jobName, status: 'running' },
		});

		try {
			await fn();
			await prisma.scheduledJobRun.update({
				where: { id: run.id },
				data: { status: 'completed', endedAt: new Date() },
			});
		} catch (error: any) {
			await prisma.scheduledJobRun.update({
				where: { id: run.id },
				data: {
					status: 'failed',
					endedAt: new Date(),
					error: error?.message || String(error),
				},
			});
			throw error;
		} finally {
			this.runningJobs.delete(jobName);
		}
	}

	/**
	 * Start all background jobs
	 */
	async start(): Promise<void> {
		console.log('[Scheduler] Starting background jobs...');

		// Start subscription monitoring
		await subscriptionService.startScheduler();

		this.jobRegistry.set('subscription-check', {
			name: 'subscription-check',
			cron: '*/30 * * * *',
			enabled: true,
			description: 'Check subscriptions for new content',
		});

		// Start livestream monitoring
		await monitorService.startMonitoring();

		this.jobRegistry.set('monitor-check', {
			name: 'monitor-check',
			cron: '*/5 * * * *',
			enabled: true,
			description: 'Monitor livestreams',
		});

		// Schedule yt-dlp updates (daily at 3 AM)
		this.ytdlpUpdateTask = cron.schedule('0 3 * * *', async () => {
			await this.logJobRun('ytdlp-update', () => this.checkYtdlpUpdate());
		});

		this.jobRegistry.set('ytdlp-update', {
			name: 'ytdlp-update',
			cron: '0 3 * * *',
			enabled: true,
			description: 'Auto-update yt-dlp binary',
		});

		// Schedule auto-delete of watched downloads (hourly)
		this.autoDeleteTask = cron.schedule('0 * * * *', async () => {
			await this.logJobRun('auto-delete', async () => {
				const result = await autoDeleteService.deleteWatchedOverThreshold();
				if (result.deleted > 0) {
					console.log(`[Scheduler] AutoDelete: deleted ${result.deleted} watched download(s)`);
				}
			});
		});

		this.jobRegistry.set('auto-delete', {
			name: 'auto-delete',
			cron: '0 * * * *',
			enabled: true,
			description: 'Delete watched videos past retention period',
		});

		// Schedule cache quota enforcement and file reconciliation (every 5 minutes)
		this.cacheCleanupTask = cron.schedule('*/5 * * * *', async () => {
			await this.logJobRun('cache-cleanup', async () => {
				await libraryService.reconcileFiles();
				await libraryService.enforceCacheQuota();
			});
		});

		this.jobRegistry.set('cache-cleanup', {
			name: 'cache-cleanup',
			cron: '*/5 * * * *',
			enabled: true,
			description: 'Reconcile files and enforce cache quota',
		});

		// Schedule YouTube sync (every 30 minutes)
		this.youtubeSyncTask = cron.schedule('*/30 * * * *', async () => {
			await this.logJobRun('youtube-sync', async () => {
				await youtubeSyncService.runOnce();
			});
		});

		this.jobRegistry.set('youtube-sync', {
			name: 'youtube-sync',
			cron: '*/30 * * * *',
			enabled: true,
			description: 'Sync YouTube watch history and watched status',
		});

		// Schedule automated backups if enabled
		await this.startBackupTask();

		// Schedule watched item cleanup
		await this.restartCleanupTask();

		console.log('[Scheduler] All background jobs started');
	}

	/**
	 * Get all registered jobs
	 */
	getJobs(): JobInfo[] {
		return Array.from(this.jobRegistry.values());
	}

	/**
	 * Manually trigger a job by name
	 */
	async runJob(jobName: string): Promise<void> {
		await this.logJobRun(jobName, async () => {
			switch (jobName) {
				case 'ytdlp-update':
					await this.checkYtdlpUpdate();
					break;

				case 'auto-delete':
					await autoDeleteService.deleteWatchedOverThreshold();
					break;

				case 'cache-cleanup':
					await libraryService.reconcileFiles();
					await libraryService.enforceCacheQuota();
					break;

				case 'subscription-check': {
					const subscriptions = await prisma.subscription.findMany({
						where: { enabled: true },
					});
					for (const sub of subscriptions) {
						await subscriptionService.checkSubscription(sub.id);
					}
					break;
				}

				case 'monitor-check': {
					// Restart monitoring to re-check all monitors
					monitorService.stopAll();
					await monitorService.startMonitoring();
					break;
				}

				case 'backup': {
					const backup = await backupService.createBackup('manual');
					console.log(`[Scheduler] Manual backup created: ${backup.filename}`);
					break;
				}

				case 'youtube-sync':
					await youtubeSyncService.runOnce();
					break;

				default:
					throw new Error(`Unknown job: ${jobName}`);
			}
		});
	}

	/**
	 * Start (or restart) the backup cron task based on settings
	 */
	private async startBackupTask(): Promise<void> {
		// Stop existing task if running
		if (this.backupTask) {
			this.backupTask.stop();
			this.backupTask = null;
		}

		const settings = await prisma.settings.findUnique({
			where: { id: 'singleton' },
		});

		if (settings?.backupEnabled && settings.backupCron) {
			if (!cron.validate(settings.backupCron)) {
				console.error(`[Scheduler] Invalid backup cron expression: ${settings.backupCron}`);
				return;
			}

			this.backupTask = cron.schedule(settings.backupCron, async () => {
				await this.logJobRun('backup', async () => {
					console.log('[Scheduler] Running scheduled backup...');
					const backup = await backupService.createBackup('scheduled');
					console.log(`[Scheduler] Backup created: ${backup.filename}`);
				});
			});

			this.jobRegistry.set('backup', {
				name: 'backup',
				cron: settings.backupCron,
				enabled: true,
				description: 'Automated database backup',
			});

			console.log(`[Scheduler] Backup task scheduled: ${settings.backupCron}`);
		} else {
			this.jobRegistry.set('backup', {
				name: 'backup',
				cron: settings?.backupCron || '0 2 * * *',
				enabled: false,
				description: 'Automated database backup',
			});
		}
	}

	/**
	 * Check and update yt-dlp if needed
	 */
	private async checkYtdlpUpdate(): Promise<void> {
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
	}

	async restartCleanupTask(): Promise<void> {
		if (this.watchedCleanupTask) {
			this.watchedCleanupTask.stop();
			this.watchedCleanupTask = null;
		}

		const settings = await prisma.settings.findUnique({
			where: { id: 'singleton' },
		});

		if (!settings?.cleanupEnabled) return;

		const intervalSeconds = settings.cleanupIntervalSeconds || 3600;
		const cronExpr = this.secondsToCronInterval(intervalSeconds);

		this.watchedCleanupTask = cron.schedule(cronExpr, async () => {
			try {
				await cleanupService.runCleanup();
			} catch (error) {
				console.error('[Scheduler] Watched item cleanup failed:', error);
			}
		});

		console.log(`[Scheduler] Watched item cleanup scheduled (every ${intervalSeconds}s)`);
	}

	private secondsToCronInterval(seconds: number): string {
		const minutes = Math.max(1, Math.round(seconds / 60));
		if (minutes < 60) return `*/${minutes} * * * *`;
		const hours = Math.round(minutes / 60);
		if (hours < 24) return `0 */${hours} * * *`;
		return `0 0 */${Math.round(hours / 24)} * *`;
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

		if (this.watchedCleanupTask) {
			this.watchedCleanupTask.stop();
			this.watchedCleanupTask = null;
		}

		if (this.autoDeleteTask) {
			this.autoDeleteTask.stop();
			this.autoDeleteTask = null;
		}

		if (this.backupTask) {
			this.backupTask.stop();
			this.backupTask = null;
		}

		if (this.youtubeSyncTask) {
			this.youtubeSyncTask.stop();
			this.youtubeSyncTask = null;
		}

		console.log('[Scheduler] All background jobs stopped');
	}
}

// Singleton instance
export const jobScheduler = new JobScheduler();
