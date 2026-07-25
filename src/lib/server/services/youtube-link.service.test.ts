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
