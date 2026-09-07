import { describe, it, expect, vi, beforeEach } from 'vitest';

const existingPaths = new Set<string>();
const marks: { status: string; ids: string[] }[] = [];
const recordDeletes: string[][] = [];
let rows: { id: string; filepath: string | null }[] = [];

vi.mock('fs/promises', () => ({
	access: vi.fn(async (p: string) => {
		if (!existingPaths.has(p)) throw new Error(`ENOENT: ${p}`);
	}),
}));

vi.mock('../db', () => ({
	prisma: {
		download: {
			findMany: vi.fn(async () => rows),
			updateMany: vi.fn(async ({ where, data }: any) => {
				marks.push({ status: data.status, ids: [...where.id.in] });
				return { count: where.id.in.length };
			}),
			deleteMany: vi.fn(async ({ where }: any) => {
				recordDeletes.push([...where.id.in]);
				return { count: where.id.in.length };
			}),
		},
		watchProgress: { deleteMany: vi.fn(async () => ({ count: 0 })) },
		playlistItem: { deleteMany: vi.fn(async () => ({ count: 0 })) },
	},
}));

import { rescanService } from './rescan.service';

describe('rescan reconcile', () => {
	beforeEach(() => {
		existingPaths.clear();
		marks.length = 0;
		recordDeletes.length = 0;
		rows = [];
	});

	it('skips rows whose file exists again before marking them DELETED', async () => {
		rows = [
			{ id: 'gone', filepath: '/media/gone.mp4' },
			{ id: 'back', filepath: '/media/back.mp4' },
		];
		existingPaths.add('/media/back.mp4');

		const result = await rescanService.reconcile({ markMissing: ['gone', 'back'] });

		expect(result).toEqual({ marked: 1, deleted: 0, skipped: 1 });
		expect(marks).toEqual([{ status: 'DELETED', ids: ['gone'] }]);
	});

	it('skips rows whose file exists again before deleting their records', async () => {
		rows = [
			{ id: 'gone', filepath: '/media/gone.mp4' },
			{ id: 'back', filepath: '/media/back.mp4' },
		];
		existingPaths.add('/media/back.mp4');

		const result = await rescanService.reconcile({ deleteRecords: ['gone', 'back'] });

		expect(result).toEqual({ marked: 0, deleted: 1, skipped: 1 });
		expect(recordDeletes).toEqual([['gone']]);
	});

	it('treats rows without a filepath as missing', async () => {
		rows = [{ id: 'nullfp', filepath: null }];

		const result = await rescanService.reconcile({ markMissing: ['nullfp'] });

		expect(result).toEqual({ marked: 1, deleted: 0, skipped: 0 });
	});
});
