import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

// The linked session's health and the settings row are stubbed; the file check
// runs for real (builtin mocking is a no-op under this vitest version), because
// "the DB still names a cookie file that is not on disk" is exactly the case the
// endpoint has to get right.
const store = {
	settings: null as null | { cookiePath: string | null },
	health: { linked: false, usable: false, cookieUpdatedAt: null as Date | null },
	invalidatedAt: null as Date | null,
	updatedAt: null as Date | null,
};

vi.mock('../db', () => ({
	prisma: {
		settings: { findUnique: vi.fn(async () => store.settings) },
		eventLog: {
			findFirst: vi.fn(async ({ where }: any) => {
				const at = where?.type === 'cookies.invalidated' ? store.invalidatedAt : store.updatedAt;
				return at ? { createdAt: at } : null;
			}),
		},
	},
}));

vi.mock('../services/youtube-link.service', () => ({
	youtubeLinkService: { getSessionHealth: vi.fn(async () => store.health) },
}));

const USER = 'admin-1';

async function freshStatus() {
	vi.resetModules();
	const { computeCookieStatus } = await import('./cookie-status');
	return computeCookieStatus(USER);
}

describe('computeCookieStatus', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'wytui-cookie-status-'));
		Object.assign(store, {
			settings: null,
			health: { linked: false, usable: false, cookieUpdatedAt: null },
			invalidatedAt: null,
			updatedAt: null,
		});
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('reports a link-only deployment as having credentials, and which source is live', async () => {
		const linkedAt = new Date('2026-10-01T10:00:00Z');
		store.health = { linked: true, usable: true, cookieUpdatedAt: linkedAt };

		const status = await freshStatus();

		// The bug this guards: with no settings.cookiePath the old endpoint said
		// "no cookies" and the expiry warning could never appear.
		expect(status).toEqual({
			hasCookies: true,
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

	it('a fresh re-link clears the expiry even when no cookie file was uploaded', async () => {
		store.health = {
			linked: true,
			usable: true,
			cookieUpdatedAt: new Date('2026-10-01T12:00:00Z'),
		};
		store.invalidatedAt = new Date('2026-10-01T11:00:00Z');
		// The upload path records cookies.updated; a link refresh does not, so the
		// link's own timestamp has to clear the condition too.
		store.updatedAt = new Date('2026-10-01T09:00:00Z');

		expect(await freshStatus()).toMatchObject({ expired: false });
	});

	it('says re-link, not re-upload, when the stored session will not decrypt', async () => {
		store.health = { linked: true, usable: false, cookieUpdatedAt: new Date() };

		const status = await freshStatus();

		// No credential can authenticate, so hasCookies stays false — but the panel
		// is not dead: needsRelink is what the UI turns into "re-link the account".
		expect(status).toMatchObject({
			hasCookies: false,
			source: 'none',
			linked: true,
			needsRelink: true,
		});
	});

	it('falls back to the uploaded file when no account is linked', async () => {
		const file = join(dir, 'cookies.txt');
		await writeFile(file, '# Netscape HTTP Cookie File\n');
		store.settings = { cookiePath: file };

		expect(await freshStatus()).toMatchObject({
			hasCookies: true,
			path: file,
			source: 'settings',
			linked: false,
			needsRelink: false,
		});
	});

	it('treats a cookie path that outlived the container as no file at all', async () => {
		// Same rule the spawn applies, so Remove is never offered for a file that is
		// already gone.
		store.settings = { cookiePath: join(dir, 'gone.txt') };

		expect(await freshStatus()).toMatchObject({ hasCookies: false, path: null, source: 'none' });
	});

	it('keeps the file as the live source while the account is unlinked', async () => {
		const file = join(dir, 'cookies.txt');
		await writeFile(file, '# Netscape HTTP Cookie File\n');
		store.settings = { cookiePath: file };
		store.health = { linked: true, usable: false, cookieUpdatedAt: null };
		store.invalidatedAt = new Date('2026-10-01T11:00:00Z');

		// A dead session with a working file: the file carries the traffic, and the
		// dead session is still worth surfacing.
		expect(await freshStatus()).toMatchObject({
			hasCookies: true,
			path: file,
			source: 'settings',
			needsRelink: true,
			expired: true,
		});
	});
});
