import { describe, it, expect, vi, beforeEach } from 'vitest';
import { unlink } from 'fs/promises';

// In-memory stores backing the prisma mock.
const DAY = 24 * 60 * 60 * 1000;
let settingsDb: Record<string, any> | null = null;
const overridesDb: any[] = [];
const watchProgressDb: any[] = [];
const downloadsDb: any[] = [];

vi.mock('../db', () => ({
	prisma: {
		settings: {
			findUnique: vi.fn(async () => settingsDb),
		},
		channelOverride: {
			findMany: vi.fn(async () => overridesDb),
		},
		watchProgress: {
			findMany: vi.fn(async () => watchProgressDb),
		},
		download: {
			findMany: vi.fn(async ({ where }: any) =>
				downloadsDb.filter(
					(d) =>
						(where.status === undefined || d.status === where.status) &&
						(where.storagePool === undefined || d.storagePool === where.storagePool) &&
						(where.protected === undefined || d.protected === where.protected) &&
						(where.allWatchedAt === undefined ||
							(where.allWatchedAt.not === null ? d.allWatchedAt !== null : true)),
				),
			),
			update: vi.fn(async ({ where, data }: any) => {
				const row = downloadsDb.find((d) => d.id === where.id);
				if (!row) throw new Error('download not found: ' + where.id);
				Object.assign(row, data);
				return row;
			}),
			delete: vi.fn(async ({ where }: any) => {
				const i = downloadsDb.findIndex((d) => d.id === where.id);
				if (i !== -1) downloadsDb.splice(i, 1);
			}),
		},
	},
}));

vi.mock('./library.service', () => ({
	libraryService: {
		removeVideoArtifacts: vi.fn(async () => {}),
		triggerLibraryScan: vi.fn(async () => {}),
	},
}));

vi.mock('../sse/emitter', () => ({
	sseEmitter: {
		broadcast: vi.fn(),
		broadcastToUser: vi.fn(),
		setInitialStateCallback: vi.fn(),
	},
}));

vi.mock('fs/promises', () => {
	// `default` must alias the mock itself: vitest's builtin interop resolves
	// named imports through `default` when it exists (same approach as
	// library-promote.test.ts).
	const mocked = {
		unlink: vi.fn(async () => {}),
	};
	return { ...mocked, default: mocked };
});

import { autoDeleteService } from './auto-delete.service';
import { libraryService } from './library.service';
import { sseEmitter } from '../sse/emitter';
import { DownloadStatus } from '@prisma/client';

const CHAN = 'https://www.youtube.com/channel/UCtest';

function download(overrides: Record<string, any> = {}) {
	return {
		id: 'dl-1',
		url: 'https://www.youtube.com/watch?v=vid1',
		title: 'Video',
		status: DownloadStatus.COMPLETED,
		storagePool: 'cache',
		filepath: '/data/cache/video.mp4',
		userId: null,
		channelUrl: CHAN,
		protected: false,
		allWatchedAt: null,
		...overrides,
	};
}

function watched(downloadRow: any, daysAgo = 30) {
	return {
		watched: true,
		watchedAt: new Date(Date.now() - daysAgo * DAY),
		updatedAt: new Date(Date.now() - daysAgo * DAY),
		download: downloadRow,
	};
}

beforeEach(() => {
	settingsDb = null;
	overridesDb.length = 0;
	watchProgressDb.length = 0;
	downloadsDb.length = 0;
	vi.clearAllMocks();
});

describe('deleteWatchedOverThreshold: library retention opt-in', () => {
	it('never deletes library items when autoDeleteLibraryDays is unset, even with cache retention on', async () => {
		settingsDb = { autoDeleteWatchedDays: 7, autoDeleteLibraryDays: null };
		const lib = download({ id: 'lib-1', storagePool: 'library' });
		downloadsDb.push(lib);
		watchProgressDb.push(watched(lib, 30));

		const result = await autoDeleteService.deleteWatchedOverThreshold();

		expect(result.deleted).toBe(0);
		expect(downloadsDb).toHaveLength(1);
		expect(lib.status).toBe(DownloadStatus.COMPLETED);
		expect(vi.mocked(unlink)).not.toHaveBeenCalled();
	});

	it('turns a watched library item into a DELETED tombstone (row kept, file removed, scan triggered)', async () => {
		settingsDb = { autoDeleteWatchedDays: 0, autoDeleteLibraryDays: 7 };
		const lib = download({ id: 'lib-1', storagePool: 'library' });
		downloadsDb.push(lib);
		watchProgressDb.push(watched(lib, 30));

		const result = await autoDeleteService.deleteWatchedOverThreshold();

		expect(result.deleted).toBe(1);
		// Tombstone: row survives with DELETED status and no filepath.
		expect(downloadsDb).toHaveLength(1);
		expect(lib.status).toBe(DownloadStatus.DELETED);
		expect(lib.filepath).toBeNull();
		expect(vi.mocked(unlink)).toHaveBeenCalledWith('/data/cache/video.mp4');
		expect(vi.mocked(libraryService.removeVideoArtifacts)).toHaveBeenCalledWith(
			'/data/cache/video.mp4',
		);
		expect(vi.mocked(libraryService.triggerLibraryScan)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(sseEmitter.broadcast)).toHaveBeenCalledWith('download:updated', {
			id: 'lib-1',
			status: 'DELETED',
			filepath: null,
		});
	});

	it('ages out a library item watched only in Jellyfin (allWatchedAt, no watch_progress row)', async () => {
		settingsDb = { autoDeleteWatchedDays: 0, autoDeleteLibraryDays: 7 };
		const lib = download({
			id: 'lib-1',
			storagePool: 'library',
			allWatchedAt: new Date(Date.now() - 30 * DAY),
		});
		downloadsDb.push(lib);

		const result = await autoDeleteService.deleteWatchedOverThreshold();

		expect(result.deleted).toBe(1);
		expect(lib.status).toBe(DownloadStatus.DELETED);
	});

	it('deletes an item appearing in both watched signals only once', async () => {
		settingsDb = { autoDeleteWatchedDays: 0, autoDeleteLibraryDays: 7 };
		const lib = download({
			id: 'lib-1',
			storagePool: 'library',
			allWatchedAt: new Date(Date.now() - 30 * DAY),
		});
		downloadsDb.push(lib);
		watchProgressDb.push(watched(lib, 30));

		const result = await autoDeleteService.deleteWatchedOverThreshold();

		expect(result.deleted).toBe(1);
		expect(vi.mocked(unlink)).toHaveBeenCalledTimes(1);
	});
});

