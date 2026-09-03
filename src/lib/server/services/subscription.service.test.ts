import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// In-memory stores backing the prisma mock.
const archiveDb: Record<string, any> = {};
const downloadsDb: any[] = [];
const subsDb: Record<string, any> = {};

vi.mock('../db', () => ({
	prisma: {
		subscription: {
			findUnique: vi.fn(async ({ where }: any) => subsDb[where.id] ?? null),
			update: vi.fn(async ({ where, data }: any) => {
				subsDb[where.id] = { ...subsDb[where.id], ...data };
				return subsDb[where.id];
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
	},
}));

vi.mock('../sse/emitter', () => ({
	sseEmitter: {
		broadcast: vi.fn(),
		broadcastToUser: vi.fn(),
		setInitialStateCallback: vi.fn(),
	},
}));

import { subscriptionService } from './subscription.service';
import { RateLimitError } from '../utils/ytdlp-json';

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
		(subscriptionService as any).rateLimitCooldownUntil = 0;
		vi.restoreAllMocks();
	});

	it('records the failure, cools down, and lets forced checks bypass', async () => {
		const getLatest = vi
			.spyOn(subscriptionService as any, 'getLatestVideos')
			.mockRejectedValueOnce(new RateLimitError('sign in to confirm'));

		await subscriptionService.checkSubscription(SUB_ID);

		expect(getLatest).toHaveBeenCalledTimes(1);
		expect(subsDb[SUB_ID].lastError).toContain('rate limit');
		expect((subscriptionService as any).rateLimitCooldownUntil).toBeGreaterThan(Date.now());

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
