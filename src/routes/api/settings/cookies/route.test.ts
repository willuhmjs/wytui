import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.AUTH_SECRET = 'test-secret-for-cookies-route';

// The uploaded file is stored through the real crypto-box and read back through
// the real resolver (both imported for real here), so the ciphertext, the
// decrypt and the 0600 temp file at spawn are all covered by these tests.
const store = {
	row: null as null | { cookiesTxtEnc: string | null; cookiesUpdatedAt: Date | null },
	updates: [] as Record<string, unknown>[],
	events: [] as string[],
	armed: 0,
	armError: null as Error | null,
};

vi.mock('$lib/server/db', () => ({
	prisma: {
		settings: {
			findUnique: vi.fn(async () => store.row),
			update: vi.fn(async ({ data }: any) => {
				store.updates.push(data);
				store.row = { ...(store.row ?? {}), ...data };
				return store.row;
			}),
		},
		eventLog: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({})) },
	},
}));

vi.mock('$lib/server/services/event-log.service', () => ({
	eventLogService: {
		record: vi.fn(async (type: string) => {
			store.events.push(type);
		}),
	},
	EventTypes: { COOKIES_UPDATED: 'cookies.updated', COOKIES_INVALIDATED: 'cookies.invalidated' },
}));

vi.mock('$lib/server/services/download.service', () => ({
	downloadService: {
		armCookieGatedFailures: vi.fn(async () => {
			if (store.armError) throw store.armError;
			return store.armed;
		}),
	},
}));

vi.mock('$lib/server/services/youtube-link.service', () => ({
	youtubeLinkService: {
		getSessionHealth: vi.fn(async () => ({
			linked: false,
			usable: false,
			cookieUpdatedAt: null,
		})),
		getCookiesTxt: vi.fn(async () => null),
	},
}));

import { access, readFile } from 'fs/promises';
import { GET, POST, DELETE } from './+server';
import { decryptSecret, encryptSecret } from '$lib/server/utils/crypto-box';
import { withYouTubeCookies } from '$lib/server/utils/ytdlp-cookies';
import { eventLogService } from '$lib/server/services/event-log.service';

const COOKIE_TEXT =
	'# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t1893456000\tSID\tvalue\n';

function event(opts: { isAdmin?: boolean; file?: File | null } = {}) {
	const files = new Map<string, File>();
	if (opts.file) files.set('file', opts.file);
	return {
		locals: {
			session: { user: { id: 'admin-1', isAdmin: opts.isAdmin ?? true } },
		},
		request: {
			formData: async () => ({ get: (key: string) => files.get(key) ?? null }),
		},
	} as never;
}

function cookieFile(content = COOKIE_TEXT, name = 'cookies.txt'): File {
	return new File([content], name, { type: 'text/plain' });
}

async function statusOf(handler: any, e: unknown): Promise<number | undefined> {
	try {
		return (await handler(e))?.status;
	} catch (err: any) {
		return err?.status;
	}
}

beforeEach(() => {
	store.row = { cookiesTxtEnc: null, cookiesUpdatedAt: null };
	store.updates = [];
	store.events = [];
	store.armed = 3;
	store.armError = null;
	vi.mocked(eventLogService.record).mockClear();
});

describe('POST /api/settings/cookies', () => {
	it('stores the file as ciphertext in the settings row, not as a path', async () => {
		const res = await POST(event({ file: cookieFile() }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ success: true, armedForRetry: 3 });

		const data = store.updates.at(-1) as Record<string, any>;
		expect(data.cookiesUpdatedAt).toBeInstanceOf(Date);
		expect(typeof data.cookiesTxtEnc).toBe('string');
		expect(data.cookiesTxtEnc).not.toContain('SID');
		expect(data.cookiesTxtEnc!.split(':')).toHaveLength(3);
		expect(decryptSecret(data.cookiesTxtEnc)).toBe(COOKIE_TEXT);
		expect(data.cookiePath).toBeUndefined();
	});

	it('hands the stored bytes to the next spawn and leaves no file behind', async () => {
		await POST(event({ file: cookieFile('# Netscape HTTP Cookie File\nSID\tvalue\n') }));

		let seen: string | null = null;
		let during = '';
		const out = await withYouTubeCookies(null, async (ctx) => {
			expect(ctx.source).toBe('settings');
			seen = ctx.cookiePath;
			during = await readFile(ctx.cookiePath!, 'utf8');
			return 'spawned';
		});

		expect(out).toBe('spawned');
		expect(during).toBe('# Netscape HTTP Cookie File\nSID\tvalue\n');
		await expect(access(seen!)).rejects.toThrow();
	});

	it('arms every user cookie-gated failure, and still answers when that fails', async () => {
		store.armed = 12;
		const res = await POST(event({ file: cookieFile() }));
		expect((await res.json()).armedForRetry).toBe(12);

		store.armError = new Error('db down');
		const after = await POST(event({ file: cookieFile() }));
		expect(after.status).toBe(200);
		expect(await after.json()).toEqual({ success: true, armedForRetry: 0 });
		expect(vi.mocked(eventLogService.record)).toHaveBeenCalledTimes(2);
	});

	it('rejects a non-admin, a missing file, and non-Netscape content without touching the row', async () => {
		expect(await statusOf(POST, event({ isAdmin: false, file: cookieFile() }))).toBe(403);
		expect(await statusOf(POST, event({ file: null }))).toBe(400);
		expect(await statusOf(POST, event({ file: cookieFile('not a cookie file') }))).toBe(400);
		expect(store.updates).toHaveLength(0);
	});

	it('rejects an upload over the size cap', async () => {
		const big = new File(['# Netscape HTTP Cookie File\n' + 'a'.repeat(1024 * 1024)], 'c.txt');
		expect(await statusOf(POST, event({ file: big }))).toBe(400);
		expect(store.updates).toHaveLength(0);
	});
});

describe('DELETE /api/settings/cookies', () => {
	it('clears the stored text so the next spawn runs cookie-less', async () => {
		await POST(event({ file: cookieFile() }));
		expect(await statusOf(DELETE, event())).toBe(200);

		const data = store.updates.at(-1) as Record<string, any>;
		expect(data.cookiesTxtEnc).toBeNull();
		expect(data.cookiesUpdatedAt).toBeNull();

		await withYouTubeCookies(null, (ctx) => {
			expect(ctx.source).toBe('none');
			expect(ctx.cookiePath).toBeNull();
			return Promise.resolve();
		});
	});

	it('rejects a non-admin', async () => {
		expect(await statusOf(DELETE, event({ isAdmin: false }))).toBe(403);
		expect(store.updates).toHaveLength(0);
	});
});

describe('GET /api/settings/cookies', () => {
	it('reports the stored upload as the live credential, with no path to remove', async () => {
		await POST(event({ file: cookieFile() }));
		const body = await (await GET(event())).json();

		expect(body).toMatchObject({
			hasCookies: true,
			stored: true,
			path: null,
			source: 'settings',
			expired: false,
		});
	});

	it('reports no cookies after a stored blob becomes unreadable', async () => {
		store.row = { cookiesTxtEnc: encryptSecret(COOKIE_TEXT), cookiesUpdatedAt: new Date() };
		const previous = process.env.AUTH_SECRET;
		process.env.AUTH_SECRET = 'a-different-secret';
		try {
			const body = await (await GET(event())).json();
			expect(body).toMatchObject({ hasCookies: false, stored: false, source: 'none' });
		} finally {
			process.env.AUTH_SECRET = previous;
		}
	});

	it('rejects a non-admin', async () => {
		expect(await statusOf(GET, event({ isAdmin: false }))).toBe(403);
	});
});
