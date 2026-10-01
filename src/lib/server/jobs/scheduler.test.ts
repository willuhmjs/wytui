import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db', () => ({
	prisma: {
		settings: { findUnique: vi.fn(async () => null) },
		scheduledJobRun: {
			create: vi.fn(async ({ data }: any) => ({ id: 'run-1', ...data })),
			update: vi.fn(async () => ({})),
			updateMany: vi.fn(async () => ({ count: 0 })),
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
	downloadService: {
		registerJobHandlers: vi.fn(),
		healFailedDownloads: vi.fn(async () => ({
			scanned: 0,
			retried: 0,
			exhausted: 0,
			skipped: 0,
		})),
	},
	// Mirrors the real constant; the pruning pass uses it to tell a row the
	// auto-heal ladder gave up on from one that never entered it.
	HEAL_MAX_ATTEMPTS: 4,
}));

import { jobScheduler } from './scheduler';
import { prisma } from '../db';
import { queueService } from '../services/queue.service';
import { subscriptionService } from '../services/subscription.service';

// The first test spies on runJob/scheduleNextRun to drive the system handler.
// Without this restore those spies stay live for every later test, and a test
// asserting "nothing was enqueued" passes for the wrong reason.
beforeEach(() => {
	vi.restoreAllMocks();
});

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

	it('keeps a given-up verdict for 90 days but everything else at 30', async () => {
		(prisma.download.deleteMany as any).mockClear();

		await (jobScheduler as any).pruneJobHistory();

		const calls = (prisma.download.deleteMany as any).mock.calls.map((c: any[]) => c[0].where);
		const DAY = 24 * 60 * 60 * 1000;
		const near = (d: Date, days: number) =>
			Math.abs(Date.now() - d.getTime() - days * DAY) < 60 * 1000;

		// Band 1: the heal ladder gave up (>= max attempts, no further slot) → 90 days.
		const givenUp = calls.find((w: any) => w.healAttempts?.gte !== undefined);
		expect(givenUp).toBeDefined();
		expect(givenUp.status).toBe('FAILED');
		expect(givenUp.nextHealAt).toBeNull();
		expect(near(givenUp.createdAt.lt, 90)).toBe(true);

		// Band 2: everything else at 30 days, explicitly excluding band 1. The
		// `lt` arm is what keeps never-armed rows (healAttempts 0, nextHealAt null
		// — permanent and cookie-class failures) on the 30-day rule.
		const rest = calls.find((w: any) => w.OR !== undefined);
		expect(rest).toBeDefined();
		expect(rest.OR).toEqual([{ healAttempts: { lt: 4 } }, { nextHealAt: { not: null } }]);
		expect(near(rest.createdAt.lt, 30)).toBe(true);

		// Exactly two disjoint deletes, so no row is matched by both bands.
		expect(calls).toHaveLength(2);
	});
});

describe('recoverAbandonedJobRuns', () => {
	it('closes running rows left behind by a restart, and is called by start()', async () => {
		(prisma.scheduledJobRun.updateMany as any).mockClear();
		const now = new Date('2026-10-01T12:00:00.000Z');

		expect(await jobScheduler.recoverAbandonedJobRuns(now)).toBe(0);

		expect(prisma.scheduledJobRun.updateMany).toHaveBeenCalledWith({
			where: {
				status: 'running',
				// Only rows older than the grace window — a long run on another
				// replica must not be labelled failed.
				startedAt: { lt: new Date(now.getTime() - 10 * 60 * 1000) },
			},
			data: { status: 'failed', endedAt: now, error: 'abandoned by restart' },
		});

		(prisma.scheduledJobRun.updateMany as any).mockClear();
		await jobScheduler.start();
		expect(prisma.scheduledJobRun.updateMany).toHaveBeenCalledTimes(1);
	});
});

describe('auto-heal job enablement (Settings.autoHealEnabled)', () => {
	it('registers and schedules the job while the toggle is on', async () => {
		(prisma.settings.findUnique as any).mockResolvedValueOnce({ autoHealEnabled: true });
		(queueService.enqueue as any).mockClear();
		(prisma.jobQueue.deleteMany as any).mockClear();

		await jobScheduler.restartHealTask();

		expect(jobScheduler.getJobs().find((j) => j.name === 'heal-failed-downloads')?.enabled).toBe(
			true,
		);
		expect(queueService.enqueue).toHaveBeenCalledWith(
			'system',
			{ name: 'heal-failed-downloads' },
			expect.anything(),
		);
		expect(prisma.jobQueue.deleteMany).not.toHaveBeenCalled();
	});

	it('treats a settings row predating the toggle as enabled', async () => {
		(prisma.settings.findUnique as any).mockResolvedValueOnce({});
		(queueService.enqueue as any).mockClear();

		await jobScheduler.restartHealTask();

		expect(jobScheduler.getJobs().find((j) => j.name === 'heal-failed-downloads')?.enabled).toBe(
			true,
		);
		expect(queueService.enqueue).toHaveBeenCalled();
	});

	it('unregisters the job and drops its queued run when the toggle is off', async () => {
		(prisma.settings.findUnique as any).mockResolvedValueOnce({ autoHealEnabled: false });
		(queueService.enqueue as any).mockClear();
		(prisma.jobQueue.deleteMany as any).mockClear();

		await jobScheduler.restartHealTask();

		expect(jobScheduler.getJobs().find((j) => j.name === 'heal-failed-downloads')?.enabled).toBe(
			false,
		);
		// Nothing new is queued…
		expect(queueService.enqueue).not.toHaveBeenCalled();
		// …and the run that was queued while it was still enabled is removed, so
		// disabling takes effect without a redeploy.
		expect(prisma.jobQueue.deleteMany).toHaveBeenCalledWith({
			where: {
				type: 'system',
				status: 'PENDING',
				payload: { path: ['name'], equals: 'heal-failed-downloads' },
			},
		});

		// scheduleNextRun must honour the disabled flag on its own too.
		(prisma.jobQueue.deleteMany as any).mockClear();
		await jobScheduler.scheduleNextRun('heal-failed-downloads');
		expect(queueService.enqueue).not.toHaveBeenCalled();
	});
});
