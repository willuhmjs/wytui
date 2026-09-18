import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory filesystem backing the fs/promises mock (same approach as
// library-sweep.test.ts, with a copyFile that materialises files). `calls`
// records the order of the operations that must not race.
const files = new Map<string, { size: number; isFile: boolean }>();
const dirs = new Map<string, string[]>();
const calls: string[] = [];

function addFile(path: string, size: number) {
	files.set(path, { size, isFile: true });
	const dir = path.slice(0, path.lastIndexOf('/'));
	const name = path.slice(path.lastIndexOf('/') + 1);
	if (!dirs.has(dir)) dirs.set(dir, []);
	if (!dirs.get(dir)!.includes(name)) dirs.get(dir)!.push(name);
}

function addDir(path: string) {
	const parent = path.slice(0, path.lastIndexOf('/'));
	const name = path.slice(path.lastIndexOf('/') + 1);
	if (!dirs.has(parent)) dirs.set(parent, []);
	if (!dirs.get(parent)!.includes(name)) dirs.get(parent)!.push(name);
	dirs.set(path, []);
}

vi.mock('fs/promises', () => {
	const mocked = {
		unlink: vi.fn(async (p: string) => {
			calls.push(`unlink:${p}`);
			files.delete(p);
			const dir = p.slice(0, p.lastIndexOf('/'));
			const name = p.slice(p.lastIndexOf('/') + 1);
			const entries = dirs.get(dir);
			if (entries)
				dirs.set(
					dir,
					entries.filter((e) => e !== name),
				);
		}),
		rmdir: vi.fn(async () => {}),
		readdir: vi.fn(async (dir: string) => [...(dirs.get(dir) ?? [])]),
		stat: vi.fn(async (p: string) => {
			const f = files.get(p);
			if (!f) throw new Error(`ENOENT: ${p}`);
			return { size: f.size, isFile: () => f.isFile };
		}),
		statfs: vi.fn(async () => ({ bsize: 4096, blocks: 1024, bavail: 512 })),
		access: vi.fn(async (p: string) => {
			if (!files.has(p) && !dirs.has(p)) throw new Error(`ENOENT: ${p}`);
		}),
		copyFile: vi.fn(async (src: string, dest: string) => {
			calls.push(`copy:${dest}`);
			const f = files.get(src);
			if (!f) throw new Error(`ENOENT: ${src}`);
			addFile(dest, f.size);
		}),
		mkdir: vi.fn(async (dir: string) => addDir(dir)),
		writeFile: vi.fn(async () => {}),
	};
	return { ...mocked, default: mocked };
});

const settingsDb: Record<string, any> = {
	singleton: {
		id: 'singleton',
		downloadPath: '/downloads',
		libraryPath: '/media',
		musicLibraryPath: null,
		jellyfinUrl: null,
		plexUrl: null,
	},
};
const downloadDb = new Map<string, any>();

vi.mock('../db', () => ({
	prisma: {
		settings: {
			findUnique: vi.fn(async () => settingsDb.singleton),
			create: vi.fn(async () => settingsDb.singleton),
		},
		eventLog: {
			create: vi.fn(async () => ({})),
			deleteMany: vi.fn(async () => ({ count: 0 })),
		},
		download: {
			// Return copies: the real client never mutates the row the caller
			// already holds, and the promote flow relies on that.
			findUnique: vi.fn(async ({ where }: any) => {
				const row = downloadDb.get(where.id);
				return row ? { ...row, profile: { ...row.profile } } : null;
			}),
			findMany: vi.fn(async () =>
				[...downloadDb.values()].map((row: any) => ({ ...row, profile: { ...row.profile } })),
			),
			update: vi.fn(async (args: any) => {
				calls.push(`update:${args.data.filepath ?? ''}`);
				const row = downloadDb.get(args.where.id);
				if (row) Object.assign(row, args.data);
				return row;
			}),
		},
	},
}));

vi.mock('../sse/emitter', () => ({
	sseEmitter: {
		broadcast: vi.fn(),
		broadcastToUser: vi.fn(),
		setInitialStateCallback: vi.fn(),
	},
}));

vi.mock('./thumbnail', () => ({ resolveBestThumbnailUrl: vi.fn(async () => null) }));
vi.mock('./artwork', () => ({
	writeJellyfinArtwork: vi.fn(async () => {}),
	writePosterFromBuffer: vi.fn(async () => {}),
}));
vi.mock('./nfo.service', () => ({
	nfoService: { syncChannel: vi.fn(async () => ({ channelUrl: null, movies: 0 })) },
}));
vi.mock('./ytdlp.service', () => ({
	ytdlpService: { fetchChannelThumbnail: vi.fn(async () => null) },
}));

import { libraryService } from './library.service';

function makeDownload(id: string, overrides: Record<string, any> = {}) {
	return {
		id,
		status: 'COMPLETED',
		storagePool: 'library',
		filepath: '/downloads/video.mp4',
		filename: 'video.mp4',
		title: 'My Video',
		uploader: 'Chan',
		channelUrl: null,
		videoId: 'abc12345678',
		thumbnail: null,
		userId: null,
		profile: { audioOnly: false },
		...overrides,
	};
}

describe('promoteToLibrary', () => {
	beforeEach(() => {
		files.clear();
		dirs.clear();
		calls.length = 0;
		downloadDb.clear();
	});

	it('points the record at the destination before removing the source file', async () => {
		downloadDb.set('d1', makeDownload('d1'));
		addFile('/downloads/video.mp4', 100);

		await libraryService.promoteToLibrary('d1');

		const seq = calls.filter((c) => /^(copy|update|unlink):/.test(c));
		expect(seq).toEqual([
			'copy:/media/Chan/My Video/My Video.mp4',
			'update:/media/Chan/My Video/My Video.mp4',
			'unlink:/downloads/video.mp4',
		]);
		expect(downloadDb.get('d1').filepath).toBe('/media/Chan/My Video/My Video.mp4');
	});

	it('reuses a destination left by an interrupted promotion instead of forking a duplicate', async () => {
		downloadDb.set('d2', makeDownload('d2'));
		addFile('/downloads/video.mp4', 100);
		addDir('/media/Chan/My Video');
		addFile('/media/Chan/My Video/My Video.mp4', 100); // interrupted promote left this
		addFile('/downloads/video.en.vtt', 1);

		await libraryService.promoteToLibrary('d2');

		expect(dirs.has('/media/Chan/My Video (1)')).toBe(false);
		expect(calls).not.toContain('copy:/media/Chan/My Video/My Video.mp4');
		expect(downloadDb.get('d2').filepath).toBe('/media/Chan/My Video/My Video.mp4');
		expect(files.has('/downloads/video.mp4')).toBe(false);
		expect(files.has('/media/Chan/My Video/My Video.en.vtt')).toBe(true);
	});

	it('still suffixes when the existing destination is a different file', async () => {
		downloadDb.set('d3', makeDownload('d3'));
		addFile('/downloads/video.mp4', 100);
		addDir('/media/Chan/My Video');
		addFile('/media/Chan/My Video/My Video.mp4', 999); // same title, different video

		await libraryService.promoteToLibrary('d3');

		expect(downloadDb.get('d3').filepath).toBe('/media/Chan/My Video (1)/My Video (1).mp4');
		expect(files.has('/media/Chan/My Video (1)/My Video (1).mp4')).toBe(true);
		expect(files.has('/media/Chan/My Video/My Video.mp4')).toBe(true);
	});
});

describe('resumeInterruptedPromotions', () => {
	beforeEach(() => {
		files.clear();
		dirs.clear();
		calls.length = 0;
		downloadDb.clear();
	});

	it('completes library downloads still pointing at the download directory', async () => {
		downloadDb.set('stuck', makeDownload('stuck', { filepath: '/downloads/stuck.mp4' }));
		addFile('/downloads/stuck.mp4', 50);
		downloadDb.set('fine', makeDownload('fine', { filepath: '/media/Chan/Done/Done.mp4' }));
		addFile('/media/Chan/Done/Done.mp4', 50);

		const resumed = await libraryService.resumeInterruptedPromotions();

		expect(resumed).toBe(1);
		expect(downloadDb.get('stuck').filepath).toBe('/media/Chan/My Video/My Video.mp4');
		expect(files.has('/downloads/stuck.mp4')).toBe(false);
		expect(downloadDb.get('fine').filepath).toBe('/media/Chan/Done/Done.mp4');
	});
});
