import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// In-memory stores backing the prisma mock.
const archiveDb: Record<string, any> = {};
const downloadsDb: any[] = [];
const subsDb: Record<string, any> = {};
const jobQueueDb: any[] = [];
let settingsDb: Record<string, any> | null = null;

vi.mock('../db', () => ({
	prisma: {
		subscription: {
			findUnique: vi.fn(async ({ where }: any) => subsDb[where.id] ?? null),
			findMany: vi.fn(async () => []),
			update: vi.fn(async ({ where, data }: any) => {
				subsDb[where.id] = { ...subsDb[where.id], ...data };
				return subsDb[where.id];
			}),
		},
		jobQueue: {
			findMany: vi.fn(async ({ where }: any) =>
				jobQueueDb.filter(
					(j) =>
						(where.type === undefined || j.type === where.type) &&
						(where.status === undefined || j.status === where.status),
				),
			),
			delete: vi.fn(async ({ where }: any) => {
				const i = jobQueueDb.findIndex((j) => j.id === where.id);
				if (i !== -1) jobQueueDb.splice(i, 1);
			}),
		},
		archive: {
			findUnique: vi.fn(async ({ where }: any) => archiveDb[where.videoId] ?? null),
			delete: vi.fn(async ({ where }: any) => {
				delete archiveDb[where.videoId];
			}),
			upsert: vi.fn(async ({ where }: any) => archiveDb[where.videoId]),
		},
		download: {
			findFirst: vi.fn(
				async ({ where }: any) =>
					downloadsDb.find((d) => d.url === where.url && d.status === where.status) ?? null,
			),
			delete: vi.fn(async ({ where }: any) => {
				const i = downloadsDb.findIndex((d) => d.id === where.id);
				if (i !== -1) downloadsDb.splice(i, 1);
			}),
		},
		youTubeLink: {
			findUnique: vi.fn(async () => null),
		},
		settings: {
			findUnique: vi.fn(async () => settingsDb),
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

// Channel-identity backfill goes through one flat yt-dlp browse call; stub the
// process spawn while keeping RateLimitError (used by the cooldown tests).
vi.mock('../utils/ytdlp-json', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../utils/ytdlp-json')>();
	return { ...actual, runYtdlpJson: vi.fn() };
});

import { subscriptionService } from './subscription.service';
import { queueService } from './queue.service';
import { RateLimitError, runYtdlpJson } from '../utils/ytdlp-json';
import { isRateLimitCooldownActive, resetRateLimitCooldown } from '../utils/rate-limit-cooldown';

const SUB_ID = 'sub-check-1';

describe('fetchChannelFeed', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('parses video entries with dates, shorts URLs, and XML entities', async () => {
		const feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
 <entry>
  <yt:videoId>abc123</yt:videoId>
  <title>My &amp; Cool Video</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=abc123"/>
  <published>2026-08-30T12:00:00+00:00</published>
 </entry>
 <entry>
  <yt:videoId>short1</yt:videoId>
  <title>A Short</title>
  <link rel="alternate" href="https://www.youtube.com/shorts/short1"/>
  <published>2026-08-31T12:00:00+00:00</published>
 </entry>
</feed>`;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(feed, { status: 200 })),
		);

		const videos = await (subscriptionService as any).fetchChannelFeed('UCtest');
		expect(videos).toHaveLength(2);
		expect(videos[0].id).toBe('abc123');
		expect(videos[0].title).toBe('My & Cool Video');
		expect(videos[0].uploadedAt?.toISOString()).toContain('2026-08-30');
		expect(videos[1].url).toContain('/shorts/');
	});

	it('throws on a non-200 response so the caller can fall back', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('nope', { status: 404 })),
		);
		await expect((subscriptionService as any).fetchChannelFeed('UCtest')).rejects.toThrow(
			'HTTP 404',
		);
	});

	it('classifies HTTP 429 as a rate limit so the cooldown arms and no fallback traffic fires', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('slow down', { status: 429 })),
		);
		await expect((subscriptionService as any).fetchChannelFeed('UCtest')).rejects.toMatchObject({
			isRateLimit: true,
		});
	});
});

describe('filterNewVideos', () => {
	beforeEach(() => {
		for (const k of Object.keys(archiveDb)) delete archiveDb[k];
		downloadsDb.length = 0;
	});

	it('never re-queues an archive entry with a skip reason (excluded short)', async () => {
		archiveDb['vid1'] = { videoId: 'vid1', reason: 'short' };
		const out = await (subscriptionService as any).filterNewVideos(
			[{ id: 'vid1', url: 'https://youtube.com/watch?v=vid1', uploadedAt: new Date() }],
			{ createdAt: new Date('2020-01-01') },
		);
		expect(out).toHaveLength(0);
		expect(archiveDb['vid1']).toBeDefined();
	});

	it('keeps skipping undated seeded entries by default (flat-playlist fallback)', async () => {
		archiveDb['vid2'] = { videoId: 'vid2' };
		const out = await (subscriptionService as any).filterNewVideos(
			[{ id: 'vid2', url: 'https://youtube.com/watch?v=vid2', uploadedAt: null }],
			{ createdAt: new Date('2020-01-01') },
		);
		expect(out).toHaveLength(0);
		expect(archiveDb['vid2']).toBeDefined();
	});

	it('heals undated seeded entries when the source is trusted (linked feed)', async () => {
		archiveDb['vid3'] = { videoId: 'vid3' };
		const out = await (subscriptionService as any).filterNewVideos(
			[{ id: 'vid3', url: 'https://youtube.com/watch?v=vid3', uploadedAt: null }],
			{ createdAt: new Date('2020-01-01') },
			{ trustUndatedEntries: true },
		);
		expect(out).toHaveLength(1);
		expect(archiveDb['vid3']).toBeUndefined();
	});

	it('heals a dated seeded entry only when published after the subscription was created', async () => {
		archiveDb['vid4'] = { videoId: 'vid4' };
		archiveDb['vid5'] = { videoId: 'vid5' };
		const out = await (subscriptionService as any).filterNewVideos(
			[
				{ id: 'vid4', url: 'https://youtube.com/watch?v=vid4', uploadedAt: new Date('2026-06-01') },
				{ id: 'vid5', url: 'https://youtube.com/watch?v=vid5', uploadedAt: new Date('2019-01-01') },
			],
			{ createdAt: new Date('2026-01-01') },
		);
		expect(out.map((v: any) => v.id)).toEqual(['vid4']);
		expect(archiveDb['vid4']).toBeUndefined();
		expect(archiveDb['vid5']).toBeDefined();
	});
});

describe('checkSubscription rate-limit cooldown', () => {
	beforeEach(() => {
		for (const k of Object.keys(subsDb)) delete subsDb[k];
		subsDb[SUB_ID] = {
			id: SUB_ID,
			name: 'Test',
			enabled: true,
			type: 'CHANNEL',
			url: 'https://youtube.com/channel/UCtest',
			profileId: 'p1',
			userId: null,
			autoDownload: true,
			excludeShorts: false,
			customFlags: [],
			createdAt: new Date('2020-01-01'),
		};
		resetRateLimitCooldown();
		vi.restoreAllMocks();
	});

	it('records the failure, cools down, and lets forced checks bypass', async () => {
		const getLatest = vi
			.spyOn(subscriptionService as any, 'getLatestVideos')
			.mockRejectedValueOnce(new RateLimitError('sign in to confirm'));

		await subscriptionService.checkSubscription(SUB_ID);

		expect(getLatest).toHaveBeenCalledTimes(1);
		expect(subsDb[SUB_ID].lastError).toContain('rate limit');
		expect(isRateLimitCooldownActive()).toBe(true);

		// Non-forced check during cooldown: skipped without touching yt-dlp.
		await subscriptionService.checkSubscription(SUB_ID);
		expect(getLatest).toHaveBeenCalledTimes(1);

		// Forced (manual "Check now") bypasses the cooldown.
		getLatest.mockResolvedValueOnce([]);
		await subscriptionService.checkSubscription(SUB_ID, { force: true });
		expect(getLatest).toHaveBeenCalledTimes(2);
		// A successful check clears the error.
		expect(subsDb[SUB_ID].lastError).toBeNull();
	});
});

describe('subscription job handler', () => {
	beforeEach(() => {
		for (const k of Object.keys(subsDb)) delete subsDb[k];
		vi.restoreAllMocks();
	});

	it('reschedules the next check even when the check fails', async () => {
		// Capture the handler startScheduler registers (the real queue service
		// is in play here; registerHandler just stores it in a map).
		const registerSpy = vi.spyOn(queueService, 'registerHandler');
		await subscriptionService.startScheduler();
		const handler = registerSpy.mock.calls.find((c: any[]) => c[0] === 'subscription')?.[1] as any;
		registerSpy.mockRestore();
		expect(handler).toBeTypeOf('function');

		subsDb[SUB_ID] = { id: SUB_ID, name: 'Test', enabled: true };
		const checkSpy = vi
			.spyOn(subscriptionService, 'checkSubscription')
			.mockRejectedValue(new Error('boom'));
		const scheduleSpy = vi
			.spyOn(subscriptionService, 'scheduleSubscription')
			.mockResolvedValue(undefined);

		// The failure propagates (so the queue row records the error) …
		await expect(handler({ payload: { subscriptionId: SUB_ID } })).rejects.toThrow('boom');
		// … but the channel's check chain must survive it.
		expect(scheduleSpy).toHaveBeenCalledTimes(1);
		expect(scheduleSpy.mock.calls[0][0]).toMatchObject({ id: SUB_ID, enabled: true });

		checkSpy.mockRestore();
		scheduleSpy.mockRestore();
	});

	it('does not reschedule a disabled subscription', async () => {
		const registerSpy = vi.spyOn(queueService, 'registerHandler');
		await subscriptionService.startScheduler();
		const handler = registerSpy.mock.calls.find((c: any[]) => c[0] === 'subscription')?.[1] as any;
		registerSpy.mockRestore();

		subsDb[SUB_ID] = { id: SUB_ID, name: 'Test', enabled: false };
		const checkSpy = vi
			.spyOn(subscriptionService, 'checkSubscription')
			.mockResolvedValue(undefined);
		const scheduleSpy = vi
			.spyOn(subscriptionService, 'scheduleSubscription')
			.mockResolvedValue(undefined);

		await handler({ payload: { subscriptionId: SUB_ID } });
		expect(scheduleSpy).not.toHaveBeenCalled();

		checkSpy.mockRestore();
		scheduleSpy.mockRestore();
	});
});

describe('unscheduleSubscription', () => {
	beforeEach(() => {
		jobQueueDb.length = 0;
	});

	it('removes only PENDING rows and leaves the in-flight RUNNING row alone', async () => {
		const future = new Date(Date.now() + 60 * 60 * 1000);
		jobQueueDb.push(
			// The next scheduled run — this is what a reschedule replaces.
			{
				id: 'pending-1',
				type: 'subscription',
				status: 'PENDING',
				runAt: future,
				payload: { subscriptionId: 'sub-1' },
			},
			// The row for the check that is currently executing (scheduleSubscription
			// runs from inside its own job handler). Deleting it made the queue
			// worker's completion update fail and crashed the process.
			{
				id: 'running-1',
				type: 'subscription',
				status: 'RUNNING',
				startedAt: new Date(),
				payload: { subscriptionId: 'sub-1' },
			},
			// Terminal history — pruned by the weekly job-history prune instead.
			{
				id: 'done-1',
				type: 'subscription',
				status: 'COMPLETED',
				completedAt: new Date(),
				payload: { subscriptionId: 'sub-1' },
			},
			// Another subscription's row must not be touched.
			{
				id: 'other-1',
				type: 'subscription',
				status: 'PENDING',
				runAt: future,
				payload: { subscriptionId: 'sub-2' },
			},
		);

		await subscriptionService.unscheduleSubscription('sub-1');

		const ids = jobQueueDb.map((j) => j.id);
		expect(ids).not.toContain('pending-1');
		expect(ids).toContain('running-1');
		expect(ids).toContain('done-1');
		expect(ids).toContain('other-1');
	});
});

describe('mapPlaylistEntries', () => {
	const map = (info: any, dateAfter?: string) =>
		(subscriptionService as any).constructor.mapPlaylistEntries(info, dateAfter);

	it('maps flat playlist entries to id/title/url', () => {
		const videos = map({
			entries: [
				{ id: 'a', title: 'Video A', url: 'https://www.youtube.com/watch?v=a' },
				{ id: 'b', title: 'Video B', webpage_url: 'https://www.youtube.com/watch?v=b' },
			],
		});
		expect(videos).toHaveLength(2);
		expect(videos[0]).toMatchObject({
			id: 'a',
			title: 'Video A',
			url: 'https://www.youtube.com/watch?v=a',
		});
		expect(videos[1].url).toBe('https://www.youtube.com/watch?v=b');
	});

	it('skips entries without an id and fills missing title/url safely', () => {
		const videos = map({
			entries: [{ title: 'no id' }, { id: 'c' }],
		});
		expect(videos).toHaveLength(1);
		expect(videos[0]).toMatchObject({
			id: 'c',
			title: 'c',
			url: 'https://www.youtube.com/watch?v=c',
		});
	});

	it('parses upload dates and re-applies the dateAfter cutoff client-side', () => {
		const videos = map(
			{
				entries: [
					{ id: 'new', title: 'New', webpage_url: 'u1', upload_date: '20260601' },
					{ id: 'old', title: 'Old', webpage_url: 'u2', upload_date: '20250101' },
					{ id: 'undated', title: 'Undated', webpage_url: 'u3' },
				],
			},
			'20260101',
		);
		expect(videos.map((v: any) => v.id)).toEqual(['new']);
		expect(videos[0].uploadedAt?.toISOString()).toContain('2026-06-01');
	});

	it('never maps channel tab URLs as videos (channel-root browses list tabs)', () => {
		const videos = map({
			entries: [
				{ id: 'UCt', title: 'Videos', url: 'https://www.youtube.com/channel/UCt/videos' },
				{ id: 'UCt', title: 'Shorts', url: 'https://www.youtube.com/channel/UCt/shorts' },
				{ id: 'UCt', title: 'Live', url: 'https://www.youtube.com/@handle/streams?si=abc' },
				{ id: 'vid1', title: 'Real Video', url: 'https://www.youtube.com/watch?v=vid1' },
				{ id: 'short1', title: 'A Short', url: 'https://www.youtube.com/shorts/short1' },
				{ id: 'pl1', title: 'A Playlist', url: 'https://www.youtube.com/playlist?list=PL123' },
			],
		});
		// Tabs are dropped; real videos (watch URLs, shorts with ids, playlists)
		// pass through.
		expect(videos.map((v: any) => v.id)).toEqual(['vid1', 'short1', 'pl1']);
	});
});

describe('filterNewVideos failure cooldown', () => {
	const DAY = 24 * 60 * 60 * 1000;

	beforeEach(() => {
		Object.keys(archiveDb).forEach((k) => delete archiveDb[k]);
		downloadsDb.length = 0;
	});

	const sub = { id: 'sub-1', createdAt: new Date('2026-01-01') };
	const video = (id: string) => ({
		id,
		url: `https://www.youtube.com/watch?v=${id}`,
		uploadedAt: new Date(Date.now() - 30 * DAY),
	});

	it('skips a video archived as failed while the cooldown is active', async () => {
		archiveDb['vid1'] = {
			videoId: 'vid1',
			reason: 'failed',
			failedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
		};

		const result = await (subscriptionService as any).filterNewVideos([video('vid1')], sub);

		expect(result).toHaveLength(0);
		expect(archiveDb['vid1']).toBeTruthy();
	});

	it('re-queues a failed video once the cooldown lapses and drops the entry', async () => {
		archiveDb['vid1'] = {
			videoId: 'vid1',
			reason: 'failed',
			failedAt: new Date(Date.now() - 2 * DAY),
		};

		const result = await (subscriptionService as any).filterNewVideos([video('vid1')], sub);

		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('vid1');
		expect(archiveDb['vid1']).toBeUndefined();
	});

	it('still never re-queues deliberate skips like excluded shorts', async () => {
		archiveDb['vid1'] = { videoId: 'vid1', reason: 'short', failedAt: null };

		const result = await (subscriptionService as any).filterNewVideos([video('vid1')], sub);

		expect(result).toHaveLength(0);
	});

	it('queues videos with no archive entry', async () => {
		const result = await (subscriptionService as any).filterNewVideos([video('vid1')], sub);

		expect(result).toHaveLength(1);
	});
});

describe('pickChannelAvatarUrl', () => {
	const pick = (thumbnails: any) =>
		(subscriptionService as any).constructor.pickChannelAvatarUrl(thumbnails);

	it('returns null when only banner crops are available', () => {
		expect(pick([{ url: 'banner', width: 1920, height: 1080 }])).toBeNull();
		expect(pick([])).toBeNull();
		expect(pick(undefined)).toBeNull();
	});

	it('picks the square avatar over the banner crops listed first', () => {
		expect(
			pick([
				{ url: 'banner', width: 1920, height: 1080 },
				{ url: 'avatar.jpg', width: 900, height: 900 },
			]),
		).toBe('avatar.jpg');
	});

	it('prefers the largest near-square entry', () => {
		expect(
			pick([
				{ url: 'small.jpg', width: 88, height: 88 },
				{ url: 'large.jpg', width: 900, height: 900 },
			]),
		).toBe('large.jpg');
	});

	it('ignores entries without usable dimensions', () => {
		expect(pick([{ url: 'no-dims' }, { url: 'half', width: 900 }])).toBeNull();
	});
});

describe('refreshChannelMeta', () => {
	const RAW_URL = 'https://www.youtube.com/@testchannel';

	beforeEach(() => {
		for (const k of Object.keys(subsDb)) delete subsDb[k];
		vi.mocked(runYtdlpJson).mockReset();
	});

	it('backfills id, name, and avatar while the subscription still shows its raw URL', async () => {
		subsDb[SUB_ID] = {
			id: SUB_ID,
			url: RAW_URL,
			name: RAW_URL,
			thumbnail: null,
			channelId: null,
			userId: null,
		};
		vi.mocked(runYtdlpJson).mockResolvedValue(
			JSON.stringify({
				channel_id: 'UCresolved',
				playlist_count: 42,
				channel: 'Test Channel',
				thumbnails: [
					{ url: 'banner', width: 1920, height: 1080 },
					{ url: 'avatar.jpg', width: 900, height: 900 },
				],
			}),
		);

		await subscriptionService.refreshChannelMeta(SUB_ID);

		expect(subsDb[SUB_ID]).toMatchObject({
			channelId: 'UCresolved',
			videoCount: 42,
			name: 'Test Channel',
			thumbnail: 'avatar.jpg',
		});
	});

	it('never overwrites a user rename, resolved id, or existing avatar', async () => {
		subsDb[SUB_ID] = {
			id: SUB_ID,
			url: RAW_URL,
			name: 'My Custom Name',
			thumbnail: 'existing.jpg',
			channelId: 'UCoriginal',
			userId: null,
		};
		vi.mocked(runYtdlpJson).mockResolvedValue(
			JSON.stringify({
				channel_id: 'UCdifferent',
				playlist_count: 43,
				channel: 'Test Channel',
				thumbnails: [{ url: 'new.jpg', width: 900, height: 900 }],
			}),
		);

		await subscriptionService.refreshChannelMeta(SUB_ID);

		expect(subsDb[SUB_ID].name).toBe('My Custom Name');
		expect(subsDb[SUB_ID].thumbnail).toBe('existing.jpg');
		expect(subsDb[SUB_ID].channelId).toBe('UCoriginal');
		// The video count is live data — it always refreshes.
		expect(subsDb[SUB_ID].videoCount).toBe(43);
	});

	it('leaves the subscription untouched when the channel browse fails', async () => {
		subsDb[SUB_ID] = {
			id: SUB_ID,
			url: RAW_URL,
			name: RAW_URL,
			thumbnail: null,
			channelId: null,
			userId: null,
		};
		vi.mocked(runYtdlpJson).mockRejectedValue(new Error('yt-dlp failed'));

		await subscriptionService.refreshChannelMeta(SUB_ID);

		expect(subsDb[SUB_ID].name).toBe(RAW_URL);
		expect(subsDb[SUB_ID].thumbnail).toBeNull();
	});
});
