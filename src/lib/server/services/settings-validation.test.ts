import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/db', () => ({
	prisma: {
		user: { findFirst: vi.fn(async () => null) },
		settings: { findUnique: vi.fn(async () => null) },
	},
}));

import { validateSettingsUpdate } from './settings-validation';

describe('validateSettingsUpdate: ytdlpProxyUrl', () => {
	it('accepts a socks5 proxy URL and trims whitespace', async () => {
		const updates = await validateSettingsUpdate({
			ytdlpProxyUrl: '  socks5://user:pass@proxy.internal:1080  ',
		});
		expect(updates.ytdlpProxyUrl).toBe('socks5://user:pass@proxy.internal:1080');
	});

	it('accepts http, https, socks4 and socks5h schemes', async () => {
		for (const url of [
			'http://proxy:8080',
			'https://proxy:8443',
			'socks4://proxy:1080',
			'socks5h://proxy:1080',
		]) {
			const updates = await validateSettingsUpdate({ ytdlpProxyUrl: url });
			expect(updates.ytdlpProxyUrl).toBe(url);
		}
	});

	it('clears the proxy on empty string or null', async () => {
		expect((await validateSettingsUpdate({ ytdlpProxyUrl: '' })).ytdlpProxyUrl).toBeNull();
		expect((await validateSettingsUpdate({ ytdlpProxyUrl: null })).ytdlpProxyUrl).toBeNull();
	});

	it('rejects non-proxy URL schemes', async () => {
		await expect(validateSettingsUpdate({ ytdlpProxyUrl: 'ftp://proxy:21' })).rejects.toMatchObject(
			{ status: 400 },
		);
	});

	it('rejects garbage that is not a URL', async () => {
		await expect(validateSettingsUpdate({ ytdlpProxyUrl: 'not a proxy' })).rejects.toMatchObject({
			status: 400,
		});
	});
});

describe('validateSettingsUpdate: ytdlpExtraFlags', () => {
	it('accepts an array of whitelisted flag strings', async () => {
		const updates = await validateSettingsUpdate({
			ytdlpExtraFlags: ['--sleep-requests', '1', '--no-warnings'],
		});
		expect(updates.ytdlpExtraFlags).toEqual(['--sleep-requests', '1', '--no-warnings']);
	});

	it('rejects a non-array value', async () => {
		await expect(
			validateSettingsUpdate({ ytdlpExtraFlags: '--sleep-requests 1' }),
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects non-whitelisted flags', async () => {
		await expect(
			validateSettingsUpdate({ ytdlpExtraFlags: ['--exec', 'rm -rf /'] }),
		).rejects.toMatchObject({ status: 400, body: { message: 'Forbidden ytdlp flag: --exec' } });
	});
});

describe('validateSettingsUpdate: unknown fields', () => {
	it('rejects settings outside the allowlist', async () => {
		await expect(validateSettingsUpdate({ nope: 1 })).rejects.toMatchObject({ status: 400 });
	});
});
