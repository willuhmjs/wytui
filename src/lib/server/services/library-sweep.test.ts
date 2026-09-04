import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory filesystem backing the fs/promises mock. `files` maps absolute
// paths to metadata; `dirs` maps directory paths to their entry names.
const files = new Map<string, { size: number; mtimeMs: number; isFile: boolean }>();
const dirs = new Map<string, string[]>();

function addFile(path: string, size: number, ageMs = 0, isFile = true) {
	files.set(path, { size, mtimeMs: Date.now() - ageMs, isFile });
	const dir = path.slice(0, path.lastIndexOf('/'));
	if (!dirs.has(dir)) dirs.set(dir, []);
	dirs.get(dir)!.push(path.slice(path.lastIndexOf('/') + 1));
}

function addDir(path: string) {
	const parent = path.slice(0, path.lastIndexOf('/'));
	if (!dirs.has(parent)) dirs.set(parent, []);
	dirs.get(parent)!.push(path.slice(path.lastIndexOf('/') + 1));
	dirs.set(path, []);
}

function exists(path: string) {
	return files.has(path);
}

vi.mock('fs/promises', () => {
	const mocked = {
		unlink: vi.fn(async (p: string) => {
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
		rmdir: vi.fn(async (dir: string) => {
			dirs.delete(dir);
			const parent = dir.slice(0, dir.lastIndexOf('/'));
			const name = dir.slice(dir.lastIndexOf('/') + 1);
			const entries = dirs.get(parent);
			if (entries)
				dirs.set(
					parent,
					entries.filter((e) => e !== name),
				);
		}),
		readdir: vi.fn(async (dir: string, opts?: { withFileTypes?: boolean }) => {
			const entries = [...(dirs.get(dir) ?? [])];
			if (opts?.withFileTypes) {
				return entries.map((name) => ({
					name,
					isDirectory: () => dirs.has(`${dir}/${name}`),
				}));
			}
			return entries;
		}),
		stat: vi.fn(async (p: string) => {
			const f = files.get(p);
			if (!f) throw new Error(`ENOENT: ${p}`);
			return { ...f, isFile: () => f.isFile };
		}),
		statfs: vi.fn(async () => ({ bsize: 4096, blocks: 1024, bavail: 512 })),
		access: vi.fn(async (p: string) => {
			if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
		}),
		copyFile: vi.fn(async () => {}),
		mkdir: vi.fn(async () => {}),
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
	},
};
const downloadsDb: { filepath: string }[] = [];

vi.mock('../db', () => ({
	prisma: {
		settings: {
			findUnique: vi.fn(async () => settingsDb.singleton),
			create: vi.fn(async () => settingsDb.singleton),
		},
		download: {
			findMany: vi.fn(async () => downloadsDb),
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

import { libraryService } from './library.service';

const DAY = 24 * 60 * 60 * 1000;

describe('sweepOrphanedDownloads', () => {
	beforeEach(() => {
		files.clear();
		dirs.clear();
		downloadsDb.length = 0;
	});

	it('deletes stale orphans but keeps tracked files, their sidecars, and fresh files', async () => {
		downloadsDb.push({ filepath: '/downloads/tracked.mp4' });
		addFile('/downloads/tracked.mp4', 100, 3 * DAY); // tracked: age irrelevant
		addFile('/downloads/tracked.mp4.part', 50, 3 * DAY); // stem sibling of tracked
		addFile('/downloads/tracked.en.vtt', 1, 3 * DAY); // stem sibling of tracked
		addFile('/downloads/stale.part', 500, 2 * DAY); // orphan, past grace
		addFile('/downloads/stale.webp', 5, 2 * DAY); // orphan, past grace
		addFile('/downloads/fresh.f137.mp4.part', 500, 5 * 60 * 1000); // orphan, in grace

		const result = await libraryService.sweepOrphanedDownloads();

		expect(result.deletedCount).toBe(2);
		expect(result.freedBytes).toBe(505n);
		expect(exists('/downloads/tracked.mp4')).toBe(true);
		expect(exists('/downloads/tracked.mp4.part')).toBe(true);
		expect(exists('/downloads/tracked.en.vtt')).toBe(true);
		expect(exists('/downloads/stale.part')).toBe(false);
		expect(exists('/downloads/stale.webp')).toBe(false);
		expect(exists('/downloads/fresh.f137.mp4.part')).toBe(true);
	});

	it('ignores directory entries such as lost+found', async () => {
		addDir('/downloads');
		addDir('/downloads/lost+found');

		const result = await libraryService.sweepOrphanedDownloads();

		expect(result.deletedCount).toBe(0);
		expect(dirs.has('/downloads/lost+found')).toBe(true);
	});

	it('never sweeps when the download path overlaps a configured library', async () => {
		addFile('/downloads/video.mp4', 100, 3 * DAY);
		const original = settingsDb.singleton.libraryPath;
		settingsDb.singleton.libraryPath = '/downloads';

		try {
			const result = await libraryService.sweepOrphanedDownloads();
			expect(result.deletedCount).toBe(0);
			expect(exists('/downloads/video.mp4')).toBe(true);
		} finally {
			settingsDb.singleton.libraryPath = original;
		}
	});

	it('force mode (maxAgeHours 0) still protects tracked stems', async () => {
		downloadsDb.push({ filepath: '/downloads/active.mp4' });
		addFile('/downloads/active.mp4', 100, 0);
		addFile('/downloads/active.mp4.part', 50, 0);
		addFile('/downloads/orphan.part', 500, 0);

		const result = await libraryService.sweepOrphanedDownloads({ maxAgeHours: 0 });

		expect(result.deletedCount).toBe(1);
		expect(exists('/downloads/active.mp4')).toBe(true);
		expect(exists('/downloads/active.mp4.part')).toBe(true);
		expect(exists('/downloads/orphan.part')).toBe(false);
	});
});

describe('removeVideoArtifacts', () => {
	beforeEach(() => {
		files.clear();
		dirs.clear();
		downloadsDb.length = 0;
	});

	it('removes stem artifacts next to a cache file without touching neighbours', async () => {
		addFile('/downloads/video.mp4', 100);
		addFile('/downloads/video.en.vtt', 1);
		addFile('/downloads/video.webp', 2);
		addFile('/downloads/other.mp4', 100);

		await libraryService.removeVideoArtifacts('/downloads/video.mp4');

		expect(exists('/downloads/video.mp4')).toBe(false);
		expect(exists('/downloads/video.en.vtt')).toBe(false);
		expect(exists('/downloads/video.webp')).toBe(false);
		expect(exists('/downloads/other.mp4')).toBe(true);
	});

	it('removes artwork and the video directory when a library video is deleted', async () => {
		addDir('/media');
		addDir('/media/Chan');
		addFile('/media/Chan/folder.jpg', 3); // channel art stays
		addDir('/media/Chan/Title');
		addFile('/media/Chan/Title/Title.mp4', 100);
		addFile('/media/Chan/Title/Title.en.vtt', 1);
		addFile('/media/Chan/Title/poster.jpg', 4);
		addFile('/media/Chan/Title/backdrop.jpg', 4);

		await libraryService.removeVideoArtifacts('/media/Chan/Title/Title.mp4');

		expect(exists('/media/Chan/Title/Title.mp4')).toBe(false);
		expect(exists('/media/Chan/Title/poster.jpg')).toBe(false);
		expect(exists('/media/Chan/Title/backdrop.jpg')).toBe(false);
		expect(dirs.has('/media/Chan/Title')).toBe(false);
		expect(exists('/media/Chan/folder.jpg')).toBe(true);
		expect(dirs.has('/media/Chan')).toBe(true);
	});

	it('keeps the library directory when other media remains in it', async () => {
		addDir('/media/Chan/Title');
		addFile('/media/Chan/Title/Title.mp4', 100);
		addFile('/media/Chan/Title/extra.mkv', 100);

		await libraryService.removeVideoArtifacts('/media/Chan/Title/Title.mp4');

		expect(exists('/media/Chan/Title/extra.mkv')).toBe(true);
		expect(dirs.has('/media/Chan/Title')).toBe(true);
	});
});

describe('sweepLibraryHusks', () => {
	beforeEach(() => {
		files.clear();
		dirs.clear();
	});

	it('removes artwork-only video folders but keeps folders with media and channel art', async () => {
		addDir('/media/Chan');
		addFile('/media/Chan/folder.jpg', 3);
		addDir('/media/Chan/Alive');
		addFile('/media/Chan/Alive/Alive.mp4', 100);
		addDir('/media/Chan/Husk');
		addFile('/media/Chan/Husk/poster.jpg', 4);
		addFile('/media/Chan/Husk/backdrop.jpg', 4);

		const removed = await libraryService.sweepLibraryHusks();

		expect(removed).toBe(1);
		expect(dirs.has('/media/Chan/Husk')).toBe(false);
		expect(dirs.has('/media/Chan/Alive')).toBe(true);
		expect(exists('/media/Chan/folder.jpg')).toBe(true);
	});
});
