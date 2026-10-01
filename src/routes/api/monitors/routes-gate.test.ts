import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = {
	monitors: [] as any[],
	profiles: [] as any[],
};

vi.mock('$lib/server/db', () => ({
	prisma: {
		monitor: {
			findMany: vi.fn(async () => db.monitors.map((m) => ({ ...m }))),
			findUnique: vi.fn(
				async ({ where }: any) => db.monitors.find((m) => m.id === where.id) ?? null,
			),
			findFirst: vi.fn(
				async ({ where }: any) => db.monitors.find((m) => m.url === where.url) ?? null,
			),
			create: vi.fn(async ({ data }: any) => ({
				id: `mon-${db.monitors.length + 1}`,
				enabled: true,
				isLive: false,
				...data,
			})),
		},
		downloadProfile: {
			findUnique: vi.fn(
				async ({ where }: any) => db.profiles.find((p) => p.id === where.id) ?? null,
			),
		},
	},
}));

vi.mock('$lib/server/services/monitor.service', () => ({
	monitorService: {
		startMonitor: vi.fn(async () => {}),
		stopMonitor: vi.fn(),
	},
}));

const guard = vi.hoisted(() => ({ blocked: false }));
vi.mock('$lib/server/utils/ssrf-guard', () => ({
	checkUrlHost: vi.fn(async () =>
		guard.blocked ? { ok: false, reason: 'blocked', blocked: 'loopback' } : { ok: true },
	),
	describeUrlHostCheck: () => 'URL host is a loopback address',
}));

import { GET, POST } from './+server';
import { GET as GET_BY_ID } from './[id]/+server';
import { monitorService } from '$lib/server/services/monitor.service';
import { prisma } from '$lib/server/db';

const admin = { session: { user: { id: 'admin-1', isAdmin: true } } };
const user = { session: { user: { id: 'user-1', isAdmin: false } } };
const anon = { session: null };

function localsFor(l: unknown) {
	return l as never;
}

/** Run a handler and return its HttpError status, or undefined when it resolved. */
async function statusOf(handler: any, event: Record<string, unknown>): Promise<number | undefined> {
	try {
		await handler(event);
		return undefined;
	} catch (e: any) {
		return e?.status;
	}
}

function post(body: unknown) {
	return { request: { json: async () => body } };
}

const VALID_CREATE = {
	url: 'https://www.youtube.com/watch?v=live1',
	name: 'Live 1',
	type: 'YOUTUBE_LIVE',
	profileId: 'p-system',
};

beforeEach(() => {
	guard.blocked = false;
	db.monitors.length = 0;
	db.profiles.length = 0;
	db.monitors.push({ id: 'm1', url: VALID_CREATE.url, name: 'Live 1', profileId: 'p-system' });
	db.profiles.push(
		{ id: 'p-system', isSystem: true, userId: null },
		{ id: 'p-mine', isSystem: false, userId: 'user-1' },
		{ id: 'p-theirs', isSystem: false, userId: 'user-2' },
	);
	vi.mocked(prisma.monitor.create).mockClear();
	vi.mocked(monitorService.startMonitor).mockClear();
});

describe('GET /api/monitors', () => {
	it('is admin-only and never reads before the gate', async () => {
		expect(await statusOf(GET, { locals: localsFor(user) })).toBe(403);
		expect(await statusOf(GET, { locals: localsFor(anon) })).toBe(403);
		expect(vi.mocked(prisma.monitor.findMany)).not.toHaveBeenCalled();
	});

	it('lists for an admin', async () => {
		const res = await GET({ locals: localsFor(admin) } as never);
		expect(res.status).toBe(200);
		expect(await res.json()).toHaveLength(1);
	});
});

describe('GET /api/monitors/[id]', () => {
	it('is admin-only, matching the list endpoint', async () => {
		expect(await statusOf(GET_BY_ID, { locals: localsFor(user), params: { id: 'm1' } })).toBe(403);
		expect(vi.mocked(prisma.monitor.findUnique)).not.toHaveBeenCalled();

		const res = await GET_BY_ID({ locals: localsFor(admin), params: { id: 'm1' } } as never);
		expect(res.status).toBe(200);
	});
});

describe('POST /api/monitors', () => {
	it('rejects non-admins before touching the database', async () => {
		expect(await statusOf(POST, { locals: localsFor(user), ...post(VALID_CREATE) } as never)).toBe(
			403,
		);
		expect(vi.mocked(prisma.monitor.create)).not.toHaveBeenCalled();
		expect(vi.mocked(monitorService.startMonitor)).not.toHaveBeenCalled();
	});

	it("refuses to schedule a monitor on another user's profile", async () => {
		const res = post({ ...VALID_CREATE, profileId: 'p-theirs' });
		expect(await statusOf(POST, { locals: localsFor(admin), ...res })).toBe(403);
		expect(vi.mocked(prisma.monitor.create)).not.toHaveBeenCalled();

		const own = post({ ...VALID_CREATE, url: 'https://www.youtube.com/watch?v=live2' });
		const created = await POST({
			locals: localsFor({ session: { user: { id: 'user-1', isAdmin: true } } }),
			...own,
		} as never);
		expect(created.status).toBe(201);
	});

	it('creates and starts on a system profile', async () => {
		const res = await POST({
			locals: localsFor(admin),
			...post({ ...VALID_CREATE, url: 'https://www.youtube.com/watch?v=live9' }),
		} as never);
		expect(res.status).toBe(201);
		expect(vi.mocked(prisma.monitor.create)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(monitorService.startMonitor)).toHaveBeenCalledTimes(1);
	});

	it('rejects an unknown profile id rather than creating a dangling monitor', async () => {
		expect(
			await statusOf(POST, {
				locals: localsFor(admin),
				...post({ ...VALID_CREATE, profileId: 'nope' }),
			}),
		).toBe(400);
		expect(vi.mocked(prisma.monitor.create)).not.toHaveBeenCalled();
	});

	it('rejects a URL the SSRF guard blocks, before creating anything', async () => {
		guard.blocked = true;
		expect(
			await statusOf(POST, {
				locals: localsFor(admin),
				...post({ ...VALID_CREATE, url: 'http://169.254.169.254/latest/meta-data' }),
			} as never),
		).toBe(400);
		expect(vi.mocked(prisma.monitor.create)).not.toHaveBeenCalled();
		expect(vi.mocked(monitorService.startMonitor)).not.toHaveBeenCalled();
	});
});
