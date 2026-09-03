import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DownloadStatus } from '@prisma/client';

// In-memory stores backing the prisma mock.
const downloads: Record<string, any> = {};
const archiveDb: Record<string, any> = {};
const subs: Record<string, any> = {};
let settings: any = {};

vi.mock('../db', () => ({
	prisma: {
		download: {
			findUnique: vi.fn(async ({ where }: any) => downloads[where.id] ?? null),
			update: vi.fn(async ({ where, data }: any) => {
				downloads[where.id] = { ...downloads[where.id], ...data };
				return { ...downloads[where.id], profile: {} };
			}),
			delete: vi.fn(async ({ where }: any) => {
				delete downloads[where.id];
			}),
			findFirst: vi.fn(async () => null),
		},
		archive: {
			upsert: vi.fn(async ({ where, create }: any) => {
				archiveDb[where.videoId] = { ...create };
				return archiveDb[where.videoId];
			}),
			deleteMany: vi.fn(async () => ({ count: 0 })),
		},
		subscription: {
			findUnique: vi.fn(async ({ where }: any) => subs[where.id] ?? null),
		},
		settings: {
			findUnique: vi.fn(async () => settings),
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

import { downloadService } from './download.service';
import { ytdlpService } from './ytdlp.service';

const ID = 'dl-skip-1';
const SUB_ID = 'sub-1';

function seedDownload(extra: Record<string, any> = {}) {
	downloads[ID] = {
		id: ID,
		url: 'https://youtube.com/watch?v=short1',
		title: null,
		status: DownloadStatus.PENDING,
		retryCount: 0,
		subscriptionId: SUB_ID,
		filepath: null,
		...extra,
	};
}

describe('fetchMetadata short/premiere skipping', () => {
	beforeEach(() => {
		for (const k of Object.keys(downloads)) delete downloads[k];
		for (const k of Object.keys(archiveDb)) delete archiveDb[k];
		for (const k of Object.keys(subs)) delete subs[k];
		settings = { cookiePath: null, maxDurationSeconds: null, rydEnabled: false };
		(downloadService as any).retryTimeouts.clear();
		vi.restoreAllMocks();
	});

	it('discards an excluded short and archives it with a reason', async () => {
		seedDownload();
		subs[SUB_ID] = { excludeShorts: true };
		vi.spyOn(ytdlpService, 'fetchMetadata').mockResolvedValue({
			title: 'A Short',
			videoId: 'short1',
			videoType: 'short',
			liveStatus: null,
			duration: 45,
		} as any);

		await expect((downloadService as any).fetchMetadata(ID)).rejects.toThrow('short');

		// Record is gone, archive entry carries the skip reason.
		expect(downloads[ID]).toBeUndefined();
		expect(archiveDb['short1']?.reason).toBe('short');
		// No retry was scheduled.
		expect((downloadService as any).retryTimeouts.has(ID)).toBe(false);
	});

	it('keeps the download when the subscription does not exclude shorts', async () => {
		seedDownload();
		subs[SUB_ID] = { excludeShorts: false };
		vi.spyOn(ytdlpService, 'fetchMetadata').mockResolvedValue({
			title: 'A Short',
			videoId: 'short1',
			videoType: 'short',
			liveStatus: null,
			duration: 45,
		} as any);

		await (downloadService as any).fetchMetadata(ID);

		expect(downloads[ID]).toBeDefined();
		expect(downloads[ID].videoType).toBe('short');
		expect(archiveDb['short1']).toBeUndefined();
	});

	it('discards an upcoming premiere without archiving it', async () => {
		seedDownload();
		vi.spyOn(ytdlpService, 'fetchMetadata').mockResolvedValue({
			title: 'Premiere',
			videoId: 'prem1',
			videoType: 'regular',
			liveStatus: 'is_upcoming',
			duration: 600,
		} as any);

		await expect((downloadService as any).fetchMetadata(ID)).rejects.toThrow('upcoming');

		expect(downloads[ID]).toBeUndefined();
		expect(archiveDb['prem1']).toBeUndefined();
	});
});
