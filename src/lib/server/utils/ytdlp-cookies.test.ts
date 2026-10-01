import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, access, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

// vi.mock of a node builtin does not intercept imports under this vitest
// version, so the "cookie file no longer on disk" cases use real paths.
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

const LINK_USER = 'user-1';

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
			settings: { ytdlpProxyUrl: 'socks5h://global:1080', cookiePath: null },
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

	it('falls back to the admin cookie file when there is no link', async () => {
		const { withYouTubeCookies } = await freshResolver();
		const file = join(dir, 'cookies.txt');
		await writeFile(file, 'admin cookies');
		created.push(file);
		store.settings = { ytdlpProxyUrl: null, cookiePath: file };

		await withYouTubeCookies(LINK_USER, (ctx) => {
			expect(ctx.source).toBe('settings');
			expect(ctx.cookiePath).toBe(file);
			expect(ctx.proxyUrl).toBeNull();
			expect(ctx.needsRelink).toBe(false);
			return Promise.resolve();
		});
	});

	it('treats a dangling cookiePath as no cookies at all', async () => {
		const { withYouTubeCookies } = await freshResolver();
		// Survives a pod restart in the DB but not on disk — the upload target is
		// container disk, not a volume.
		store.settings = {
			ytdlpProxyUrl: 'socks5h://global:1080',
			cookiePath: join(dir, 'gone.txt'),
		};

		await withYouTubeCookies(LINK_USER, (ctx) => {
			expect(ctx.source).toBe('none');
			expect(ctx.cookiePath).toBeNull();
			return Promise.resolve();
		});
	});

	it('reports a dead session as needsRelink while still using the admin file', async () => {
		const { withYouTubeCookies } = await freshResolver();
		const file = join(dir, 'cookies.txt');
		await writeFile(file, 'admin cookies');
		created.push(file);
		store.settings = { ytdlpProxyUrl: null, cookiePath: file };
		store.link = { proxyUrl: 'http://account-proxy:8080' };
		// Link row exists but its blob will not decrypt.
		store.cookiesTxt = null;

		await withYouTubeCookies(LINK_USER, (ctx) => {
			expect(ctx.needsRelink).toBe(true);
			expect(ctx.source).toBe('settings');
			expect(ctx.cookiePath).toBe(file);
			return Promise.resolve();
		});
	});

	it('carries the account flags once so no caller has to read the link again', async () => {
		const { withYouTubeCookies } = await freshResolver();
		store.link = { proxyUrl: null, extraFlags: ['--limit-rate', '1M'] };
		store.cookiesTxt = 'SID\tvalue\n';
		store.settings = {
			ytdlpProxyUrl: null,
			cookiePath: null,
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
			// The fallback credential is the admin's file, but the traffic is still
			// this account's, so its flag overrides still apply.
			expect(ctx.needsRelink).toBe(true);
			expect(ctx.defaultExtraFlags).toEqual(['--limit-rate', '1M']);
			return Promise.resolve();
		});
	});

	it('never looks up a link without a user', async () => {
		const { withYouTubeCookies } = await freshResolver();
		const file = join(dir, 'cookies.txt');
		await writeFile(file, 'admin cookies');
		created.push(file);
		store.settings = { ytdlpProxyUrl: null, cookiePath: file };
		store.link = { proxyUrl: 'http://account-proxy:8080' };
		store.cookiesTxt = 'SID\tvalue\n';

		await withYouTubeCookies(null, (ctx) => {
			expect(ctx.source).toBe('settings');
			return Promise.resolve();
		});
		expect(store.linkLookups).toBe(0);
	});
});
