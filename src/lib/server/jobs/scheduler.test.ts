import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db', () => ({
	prisma: {
		settings: { findUnique: vi.fn(async () => null) },
		scheduledJobRun: {
			create: vi.fn(async ({ data }: any) => ({ id: 'run-1', ...data })),
			update: vi.fn(async () => ({})),
			deleteMany: vi.fn(async () => ({ count: 0 })),
		},
		jobQueue: {
			findMany: vi.fn(async () => []),
			updateMany: vi.fn(async () => ({ count: 0 })),
			update: vi.fn(async () => ({})),
			create: vi.fn(async ({ data }: any) => ({ id: 'job-1', ...data })),
			count: vi.fn(async () => 0),
			deleteMany: vi.fn(async () => ({ count: 0 })),
		},
		download: {
			deleteMany: vi.fn(async () => ({ count: 0 })),
			findMany: vi.fn(async () => []),
		},
		subscription: { findMany: vi.fn(async () => []) },
	},
}));

vi.mock('../services/queue.service', () => ({
	queueService: {
		registerHandler: vi.fn(),
		enqueue: vi.fn(async () => ({})),
		start: vi.fn(async () => {}),
		stop: vi.fn(),
		setMaxConcurrent: vi.fn(),
	},
}));
vi.mock('../services/subscription.service', () => ({
	subscriptionService: {
		startScheduler: vi.fn(async () => {}),
		stopAll: vi.fn(),
		checkSubscription: vi.fn(async () => {}),
	},
}));
vi.mock('../services/monitor.service', () => ({
	monitorService: {
		startMonitoring: vi.fn(async () => {}),
		stopAll: vi.fn(),
	},
}));
vi.mock('../services/ytdlp.service', () => ({
	ytdlpService: {
		getVersion: vi.fn(async () => '1.0'),
		updateBinary: vi.fn(async () => ''),
	},
}));
vi.mock('../services/library.service', () => ({
	libraryService: {
		resumeInterruptedPromotions: vi.fn(async () => {}),
		reconcileFiles: vi.fn(async () => {}),
		enforceCacheQuota: vi.fn(async () => {}),
		sweepOrphanedDownloads: vi.fn(async () => {}),
		triggerLibraryScan: vi.fn(async () => {}),
	},
}));
vi.mock('../services/cleanup.service', () => ({
	cleanupService: { runCleanup: vi.fn(async () => {}) },
}));
vi.mock('../services/auto-delete.service', () => ({
	autoDeleteService: { deleteWatchedOverThreshold: vi.fn(async () => ({ deleted: 0 })) },
}));
vi.mock('../services/backup.service', () => ({
	backupService: { createBackup: vi.fn(async () => ({ filename: 'backup.zip' })) },
}));
vi.mock('../services/youtube-sync.service', () => ({
	youtubeSyncService: { runOnce: vi.fn(async () => {}) },
}));
vi.mock('../services/download.service', () => ({
	downloadService: { registerJobHandlers: vi.fn() },
}));

import { jobScheduler } from './scheduler';
import { prisma } from '../db';
import { queueService } from '../services/queue.service';
import { subscriptionService } from '../services/subscription.service';

describe('system job handler', () => {
	it('reschedules the recurring job even when the run fails', async () => {
		const handlers = new Map<string, any>();
		(queueService.registerHandler as any).mockImplementation((type: string, handler: any) =>
			handlers.set(type, handler),
		);

		await jobScheduler.start();

		const handler = handlers.get('system');
		expect(handler).toBeDefined();

		const runJobSpy = vi.spyOn(jobScheduler as any, 'runJob').mockRejectedValue(new Error('boom'));
		const scheduleSpy = vi
			.spyOn(jobScheduler as any, 'scheduleNextRun')
			.mockResolvedValue(undefined);

		// The failure still propagates (so the job row is marked FAILED), but
		// the next run must be scheduled regardless.
		await expect(handler({ payload: { name: 'cache-cleanup' } })).rejects.toThrow('boom');
		expect(scheduleSpy).toHaveBeenCalledWith('cache-cleanup');

		// Success path schedules exactly once as well.
		runJobSpy.mockResolvedValue(undefined);
		await handler({ payload: { name: 'cache-cleanup' } });
		expect(scheduleSpy).toHaveBeenCalledTimes(2);
	});

	it('applies the persisted maxConcurrentDownloads at startup', async () => {
		(prisma.settings.findUnique as any).mockResolvedValueOnce({
			maxConcurrentDownloads: 7,
			backupEnabled: false,
			cleanupEnabled: false,
		});

		await jobScheduler.start();

		expect(queueService.setMaxConcurrent).toHaveBeenCalledWith(7);
	});

	it('lets an explicit QUEUE_MAX_DOWNLOADS env var win over the stored setting', async () => {
		(queueService.setMaxConcurrent as any).mockClear();
		vi.stubEnv('QUEUE_MAX_DOWNLOADS', '4');
		(prisma.settings.findUnique as any).mockResolvedValueOnce({
			maxConcurrentDownloads: 7,
			backupEnabled: false,
			cleanupEnabled: false,
		});

		await jobScheduler.start();

		expect(queueService.setMaxConcurrent).not.toHaveBeenCalled();
		vi.unstubAllEnvs();
	});

	it('registers the subscription handler before the queue worker starts polling', async () => {
		// Leftover PENDING subscription jobs from a previous run are already
		// due; if the worker polls before the handler exists they fail with
		// "No handler registered" and those channels' check chains die.
		const order: string[] = [];
		(subscriptionService.startScheduler as any).mockImplementation(async () => {
			order.push('subscription-scheduler');
		});
		(queueService.start as any).mockImplementation(async () => {
			order.push('queue-start');
		});

		await jobScheduler.start();

		expect(order).toEqual(['subscription-scheduler', 'queue-start']);
	});
});

describe('pruneJobHistory', () => {
	it('prunes terminal job rows, run history, and stale failed downloads', async () => {
		await (jobScheduler as any).pruneJobHistory();

		expect(prisma.jobQueue.deleteMany).toHaveBeenCalled();
		expect(prisma.scheduledJobRun.deleteMany).toHaveBeenCalled();
		expect(prisma.download.deleteMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ status: 'FAILED' }),
			}),
		);
	});
});
