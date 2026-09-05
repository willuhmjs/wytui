import { describe, it, expect, vi, beforeEach } from 'vitest';

let settings: any = {
	jellyfinUrl: 'http://jf:8096',
	jellyfinApiKey: 'key',
	libraryPath: '/media',
	musicLibraryPath: null,
};
// Simulated Jellyfin virtual folders + a log of outgoing API calls.
let folders: any[] = [];
const calls: { url: string; method: string }[] = [];

vi.mock('../db', () => ({
	prisma: {
		settings: {
			findUnique: vi.fn(async () => settings),
		},
	},
}));

vi.mock('../utils/fetch', () => ({
	internalFetch: vi.fn(async (url: string, init: any = {}) => {
		const method = init.method ?? 'GET';
		calls.push({ url, method });
		if (method === 'GET') return { ok: true, status: 200, json: async () => folders };
		return { ok: true, status: 204 };
	}),
}));

import { jellyfinService, pathOverlaps } from './jellyfin.service';

const posts = () => calls.filter((c) => c.method === 'POST');
const deletes = () => calls.filter((c) => c.method === 'DELETE');

describe('pathOverlaps', () => {
	it('detects nesting in both directions and ignores equal or sibling paths', () => {
		expect(pathOverlaps('/media', '/media/music')).toBe(true);
		expect(pathOverlaps('/media/music', '/media')).toBe(true);
		expect(pathOverlaps('/media', '/media')).toBe(false);
		expect(pathOverlaps('/media', '/other')).toBe(false);
		expect(pathOverlaps('/media/', '/media/music')).toBe(true);
	});
});

describe('jellyfinService.setupLibrary', () => {
	beforeEach(() => {
		folders = [];
		calls.length = 0;
		settings = {
			jellyfinUrl: 'http://jf:8096',
			jellyfinApiKey: 'key',
			libraryPath: '/media',
			musicLibraryPath: null,
		};
	});

	it('creates once, then reports already-configured without further creates', async () => {
		const first = await jellyfinService.setupLibrary();
		expect(first.video.action).toBe('created');
		expect(first.video.name).toBe('YouTube');
		expect(posts()).toHaveLength(1);

		// Simulate Jellyfin now exposing the created library.
		folders = [{ Name: 'YouTube', CollectionType: 'tvshows', Locations: ['/media'] }];
		calls.length = 0;

		const second = await jellyfinService.setupLibrary();
		expect(second.video.action).toBe('already-configured');
		expect(second.video.name).toBe('YouTube');
		expect(posts()).toHaveLength(0);
		expect(deletes()).toHaveLength(0);
	});

	it('converts a wrong-type library under its existing name', async () => {
		folders = [{ Name: 'Home Videos', CollectionType: 'homevideos', Locations: ['/media'] }];

		const result = await jellyfinService.setupLibrary();
		expect(result.video.action).toBe('converted');
		expect(result.video.name).toBe('Home Videos');
		expect(deletes()).toHaveLength(1);
		expect(deletes()[0].url).toContain('name=Home%20Videos');
		expect(posts()).toHaveLength(1);
		expect(posts()[0].url).toContain('collectionType=tvshows');
		expect(result.video.warnings.join(' ')).toContain('watch history');
	});

	it('refuses to create a library that overlaps another library (no duplicate scanning)', async () => {
		folders = [{ Name: 'Media', CollectionType: 'mixed', Locations: ['/'] }];

		await expect(jellyfinService.setupLibrary()).rejects.toThrow(
			/overlaps with the existing "Media"/,
		);
		expect(posts()).toHaveLength(0);
		expect(deletes()).toHaveLength(0);
	});

	it('serializes concurrent runs so only one library is created', async () => {
		const [a, b] = await Promise.all([
			jellyfinService.setupLibrary(),
			jellyfinService.setupLibrary(),
		]);
		expect(a.video.action).toBe('created');
		expect(b.video.action).toBe('created');
		expect(posts()).toHaveLength(1);
	});

	it('creates the music library too, warning when nested inside the video path', async () => {
		settings.musicLibraryPath = '/media/music';

		const result = await jellyfinService.setupLibrary();
		expect(result.video.action).toBe('created');
		expect(result.music?.action).toBe('created');
		expect(posts()).toHaveLength(2);
		expect(result.music?.warnings.join(' ')).toContain('nested inside');
	});
});
