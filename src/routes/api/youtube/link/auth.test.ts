import { describe, it, expect, vi, beforeEach } from 'vitest';

const store: Record<string, any> = {};

vi.mock('$lib/server/services/youtube-link.service', () => ({
	youtubeLinkService: {
		getLinkStatus: vi.fn(async (userId: string) => ({ linked: !!store[userId], userId })),
		storeCookies: vi.fn(async (userId: string) => {
			store[userId] = { linked: true };
			return { changed: true };
		}),
		updateToggles: vi.fn(async () => {}),
		updateAccountSettings: vi.fn(async () => {}),
		unlink: vi.fn(async () => {}),
	},
}));

vi.mock('$lib/server/services/download.service', () => ({
	downloadService: { armCookieGatedFailures: vi.fn(async () => 3) },
}));

vi.mock('$lib/server/services/event-log.service', () => ({
	eventLogService: { record: vi.fn(async () => {}) },
	EventTypes: { YOUTUBE_LINKED: 'YOUTUBE_LINKED', YOUTUBE_UNLINKED: 'YOUTUBE_UNLINKED' },
}));

import { GET, POST, PATCH, DELETE } from './+server';
import { youtubeLinkService } from '$lib/server/services/youtube-link.service';

const EXT_ORIGIN = 'chrome-extension://mmllabcfgpjnfefkjidlkdjhdflphabc';
const COOKIES = [{ domain: '.youtube.com', name: 'SAPISID', value: 'abc', secure: true }];

/** Minimal RequestEvent for the four methods on this route. */
function event(opts: {
	authMethod?: 'apikey' | 'session' | 'proxy' | null;
	user?: { id: string } | null;
	body?: unknown;
	origin?: string;
}) {
	const locals = {
		session: opts.user === null ? null : { user: opts.user ?? { id: 'u1', email: 'a@b.c' } },
		authMethod: opts.authMethod ?? null,
	} as never;
	return {
		locals,
		request: {
			json: async () => opts.body,
			headers: new Headers(opts.origin ? { origin: opts.origin } : {}),
		},
	} as never;
}

/** Run a handler and return its HttpError status, or undefined when it resolved. */
async function statusOf(handler: any, e: unknown): Promise<number | undefined> {
	try {
		const res = await handler(e);
		return res?.status;
	} catch (err: any) {
		return err?.status;
	}
}

beforeEach(() => {
	for (const k of Object.keys(store)) delete store[k];
	vi.mocked(youtubeLinkService.storeCookies).mockClear();
});

describe('POST /api/youtube/link', () => {
	const body = { cookies: COOKIES };

	it('accepts a Bearer-key principal', async () => {
		expect(await statusOf(POST, event({ authMethod: 'apikey', body }))).toBe(200);
		expect(youtubeLinkService.storeCookies).toHaveBeenCalledWith('u1', COOKIES, undefined);
	});

	it('rejects a session-cookie caller', async () => {
		expect(await statusOf(POST, event({ authMethod: 'session', body }))).toBe(401);
		expect(youtubeLinkService.storeCookies).not.toHaveBeenCalled();
	});

	it('rejects a keyless extension request carrying the victim cookie', async () => {
		expect(await statusOf(POST, event({ authMethod: 'session', body, origin: EXT_ORIGIN }))).toBe(
			401,
		);
		expect(youtubeLinkService.storeCookies).not.toHaveBeenCalled();
	});

	it('rejects a reverse-proxy-authenticated caller (no key presented)', async () => {
		expect(await statusOf(POST, event({ authMethod: 'proxy', body }))).toBe(401);
		expect(youtubeLinkService.storeCookies).not.toHaveBeenCalled();
	});

	it('still authenticates before it reports the missing key', async () => {
		expect(await statusOf(POST, event({ user: null, body }))).toBe(401);
		expect(youtubeLinkService.storeCookies).not.toHaveBeenCalled();
	});

	it('reports the key requirement in the message', async () => {
		let message = '';
		try {
			await POST(event({ authMethod: 'session', body }) as never);
		} catch (e: any) {
			// SvelteKit's HttpError carries the text in `body.message`.
			message = e?.body?.message ?? e?.message ?? '';
		}
		expect(message).toMatch(/API key/i);
	});
});

describe('GET /api/youtube/link', () => {
	it('works for a web session (the settings page and the extension popup both read it)', async () => {
		expect(await statusOf(GET, event({ authMethod: 'session' }))).toBe(200);
		expect(await statusOf(GET, event({ authMethod: 'apikey' }))).toBe(200);
	});

	it('rejects an anonymous caller', async () => {
		expect(await statusOf(GET, event({ user: null }))).toBe(401);
	});
});

describe('PATCH / DELETE /api/youtube/link', () => {
	it('accepts a web session', async () => {
		expect(
			await statusOf(PATCH, event({ authMethod: 'session', body: { syncWatchLater: true } })),
		).toBe(200);
		expect(await statusOf(DELETE, event({ authMethod: 'session' }))).toBe(200);
	});

	it('accepts a Bearer-key principal', async () => {
		expect(
			await statusOf(PATCH, event({ authMethod: 'apikey', body: { syncWatchLater: true } })),
		).toBe(200);
	});
});
