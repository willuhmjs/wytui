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
			upsert: vi.fn(async ({ where, create, update }: any) => {
				// Real upsert semantics: an existing row is updated (not
				// rebuilt from `create`), so tests can pin the update branch.
				archiveDb[where.videoId] = archiveDb[where.videoId]
					? { ...archiveDb[where.videoId], ...update }
					: { ...create };
				return archiveDb[where.videoId];
			}),
			deleteMany: vi.fn(async () => ({ count: 0 })),
		},
		eventLog: {
			create: vi.fn(async () => ({})),
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

describe('fetchMetadata subscription max-duration skipping', () => {
	beforeEach(() => {
		for (const k of Object.keys(downloads)) delete downloads[k];
		for (const k of Object.keys(archiveDb)) delete archiveDb[k];
		for (const k of Object.keys(subs)) delete subs[k];
		settings = { cookiePath: null, maxDurationSeconds: null, rydEnabled: false };
		(downloadService as any).retryTimeouts.clear();
		vi.restoreAllMocks();
	});

	it('discards a video over the subscription limit and archives it with a reason', async () => {
		seedDownload({ url: 'https://youtube.com/watch?v=long1' });
		subs[SUB_ID] = { excludeShorts: false, maxDurationSeconds: 3600 };
		vi.spyOn(ytdlpService, 'fetchMetadata').mockResolvedValue({
			title: '4h Stream VOD',
			videoId: 'long1',
			videoType: 'regular',
			liveStatus: null,
			duration: 4 * 3600,
		} as any);

		await expect((downloadService as any).fetchMetadata(ID)).rejects.toThrow('duration');

		// Record is gone, archive entry carries the skip reason.
		expect(downloads[ID]).toBeUndefined();
		expect(archiveDb['long1']?.reason).toBe('duration');
		expect((downloadService as any).retryTimeouts.has(ID)).toBe(false);
	});

	it('keeps the download when the duration is within the subscription limit', async () => {
		seedDownload();
		subs[SUB_ID] = { excludeShorts: false, maxDurationSeconds: 3600 };
		vi.spyOn(ytdlpService, 'fetchMetadata').mockResolvedValue({
			title: 'Regular video',
			videoId: 'ok1',
			videoType: 'regular',
			liveStatus: null,
			duration: 1800,
		} as any);

		await (downloadService as any).fetchMetadata(ID);

		expect(downloads[ID]).toBeDefined();
		expect(archiveDb['ok1']).toBeUndefined();
	});

	it('keeps the download when the subscription has no limit', async () => {
		seedDownload();
		subs[SUB_ID] = { excludeShorts: false, maxDurationSeconds: null };
		vi.spyOn(ytdlpService, 'fetchMetadata').mockResolvedValue({
			title: 'Long video',
			videoId: 'nolimit1',
			videoType: 'regular',
			liveStatus: null,
			duration: 5 * 3600,
		} as any);

		await (downloadService as any).fetchMetadata(ID);

		expect(downloads[ID]).toBeDefined();
		expect(archiveDb['nolimit1']).toBeUndefined();
	});
});

describe('fetchMetadata global max-duration skipping', () => {
	beforeEach(() => {
		for (const k of Object.keys(downloads)) delete downloads[k];
		for (const k of Object.keys(archiveDb)) delete archiveDb[k];
		for (const k of Object.keys(subs)) delete subs[k];
		settings = { cookiePath: null, maxDurationSeconds: 7200, rydEnabled: false };
		(downloadService as any).retryTimeouts.clear();
		vi.restoreAllMocks();
	});

	it('discards a video over the global limit and archives it with a reason', async () => {
		seedDownload({ url: 'https://youtube.com/watch?v=toolong1' });
		vi.spyOn(ytdlpService, 'fetchMetadata').mockResolvedValue({
			title: '3h Documentary',
			videoId: 'toolong1',
			videoType: 'regular',
			liveStatus: null,
			duration: 3 * 3600,
		} as any);

		const promise = (downloadService as any).fetchMetadata(ID);
		// The skip must surface as DownloadSkippedError itself — the queue
		// handler's instanceof check depends on it not being re-wrapped.
		await expect(promise).rejects.toMatchObject({ name: 'DownloadSkippedError' });
		await expect(promise).rejects.toThrow('duration');

		// Record is gone, archive entry carries the skip reason, no retry.
		expect(downloads[ID]).toBeUndefined();
		expect(archiveDb['toolong1']?.reason).toBe('duration');
		expect((downloadService as any).retryTimeouts.has(ID)).toBe(false);
	});

	it('keeps the download when the duration is within the global limit', async () => {
		seedDownload({ url: 'https://youtube.com/watch?v=okglobal1' });
		vi.spyOn(ytdlpService, 'fetchMetadata').mockResolvedValue({
			title: 'Under the limit',
			videoId: 'okglobal1',
			videoType: 'regular',
			liveStatus: null,
			duration: 3600,
		} as any);

		await (downloadService as any).fetchMetadata(ID);

		expect(downloads[ID]).toBeDefined();
		expect(archiveDb['okglobal1']).toBeUndefined();
	});

	it('lets a subscription without a limit fall through to the global limit', async () => {
		seedDownload({ url: 'https://youtube.com/watch?v=subfall1' });
		subs[SUB_ID] = { excludeShorts: false, maxDurationSeconds: null };
		vi.spyOn(ytdlpService, 'fetchMetadata').mockResolvedValue({
			title: 'Long stream VOD',
			videoId: 'subfall1',
			videoType: 'regular',
			liveStatus: null,
			duration: 10 * 3600,
		} as any);

		await expect((downloadService as any).fetchMetadata(ID)).rejects.toThrow('duration');

		expect(downloads[ID]).toBeUndefined();
		expect(archiveDb['subfall1']?.reason).toBe('duration');
	});

	it('keeps a video exactly at the global limit (boundary is inclusive)', async () => {
		seedDownload({ url: 'https://youtube.com/watch?v=boundary1' });
		vi.spyOn(ytdlpService, 'fetchMetadata').mockResolvedValue({
			title: 'Exactly two hours',
			videoId: 'boundary1',
			videoType: 'regular',
			liveStatus: null,
			duration: 7200,
		} as any);

		await (downloadService as any).fetchMetadata(ID);

		expect(downloads[ID]).toBeDefined();
		expect(archiveDb['boundary1']).toBeUndefined();
	});

	it('skips a video one second over the global limit', async () => {
		seedDownload({ url: 'https://youtube.com/watch?v=boundary2' });
		vi.spyOn(ytdlpService, 'fetchMetadata').mockResolvedValue({
			title: 'Two hours and one second',
			videoId: 'boundary2',
			videoType: 'regular',
			liveStatus: null,
			duration: 7201,
		} as any);

		await expect((downloadService as any).fetchMetadata(ID)).rejects.toThrow('duration');

		expect(downloads[ID]).toBeUndefined();
		expect(archiveDb['boundary2']?.reason).toBe('duration');
	});

	it('flips an existing failed-archive row to duration on a limit skip', async () => {
		// Real-world shape: the video failed terminally (archived 'failed'),
		// the user retried, and metadata now shows it over the limit. The
		// upsert's update branch must carry the reason flip.
		seedDownload({ url: 'https://youtube.com/watch?v=flip1' });
		archiveDb['flip1'] = {
			videoId: 'flip1',
			url: 'https://youtube.com/watch?v=flip1',
			title: 'Previously failed',
			reason: 'failed',
			failedAt: new Date(),
		};
		vi.spyOn(ytdlpService, 'fetchMetadata').mockResolvedValue({
			title: 'Previously failed',
			videoId: 'flip1',
			videoType: 'regular',
			liveStatus: null,
			duration: 3 * 3600,
		} as any);

		await expect((downloadService as any).fetchMetadata(ID)).rejects.toThrow('duration');

		expect(archiveDb['flip1']?.reason).toBe('duration');
		expect(archiveDb['flip1']?.url).toBe('https://youtube.com/watch?v=flip1');
	});
});
