import { describe, it, expect, vi, beforeEach } from 'vitest';

const jobRows: any[] = [];

vi.mock('../db', () => ({
	prisma: {
		jobQueue: {
			findMany: vi.fn(async () => jobRows.filter((j) => j.status === 'PENDING')),
			update: vi.fn(async ({ where, data }: any) => {
				const job = jobRows.find((j) => j.id === where.id);
				if (!job) return null;
				// Mirror the conditional claim (where.status) without rejecting
				// the unconditional status writes from executeJob.
				if (where.status && job.status !== where.status) return null;
				Object.assign(job, data);
				return { ...job };
			}),
			updateMany: vi.fn(async ({ where, data }: any) => {
				const matches = jobRows.filter(
					(j) =>
						(where.id === undefined || j.id === where.id) &&
						(where.status === undefined || j.status === where.status),
				);
				matches.forEach((j) => Object.assign(j, data));
				return { count: matches.length };
			}),
			count: vi.fn(async () => 0),
			create: vi.fn(async ({ data }: any) => {
				const job = { id: `job-${jobRows.length + 1}`, ...data };
				jobRows.push(job);
				return job;
			}),
			deleteMany: vi.fn(async () => ({ count: 0 })),
		},
	},
}));

import { QueueService } from './queue.service';
import { prisma } from '../db';

function seedPending(type: string, n: number) {
	for (let i = 0; i < n; i++) {
		jobRows.push({
			id: `${type}-${i}`,
			type,
			payload: {},
			status: 'PENDING',
			priority: 0,
			runAt: new Date(Date.now() - 1000),
			startedAt: null,
			completedAt: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
	}
}

/** A handler that never settles, so claimed jobs hold their concurrency slot. */
function blockForever() {
	return new Promise<void>(() => {});
}

beforeEach(() => {
	jobRows.length = 0;
});

describe('per-type concurrency limits', () => {
	it('caps subscription jobs at 3 concurrent in a single poll batch', async () => {
		const svc = new QueueService(2);
		svc.registerHandler('subscription', blockForever);
		seedPending('subscription', 10);

		await (svc as any).poll();

		const claimed = jobRows.filter((j) => j.status === 'RUNNING');
		expect(claimed).toHaveLength(3);
	});

	it('caps system jobs at 2 concurrent in a single poll batch', async () => {
		const svc = new QueueService(2);
		svc.registerHandler('system', blockForever);
		seedPending('system', 10);

		await (svc as any).poll();

		const claimed = jobRows.filter((j) => j.status === 'RUNNING');
		expect(claimed).toHaveLength(2);
	});

	it('starts at most one download per poll and stops at the configured limit', async () => {
		const svc = new QueueService(2);
		svc.registerHandler('download', blockForever);
		seedPending('download', 5);

		await (svc as any).poll();
		await (svc as any).poll();
		await (svc as any).poll();

		const claimed = jobRows.filter((j) => j.status === 'RUNNING');
		expect(claimed).toHaveLength(2);
	});

	it('releases the slot when a job finishes so the next poll can claim more', async () => {
		const svc = new QueueService(2);
		svc.registerHandler('system', async () => {});
		seedPending('system', 3);

		await (svc as any).poll();
		// Both claimed jobs complete asynchronously; let their finally blocks run.
		await new Promise((resolve) => setImmediate(resolve));
		await new Promise((resolve) => setImmediate(resolve));

		await (svc as any).poll();

		const completed = jobRows.filter((j) => j.status === 'COMPLETED');
		expect(completed.length).toBeGreaterThanOrEqual(2);
	});
});

describe('bookkeeping resilience', () => {
	it('survives a handler that deletes its own job row before completion', async () => {
		// Pin the subscription limit to 1 so a leaked concurrency slot would
		// block the second claim below.
		process.env.QUEUE_MAX_SUBSCRIPTIONS = '1';
		const svc = new QueueService(2);
		let runs = 0;
		// Reproduces the subscription handler's self-reschedule: the row for the
		// in-flight job is removed (delete + re-enqueue) before executeJob
		// records the terminal status.
		svc.registerHandler('subscription', async (job: any) => {
			runs++;
			const idx = jobRows.findIndex((j) => j.id === job.id);
			if (idx !== -1) jobRows.splice(idx, 1);
		});
		seedPending('subscription', 1);

		await (svc as any).poll();
		await new Promise((resolve) => setImmediate(resolve));
		await new Promise((resolve) => setImmediate(resolve));

		// An escaped bookkeeping error surfaces as an unhandled rejection and
		// fails the vitest run; reaching these assertions means the worker
		// survived the vanished row.
		expect(jobRows).toHaveLength(0);
		expect(runs).toBe(1);

		// The concurrency slot must be released: at limit 1, a leaked slot
		// would keep this fresh job from ever being claimed.
		seedPending('subscription', 1);
		await (svc as any).poll();
		await new Promise((resolve) => setImmediate(resolve));
		await new Promise((resolve) => setImmediate(resolve));
		expect(runs).toBe(2);

		delete process.env.QUEUE_MAX_SUBSCRIPTIONS;
	});

	it('does not let a failing status write escape as an unhandled rejection', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const updateMany = vi.mocked(prisma.jobQueue.updateMany);
		updateMany.mockRejectedValueOnce(new Error('db down (success write)'));
		updateMany.mockRejectedValueOnce(new Error('db down (failure write)'));

		const svc = new QueueService(2);
		svc.registerHandler('system', async () => {});
		seedPending('system', 1);

		await (svc as any).poll();
		await new Promise((resolve) => setImmediate(resolve));
		await new Promise((resolve) => setImmediate(resolve));

		// The success write failed, then the failure write failed too — both
		// were logged and neither escaped to kill the process.
		const logged = errSpy.mock.calls.map((c) => String(c[0]));
		expect(logged.some((m) => m.includes('(system) failed'))).toBe(true);
		expect(logged.some((m) => m.includes('Failed to record failure'))).toBe(true);
		errSpy.mockRestore();
	});
});

describe('setMaxConcurrent', () => {
	it('clamps to the settings-validation range (1-20)', () => {
		const svc = new QueueService(2);
		svc.setMaxConcurrent(99);
		expect(svc.getMaxConcurrent()).toBe(20);
		svc.setMaxConcurrent(0);
		expect(svc.getMaxConcurrent()).toBe(1);
	});
});

describe('env-derived defaults', () => {
	it('uses the documented default download limit when no env var is set', () => {
		// Test env doesn't set QUEUE_MAX_*; the constructor default must
		// match the value documented in .env.example.
		const svc = new QueueService();
		expect(svc.getMaxConcurrent()).toBe(2);
	});

	it('honors an explicit constructor argument over the env default', () => {
		const svc = new QueueService(7);
		expect(svc.getMaxConcurrent()).toBe(7);
	});
});