describe('deleteWatchedOverThreshold: protection', () => {
	it('skips a protected (pinned) download', async () => {
		settingsDb = { autoDeleteWatchedDays: 0, autoDeleteLibraryDays: 7 };
		const lib = download({ id: 'lib-1', storagePool: 'library', protected: true });
		downloadsDb.push(lib);
		watchProgressDb.push(watched(lib, 30));

		const result = await autoDeleteService.deleteWatchedOverThreshold();

		expect(result.deleted).toBe(0);
		expect(lib.status).toBe(DownloadStatus.COMPLETED);
	});

	it('skips every download of a protected channel', async () => {
		settingsDb = { autoDeleteWatchedDays: 0, autoDeleteLibraryDays: 7 };
		overridesDb.push({ channelUrl: CHAN, protected: true, autoDeleteDays: null });
		const lib = download({ id: 'lib-1', storagePool: 'library' });
		downloadsDb.push(lib);
		watchProgressDb.push(watched(lib, 30));

		const result = await autoDeleteService.deleteWatchedOverThreshold();

		expect(result.deleted).toBe(0);
		expect(lib.status).toBe(DownloadStatus.COMPLETED);
	});
});

describe('deleteWatchedOverThreshold: per-channel override', () => {
	it('uses the channel autoDeleteDays override instead of the global threshold', async () => {
		settingsDb = { autoDeleteWatchedDays: 0, autoDeleteLibraryDays: 30 };
		overridesDb.push({ channelUrl: CHAN, protected: false, autoDeleteDays: 7 });
		const chann = download({ id: 'lib-1', storagePool: 'library' });
		const other = download({
			id: 'lib-2',
			storagePool: 'library',
			channelUrl: 'https://www.youtube.com/channel/UCother',
		});
		downloadsDb.push(chann, other);
		// Both watched 10 days ago: past the 7-day override, inside the 30-day global.
		watchProgressDb.push(watched(chann, 10), watched(other, 10));

		const result = await autoDeleteService.deleteWatchedOverThreshold();

		expect(result.deleted).toBe(1);
		expect(chann.status).toBe(DownloadStatus.DELETED);
		expect(other.status).toBe(DownloadStatus.COMPLETED);
	});
});

describe('deleteWatchedOverThreshold: cache pool is unchanged', () => {
	it('removes the row entirely (no tombstone) and never triggers a library scan', async () => {
		settingsDb = { autoDeleteWatchedDays: 7, autoDeleteLibraryDays: null };
		const cache = download({ id: 'cache-1' });
		downloadsDb.push(cache);
		watchProgressDb.push(watched(cache, 10));

		const result = await autoDeleteService.deleteWatchedOverThreshold();

		expect(result.deleted).toBe(1);
		expect(downloadsDb).toHaveLength(0);
		expect(vi.mocked(unlink)).toHaveBeenCalledWith('/data/cache/video.mp4');
		expect(vi.mocked(libraryService.triggerLibraryScan)).not.toHaveBeenCalled();
		expect(vi.mocked(sseEmitter.broadcast)).toHaveBeenCalledWith('download:deleted', {
			id: 'cache-1',
		});
	});

	it('keeps cache items newer than the threshold', async () => {
		settingsDb = { autoDeleteWatchedDays: 7, autoDeleteLibraryDays: null };
		const cache = download({ id: 'cache-1' });
		downloadsDb.push(cache);
		watchProgressDb.push(watched(cache, 3));

		const result = await autoDeleteService.deleteWatchedOverThreshold();

		expect(result.deleted).toBe(0);
		expect(downloadsDb).toHaveLength(1);
	});
});
