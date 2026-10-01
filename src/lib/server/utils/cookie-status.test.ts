import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.AUTH_SECRET = 'test-secret-for-cookie-status';

const store = {
	settings: null as null | { cookiesTxtEnc: string | null; cookiesUpdatedAt: Date | null },
	health: { linked: false, usable: false, cookieUpdatedAt: null as Date | null },
	invalidatedAt: null as Date | null,
};

vi.mock('../db', () => ({
	prisma: {
		settings: { findUnique: vi.fn(async () => store.settings) },
		eventLog: {
			findFirst: vi.fn(async () =>
				store.invalidatedAt ? { createdAt: store.invalidatedAt } : null,
			),
		},
	},
}));

vi.mock('../services/youtube-link.service', () => ({
	youtubeLinkService: { getSessionHealth: vi.fn(async () => store.health) },
}));

import { encryptSecret } from './crypto-box';

const USER = 'admin-1';
const UPLOADED = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tvalue\n';

async function freshStatus() {
	vi.resetModules();
	const { computeCookieStatus } = await import('./cookie-status');
	return computeCookieStatus(USER);
}

describe('computeCookieStatus', () => {
	beforeEach(() => {
		Object.assign(store, {
			settings: null,
			health: { linked: false, usable: false, cookieUpdatedAt: null },
			invalidatedAt: null,
		});
	});

	it('reports a link-only deployment as having credentials, and which source is live', async () => {
		const linkedAt = new Date('2026-10-01T10:00:00Z');
		store.health = { linked: true, usable: true, cookieUpdatedAt: linkedAt };

		const status = await freshStatus();

		expect(status).toEqual({
			hasCookies: true,
			stored: false,
			path: null,
			source: 'link',
			linked: true,
			needsRelink: false,
			linkUpdatedAt: linkedAt.toISOString(),
			expired: false,
		});
	});

	it('marks the linked session expired off a later invalidation', async () => {
		store.health = {
			linked: true,
			usable: true,
			cookieUpdatedAt: new Date('2026-10-01T10:00:00Z'),
		};
		store.invalidatedAt = new Date('2026-10-01T11:00:00Z');

		expect(await freshStatus()).toMatchObject({ source: 'link', expired: true });
	});

	it('a fresh re-link clears the expiry even when no file was uploaded', async () => {
		store.health = {
			linked: true,
			usable: true,
			cookieUpdatedAt: new Date('2026-10-01T12:00:00Z'),
		};
		store.invalidatedAt = new Date('2026-10-01T11:00:00Z');

		expect(await freshStatus()).toMatchObject({ expired: false });
	});

	it('says re-link, not re-upload, when the stored session will not decrypt', async () => {
		store.health = { linked: true, usable: false, cookieUpdatedAt: new Date() };

		const status = await freshStatus();

		// No credential can authenticate, so hasCookies stays false — but the panel
		// is not dead: needsRelink is what the UI turns into "re-link the account".
		expect(status).toMatchObject({
			hasCookies: false,
			stored: false,
			source: 'none',
			linked: true,
			needsRelink: true,
		});
	});

	it('reports the stored upload as the live credential when no account is linked', async () => {
		store.settings = {
			cookiesTxtEnc: encryptSecret(UPLOADED),
			cookiesUpdatedAt: new Date('2026-10-01T09:00:00Z'),
		};

		expect(await freshStatus()).toMatchObject({
			hasCookies: true,
			stored: true,
			path: null,
			source: 'settings',
			linked: false,
			needsRelink: false,
		});
	});

	it('treats a stored blob that will not decrypt as no credential', async () => {
		// Same rule the spawn applies, so Remove is never offered for a blob the
		// next yt-dlp call cannot use.
		store.settings = { cookiesTxtEnc: 'not:an:encrypted:blob', cookiesUpdatedAt: new Date() };

		expect(await freshStatus()).toMatchObject({ hasCookies: false, stored: false, path: null });
	});

	it('a re-upload clears the expiry, a stale upload does not', async () => {
		const invalidatedAt = new Date('2026-10-01T11:00:00Z');
		store.health = { linked: false, usable: false, cookieUpdatedAt: null };
		store.invalidatedAt = invalidatedAt;

		store.settings = {
			cookiesTxtEnc: encryptSecret(UPLOADED),
			cookiesUpdatedAt: new Date('2026-10-01T12:00:00Z'),
		};
		expect(await freshStatus()).toMatchObject({ source: 'settings', expired: false });

		store.settings = {
			cookiesTxtEnc: encryptSecret(UPLOADED),
			cookiesUpdatedAt: new Date('2026-10-01T10:00:00Z'),
		};
		expect(await freshStatus()).toMatchObject({ source: 'settings', expired: true });
	});

	it('keeps the stored upload as the live source while the account is dead', async () => {
		store.settings = {
			cookiesTxtEnc: encryptSecret(UPLOADED),
			cookiesUpdatedAt: new Date('2026-10-01T09:00:00Z'),
		};
		store.health = { linked: true, usable: false, cookieUpdatedAt: null };
		store.invalidatedAt = new Date('2026-10-01T11:00:00Z');

		// A dead session with a working upload: the upload carries the traffic, and
		// the dead session is still worth surfacing.
		expect(await freshStatus()).toMatchObject({
			hasCookies: true,
			stored: true,
			source: 'settings',
			needsRelink: true,
			expired: true,
		});
	});
});
