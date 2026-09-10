import { CronExpressionParser } from 'cron-parser';
import { subscriptionService } from '../services/subscription.service';
import { monitorService } from '../services/monitor.service';
import { ytdlpService } from '../services/ytdlp.service';
import { libraryService } from '../services/library.service';
import { cleanupService } from '../services/cleanup.service';
import { prisma } from '../db';
import { autoDeleteService } from '../services/auto-delete.service';
import { backupService } from '../services/backup.service';
import { youtubeSyncService } from '../services/youtube-sync.service';
import { queueService } from '../services/queue.service';
import { downloadService } from '../services/download.service';

export interface JobInfo {
	name: string;
	cron: string;
	enabled: boolean;
	description: string;
}

class JobScheduler {
	private jobRegistry = new Map<string, JobInfo>();

	/** Names of jobs currently executing, to prevent overlapping runs piling up. */
	private runningJobs = new Set<string>();

	/**
	 * Log a job run to the database
	 */
	private async logJobRun(jobName: string, fn: () => Promise<void>): Promise<void> {
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

		// Register standard task handlers
		downloadService.registerJobHandlers();
		
		queueService.registerHandler('system', async (job) => {
			const payload = job.payload as any;
			if (!payload?.name) return;
			
			await this.runJob(payload.name);
			await this.scheduleNextRun(payload.name);
		});

		// Initialize recurring jobs mapping
		this.jobRegistry.set('ytdlp-update', {
			name: 'ytdlp-update',
			cron: '0 3 * * *',
			enabled: true,
			description: 'Auto-update yt-dlp binary',
		});
		this.jobRegistry.set('auto-delete', {
			name: 'auto-delete',
			cron: '0 * * * *',
			enabled: true,
			description: 'Delete watched videos past retention period',
		});
		this.jobRegistry.set('cache-cleanup', {
			name: 'cache-cleanup',
			cron: '*/5 * * * *',
			enabled: true,
			description: 'Reconcile files and enforce cache quota',
		});
		this.jobRegistry.set('youtube-sync', {
			name: 'youtube-sync',
			cron: '*/30 * * * *',
			enabled: true,
			description: 'Sync YouTube watch history, watched status, and Watch Later',
		});
		this.jobRegistry.set('subscription-check', {
			name: 'subscription-check',
			cron: '*/30 * * * *',
			enabled: true,
			description: 'Legacy manual subscription checking (managed by SubscriptionService)',
		});
		this.jobRegistry.set('monitor-check', {
			name: 'monitor-check',
			cron: '*/15 * * * *',
			enabled: true,
			description: 'Monitor livestreams',
		});
		
		const settings = await prisma.settings.findUnique({
			where: { id: 'singleton' },
		});
		
		this.jobRegistry.set('backup', {
			name: 'backup',
			cron: settings?.backupCron || '0 2 * * *',
			enabled: !!(settings?.backupEnabled && settings?.backupCron),
			description: 'Automated database backup',
		});

		if (settings?.cleanupEnabled) {
			const intervalSeconds = settings.cleanupIntervalSeconds || 3600;
			this.jobRegistry.set('watched-cleanup', {
				name: 'watched-cleanup',
				cron: this.secondsToCronInterval(intervalSeconds),
				enabled: true,
				description: 'Clean up watched items',
			});
		} else {
			this.jobRegistry.set('watched-cleanup', {
				name: 'watched-cleanup',
				cron: '0 * * * *',
				enabled: false,
				description: 'Clean up watched items',
			});
		}

		// Ensure system jobs are scheduled
		await this.scheduleNextRun('ytdlp-update');
		await this.scheduleNextRun('auto-delete');
		await this.scheduleNextRun('cache-cleanup');
		await this.scheduleNextRun('youtube-sync');
		
		if (this.jobRegistry.get('backup')?.enabled) {
			await this.scheduleNextRun('backup');
		}
		if (this.jobRegistry.get('watched-cleanup')?.enabled) {
			await this.scheduleNextRun('watched-cleanup');
		}

		// Start queue worker
		await queueService.start();

		// Start subscription and monitor scheduling
		await subscriptionService.startScheduler();
		// await monitorService.startMonitoring(); // typically relies on similar intervals or own loops

		console.log('[Scheduler] All background jobs started');
	}

	async scheduleNextRun(name: string) {
		const reg = this.jobRegistry.get(name);
		if (!reg || !reg.enabled || !reg.cron) return;

		try {
			const interval = CronExpressionParser.parse(reg.cron);
			const nextRun = interval.next().toDate();

			const pendingJobs = await prisma.jobQueue.findMany({
				where: { type: 'system', status: 'PENDING' }
			});
			const existing = pendingJobs.find(j => (j.payload as any)?.name === name);

			if (existing) {
				await prisma.jobQueue.update({
					where: { id: existing.id },
					data: { runAt: nextRun }
				});
			} else {
				await queueService.enqueue('system', { name }, { runAt: nextRun });
			}
		} catch (e) {
			console.error(`[Scheduler] Failed to parse cron or schedule job ${name}:`, e);
		}
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
					const res = await autoDeleteService.deleteWatchedOverThreshold();
					if (res.deleted > 0) {
						console.log(`[Scheduler] AutoDelete: deleted ${res.deleted} watched download(s)`);
					}
					break;

				case 'cache-cleanup':
					await libraryService.resumeInterruptedPromotions();
					await libraryService.reconcileFiles();
					await libraryService.enforceCacheQuota();
					await libraryService.sweepOrphanedDownloads();
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
					monitorService.stopAll();
					await monitorService.startMonitoring();
					break;
				}

				case 'backup': {
					console.log('[Scheduler] Running scheduled backup...');
					const backup = await backupService.createBackup('scheduled');
					console.log(`[Scheduler] Backup created: ${backup.filename}`);
					break;
				}

				case 'youtube-sync':
					await youtubeSyncService.runOnce();
					break;
					
				case 'watched-cleanup':
					await cleanupService.runCleanup();
					break;

				default:
					throw new Error(`Unknown job: ${jobName}`);
			}
		});
	}

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
		const settings = await prisma.settings.findUnique({
			where: { id: 'singleton' },
		});
		
		if (settings?.cleanupEnabled) {
			const intervalSeconds = settings.cleanupIntervalSeconds || 3600;
			this.jobRegistry.set('watched-cleanup', {
				name: 'watched-cleanup',
				cron: this.secondsToCronInterval(intervalSeconds),
				enabled: true,
				description: 'Clean up watched items',
			});
			await this.scheduleNextRun('watched-cleanup');
		}
	}

	private secondsToCronInterval(seconds: number): string {
		const minutes = Math.max(1, Math.round(seconds / 60));
		if (minutes < 60) return `*/${minutes} * * * *`;
		const hours = Math.round(minutes / 60);
		if (hours < 24) return `0 */${hours} * * *`;
		return `0 0 */${Math.round(hours / 24)} * * *`;
	}

	/**
	 * Stop all background jobs
	 */
	stop(): void {
		console.log('[Scheduler] Stopping background jobs...');

		subscriptionService.stopAll();
		monitorService.stopAll();
		queueService.stop();

		console.log('[Scheduler] All background jobs stopped');
	}
}

// Singleton instance
export const jobScheduler = new JobScheduler();
