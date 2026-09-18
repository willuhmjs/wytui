import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const createMock = vi.fn();
const deleteManyMock = vi.fn();

vi.mock('../db', () => ({
	prisma: {
		eventLog: {
			create: (args: any) => createMock(args),
			deleteMany: (args: any) => deleteManyMock(args),
		},
	},
}));

// The service keeps its prune throttle in module-level state, so each test
// imports a fresh instance. request-context must come from the same module
// cycle — a stale import would hold a different AsyncLocalStorage instance
// and never see the user the fresh service records.
async function freshService() {
	vi.resetModules();
	const mod = await import('./event-log.service');
	const ctx = await import('../request-context');
	return { service: mod.eventLogService, ctx };
}

const NOW = new Date('2026-09-17T12:00:00Z').getTime();
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

beforeEach(() => {
	vi.clearAllMocks();
	createMock.mockResolvedValue({});
	deleteManyMock.mockResolvedValue({ count: 0 });
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('eventLogService.record', () => {
	it('never throws when the insert fails', async () => {
		createMock.mockRejectedValue(new Error('db down'));
		const { service } = await freshService();

		await expect(
			service.record('download.completed', 'Downloaded "X"', 'user-1'),
		).resolves.toBeUndefined();

		// A failed insert must not schedule a prune either.
		expect(deleteManyMock).not.toHaveBeenCalled();
	});

	it('stores the event with the given fields', async () => {
		const { service } = await freshService();

		await service.record('download.completed', 'Downloaded "X"', 'user-1');

		expect(createMock).toHaveBeenCalledWith({
			data: { type: 'download.completed', message: 'Downloaded "X"', userId: 'user-1' },
		});
	});

	it('normalizes a null userId to null, not undefined', async () => {
		const { service } = await freshService();

		await service.record('download.failed', 'Failed "X"', null);

		expect(createMock).toHaveBeenCalledWith({
			data: { type: 'download.failed', message: 'Failed "X"', userId: null },
		});
	});

	it('resolves the acting user from the request context when no userId is passed', async () => {
		const { service, ctx } = await freshService();

		await ctx.runWithRequestContext(async () => {
			ctx.setActingUser({ id: 'actor-1', name: 'Admin', isAdmin: true });
			await service.record('subscription.deleted', 'Deleted subscription "News"');
		});

		expect(createMock).toHaveBeenCalledWith({
			data: {
				type: 'subscription.deleted',
				message: 'Deleted subscription "News"',
				userId: 'actor-1',
			},
		});
	});

	it('prefers the request-context actor over an explicit subject userId', async () => {
		// An admin deleting another user's download: the actor (admin) is who
		// the feed should show, not the row's owner.
		const { service, ctx } = await freshService();

		await ctx.runWithRequestContext(async () => {
			ctx.setActingUser({ id: 'admin-1' });
			await service.record('download.deleted', 'Deleted "X"', 'owner-1');
		});

		expect(createMock).toHaveBeenCalledWith({
			data: { type: 'download.deleted', message: 'Deleted "X"', userId: 'admin-1' },
		});
	});

	it('uses the explicit userId outside a request context (background jobs)', async () => {
		const { service } = await freshService();

		await service.record('download.completed', 'Downloaded "X"', 'owner-1');

		expect(createMock).toHaveBeenCalledWith({
			data: { type: 'download.completed', message: 'Downloaded "X"', userId: 'owner-1' },
		});
	});
});

describe('eventLogService retention prune', () => {
	it('deletes rows older than 30 days after an insert', async () => {
		const { service } = await freshService();

		await service.record('download.completed', 'Downloaded "X"');

		expect(deleteManyMock).toHaveBeenCalledTimes(1);
		expect(deleteManyMock).toHaveBeenCalledWith({
			where: { createdAt: { lt: new Date(NOW - THIRTY_DAYS_MS) } },
		});
	});

	it('throttles the sweep to once per hour', async () => {
		const { service } = await freshService();

		await service.record('download.completed', 'a');
		await service.record('download.completed', 'b');
		expect(deleteManyMock).toHaveBeenCalledTimes(1);

		vi.setSystemTime(NOW + ONE_HOUR_MS + 1000);
		await service.record('download.completed', 'c');
		expect(deleteManyMock).toHaveBeenCalledTimes(2);
	});

	it('keeps serving events when the prune fails', async () => {
		deleteManyMock.mockRejectedValue(new Error('lock timeout'));
		const { service } = await freshService();

		await expect(service.record('download.completed', 'a')).resolves.toBeUndefined();

		// Give the fire-and-forget prune's catch a tick to swallow the rejection.
		await Promise.resolve();
	});
});
