import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, access, stat, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

process.env.AUTH_SECRET = 'test-secret-for-cookie-resolver';

const store = {
	settings: null as any,
	link: null as any | { proxyUrl: string | null },
	cookiesTxt: null as string | null,
	linkLookups: 0,
};

vi.mock('../db', () => ({
	prisma: {
		settings: {
			findUnique: vi.fn(async () => store.settings),
		},
		youTubeLink: {
			findUnique: vi.fn(async () => {
				store.linkLookups++;
				return store.link;
			}),
		},
	},
}));

vi.mock('../services/youtube-link.service', () => ({
	youtubeLinkService: {
		getCookiesTxt: vi.fn(async () => store.cookiesTxt),
	},
}));

import { encryptSecret } from './crypto-box';

const LINK_USER = 'user-1';
const UPLOADED =
	'# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t1893456000\tSID\tünïcode\tvalue\n';

async function freshResolver() {
	vi.resetModules();
	return await import('./ytdlp-cookies');
}

describe('withYouTubeCookies', () => {
	let dir: string;
	const created: string[] = [];

	beforeEach(async () => {
		vi.clearAllMocks();
		dir = await mkdtemp(join(tmpdir(), 'wytui-cookies-test-'));
		Object.assign(store, {
			settings: {
				ytdlpProxyUrl: 'socks5h://global:1080',
				cookiesTxtEnc: null,
				ytdlpExtraFlags: [],
			},
			link: null,
			cookiesTxt: null,
			linkLookups: 0,
		});
	});

	afterEach(async () => {
		for (const p of created) await rm(p, { force: true });
		await rm(dir, { recursive: true, force: true });
	});

	it('uses the linked account session and cleans up its temp file', async () => {
		const { withYouTubeCookies } = await freshResolver();
		store.link = { proxyUrl: null };
		store.cookiesTxt = '# Netscape HTTP Cookie File\nSID\tvalue\n';

		let seen: string | null = null;
		let contentDuringCall = '';
		const out = await withYouTubeCookies(LINK_USER, async (ctx) => {
			seen = ctx.cookiePath;
			contentDuringCall = await readFile(ctx.cookiePath!, 'utf8');
			expect(ctx.source).toBe('link');
			expect(ctx.needsRelink).toBe(false);
			return 'result';
		});

		expect(out).toBe('result');
		expect(contentDuringCall).toBe('# Netscape HTTP Cookie File\nSID\tvalue\n');
		// The file exists for the duration of fn() and is gone once it returns.
		expect(seen).toBeTruthy();
		await expect(access(seen!)).rejects.toThrow();
	});

	it('pairs the linked session with the link proxy so cookie and egress never diverge', async () => {
		const { withYouTubeCookies } = await freshResolver();
		store.link = { proxyUrl: 'http://account-proxy:8080' };
		store.cookiesTxt = 'SID\tvalue\n';

		await withYouTubeCookies(LINK_USER, (ctx) => {
			expect(ctx.proxyUrl).toBe('http://account-proxy:8080');
			return Promise.resolve();
		});

		// No per-link proxy: fall through to the server-wide one.
		store.link = { proxyUrl: null };
		await withYouTubeCookies(LINK_USER, (ctx) => {
			expect(ctx.proxyUrl).toBe('socks5h://global:1080');
			return Promise.resolve();
		});
	});

	it('removes the temp file even when the callback throws', async () => {
		const { withYouTubeCookies } = await freshResolver();
		store.link = { proxyUrl: null };
		store.cookiesTxt = 'SID\tvalue\n';

		let path: string | null = null;
		await expect(
			withYouTubeCookies(LINK_USER, async (ctx) => {
				path = ctx.cookiePath;
				throw new Error('yt-dlp exploded');
			}),
		).rejects.toThrow('yt-dlp exploded');

		expect(path).toBeTruthy();
		await expect(access(path!)).rejects.toThrow();
	});

	it('materializes the uploaded file for a user with no linked account', async () => {
		const { withYouTubeCookies } = await freshResolver();
		store.settings.cookiesTxtEnc = encryptSecret(UPLOADED);

		let seen: string | null = null;
		await withYouTubeCookies(LINK_USER, async (ctx) => {
			seen = ctx.cookiePath;
			expect(ctx.source).toBe('settings');
			expect(ctx.needsRelink).toBe(false);
			// The upload has no egress of its own, so the server-wide proxy applies.
			expect(ctx.proxyUrl).toBe('socks5h://global:1080');
			expect(await readFile(ctx.cookiePath!, 'utf8')).toBe(UPLOADED);
			return Promise.resolve();
		});

		expect(seen).toBeTruthy();
		await expect(access(seen!)).rejects.toThrow();
	});

	it('writes the stored bytes verbatim to a 0600 file, and never to a path the caller keeps', async () => {
		const { withYouTubeCookies } = await freshResolver();
		store.settings.cookiesTxtEnc = encryptSecret(UPLOADED);

		let mode = 0;
		let path = '';
		await withYouTubeCookies(null, async (ctx) => {
			path = ctx.cookiePath!;
			mode = (await stat(path)).mode & 0o777;
			expect(await readFile(path, 'utf8')).toBe(UPLOADED);
		});

		expect(mode).toBe(0o600);
		expect(path).toContain('wytui-yt-');
		expect(path).not.toContain('cookies.txt');
		await expect(access(path)).rejects.toThrow();
	});

	it('still falls back to the uploaded file when the link row is dead', async () => {
		const { withYouTubeCookies } = await freshResolver();
		store.settings.cookiesTxtEnc = encryptSecret(UPLOADED);
		store.link = { proxyUrl: 'http://account-proxy:8080' };
		// Link row exists but its blob will not decrypt.
		store.cookiesTxt = null;

		await withYouTubeCookies(LINK_USER, async (ctx) => {
			expect(ctx.needsRelink).toBe(true);
			expect(ctx.source).toBe('settings');
			// The traffic is still this account's, so it egresses the account's proxy.
			expect(ctx.proxyUrl).toBe('http://account-proxy:8080');
			expect(await readFile(ctx.cookiePath!, 'utf8')).toBe(UPLOADED);
		});
	});

	it('reports no cookies when nothing is linked and nothing is stored', async () => {
		const { withYouTubeCookies } = await freshResolver();

		await withYouTubeCookies(LINK_USER, (ctx) => {
			expect(ctx.source).toBe('none');
			expect(ctx.cookiePath).toBeNull();
			expect(ctx.needsRelink).toBe(false);
			return Promise.resolve();
		});
	});

	it('degrades to no cookies when the stored blob will not decrypt', async () => {
		const { withYouTubeCookies } = await freshResolver();
		// Rotated AUTH_SECRET: the row still holds a blob, the key no longer fits.
		const previous = process.env.AUTH_SECRET;
		store.settings.cookiesTxtEnc = encryptSecret(UPLOADED);
		process.env.AUTH_SECRET = 'a-different-secret';
		try {
			await withYouTubeCookies(LINK_USER, (ctx) => {
				expect(ctx.source).toBe('none');
				expect(ctx.cookiePath).toBeNull();
				return Promise.resolve();
			});
		} finally {
			process.env.AUTH_SECRET = previous;
		}
	});

	it('ignores a blob that is not ciphertext at all', async () => {
		const { withYouTubeCookies } = await freshResolver();
		store.settings.cookiesTxtEnc = 'not:an:encrypted:blob';

		await withYouTubeCookies(LINK_USER, (ctx) => {
			expect(ctx.source).toBe('none');
			expect(ctx.cookiePath).toBeNull();
			return Promise.resolve();
		});
	});

	it('carries the account flags once so no caller has to read the link again', async () => {
		const { withYouTubeCookies } = await freshResolver();
		store.link = { proxyUrl: null, extraFlags: ['--limit-rate', '1M'] };
		store.cookiesTxt = 'SID\tvalue\n';
		store.settings = {
			ytdlpProxyUrl: null,
			cookiesTxtEnc: null,
			ytdlpExtraFlags: ['--retries', '5'],
		};

		const lookupsBefore = store.linkLookups;
		await withYouTubeCookies(LINK_USER, (ctx) => {
			// Raw and resolved both come out: a listing path needs to see that the
			// account is configured without being handed flags that would filter the
			// listing it is fetching.
			expect(ctx.extraFlags).toEqual(['--limit-rate', '1M']);
			expect(ctx.defaultExtraFlags).toEqual(['--limit-rate', '1M']);
			return Promise.resolve();
		});
		// One read of youtube_links for the whole resolution — session, proxy and
		// flags all come off that one record.
		expect(store.linkLookups - lookupsBefore).toBe(1);

		// An account that sets nothing inherits the server-wide defaults.
		store.link = { proxyUrl: null, extraFlags: [] };
		await withYouTubeCookies(LINK_USER, (ctx) => {
			expect(ctx.extraFlags).toEqual([]);
			expect(ctx.defaultExtraFlags).toEqual(['--retries', '5']);
			return Promise.resolve();
		});
	});

	it('still carries the account flags when the stored session is dead', async () => {
		const { withYouTubeCookies } = await freshResolver();
		store.link = { proxyUrl: null, extraFlags: ['--limit-rate', '1M'] };
		store.cookiesTxt = null; // row exists, blob will not decrypt

		await withYouTubeCookies(LINK_USER, (ctx) => {
			// The fallback credential is the uploaded file, but the traffic is still
			// this account's, so its flag overrides still apply.
			expect(ctx.needsRelink).toBe(true);
			expect(ctx.defaultExtraFlags).toEqual(['--limit-rate', '1M']);
			return Promise.resolve();
		});
	});

	it('never looks up a link without a user', async () => {
		const { withYouTubeCookies } = await freshResolver();
		store.settings.cookiesTxtEnc = encryptSecret(UPLOADED);
		store.link = { proxyUrl: 'http://account-proxy:8080' };
		store.cookiesTxt = 'SID\tvalue\n';

		await withYouTubeCookies(null, (ctx) => {
			expect(ctx.source).toBe('settings');
			return Promise.resolve();
		});
		expect(store.linkLookups).toBe(0);
	});
});
