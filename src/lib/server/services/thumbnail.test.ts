import { describe, it, expect, vi } from 'vitest';
import { resolveBestThumbnailUrl } from './thumbnail';

describe('resolveBestThumbnailUrl', () => {
	it('prefers YouTube maxresdefault when it exists', async () => {
		const head = vi.fn(async (u: string) => u.includes('maxresdefault'));
		const url = await resolveBestThumbnailUrl({ videoId: 'abc12345678' }, head);
		expect(url).toBe('https://i.ytimg.com/vi/abc12345678/maxresdefault.jpg');
	});

	it('falls back down the YouTube chain', async () => {
		const head = vi.fn(async (u: string) => u.includes('hqdefault'));
		const url = await resolveBestThumbnailUrl({ videoId: 'abc12345678' }, head);
		expect(url).toBe('https://i.ytimg.com/vi/abc12345678/hqdefault.jpg');
	});

	it('picks the largest entry for non-YouTube', async () => {
		const url = await resolveBestThumbnailUrl(
			{
				thumbnails: [
					{ url: 'small.jpg', width: 320, height: 180 },
					{ url: 'big.jpg', width: 1920, height: 1080 },
				],
			},
			async () => true,
		);
		expect(url).toBe('big.jpg');
	});

	it('falls back to the plain thumbnail field when nothing else', async () => {
		const url = await resolveBestThumbnailUrl({ thumbnail: 'only.jpg' }, async () => false);
		expect(url).toBe('only.jpg');
	});

	it('returns null when no source is available', async () => {
		const url = await resolveBestThumbnailUrl({}, async () => false);
		expect(url).toBeNull();
	});
});
