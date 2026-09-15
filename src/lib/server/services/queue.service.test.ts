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
