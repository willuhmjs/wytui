import { describe, it, expect } from 'vitest';
import { buildSearchParam } from './youtube-search.service';

describe('buildSearchParam', () => {
	// These four were verified against live YouTube on 2026-07-24.
	it('encodes type-only filters with all other fields defaulted', () => {
		expect(buildSearchParam({ type: 'video' })).toBe('EgIQAQ==');
		expect(buildSearchParam({ type: 'channel' })).toBe('EgIQAg==');
		expect(buildSearchParam({ type: 'playlist' })).toBe('EgIQAw==');
	});

	it('encodes sort + uploadDate + duration together', () => {
		expect(
			buildSearchParam({ type: 'video', sort: 'date', uploadDate: 'week', duration: 'long' }),
		).toBe('CAESBggDEAEYAg==');
	});

	it('omits fields at their default value', () => {
		// relevance is sort=0 and is omitted entirely rather than encoded as 08 00
		expect(buildSearchParam({ type: 'video', sort: 'relevance' })).toBe('EgIQAQ==');
		expect(buildSearchParam({ type: 'video', uploadDate: 'any', duration: 'any' })).toBe(
			'EgIQAQ==',
		);
	});

	it('encodes each sort value', () => {
		expect(buildSearchParam({ type: 'video', sort: 'date' })).toBe('CAESAhAB');
		expect(buildSearchParam({ type: 'video', sort: 'views' })).toBe('CAISAhAB');
		expect(buildSearchParam({ type: 'video', sort: 'rating' })).toBe('CAMSAhAB');
	});

	it('uses YouTube duration ordinals, where long=2 and medium=3', () => {
		// short -> 18 01, long -> 18 02, medium -> 18 03
		expect(buildSearchParam({ type: 'video', duration: 'short' })).toBe('EgQQARgB');
		expect(buildSearchParam({ type: 'video', duration: 'long' })).toBe('EgQQARgC');
		expect(buildSearchParam({ type: 'video', duration: 'medium' })).toBe('EgQQARgD');
	});

	it('encodes each uploadDate value', () => {
		expect(buildSearchParam({ type: 'video', uploadDate: 'hour' })).toBe('EgQIARAB');
		expect(buildSearchParam({ type: 'video', uploadDate: 'today' })).toBe('EgQIAhAB');
		expect(buildSearchParam({ type: 'video', uploadDate: 'week' })).toBe('EgQIAxAB');
		expect(buildSearchParam({ type: 'video', uploadDate: 'month' })).toBe('EgQIBBAB');
		expect(buildSearchParam({ type: 'video', uploadDate: 'year' })).toBe('EgQIBRAB');
	});

	it('ignores uploadDate and duration for non-video types', () => {
		// These would return 0 results if the filters were sent.
		expect(buildSearchParam({ type: 'channel', duration: 'long' })).toBe('EgIQAg==');
		expect(buildSearchParam({ type: 'playlist', duration: 'long' })).toBe('EgIQAw==');
		expect(buildSearchParam({ type: 'channel', uploadDate: 'week' })).toBe('EgIQAg==');
		expect(buildSearchParam({ type: 'playlist', uploadDate: 'week' })).toBe('EgIQAw==');
	});
});

import { parseSearchEntries } from './youtube-search.service';

const videoJson = JSON.stringify({
	entries: [
		{
			_type: 'url',
			ie_key: 'Youtube',
			id: '7W3TwaIAlLo',
			url: 'https://www.youtube.com/watch?v=7W3TwaIAlLo',
			title: "TWO reasons your sourdough doesn't SPRING",
			description: 'Having issues with your sourdough starter?',
			duration: 1289,
			channel_id: 'UCzH5n3Ih5kgQoiDAQt2FwLw',
			channel: 'LifebyMikeG',
			channel_url: 'https://www.youtube.com/channel/UCzH5n3Ih5kgQoiDAQt2FwLw',
			uploader: 'LifebyMikeG',
			thumbnails: [
				{ url: 'https://i.ytimg.com/vi/7W3TwaIAlLo/small.jpg', height: 202, width: 360 },
				{ url: 'https://i.ytimg.com/vi/7W3TwaIAlLo/hq720.jpg', height: 404, width: 720 },
			],
			view_count: 2761758,
			channel_is_verified: true,
		},
		{ _type: 'url', ie_key: 'Youtube', id: 'dQw4w9WgXcQ', title: 'Bare minimum' },
		{ nope: true },
	],
});

const channelJson = JSON.stringify({
	entries: [
		{
			_type: 'url',
			ie_key: 'YoutubeTab',
			id: 'UCMeIfTykbcnPvbPyX7Kqr0Q',
			url: 'https://www.youtube.com/channel/UCMeIfTykbcnPvbPyX7Kqr0Q',
			title: 'Oh my Bread Sourdough Baking School ',
			channel: 'Oh my Bread Sourdough Baking School ',
			channel_follower_count: 17500,
			description: 'Hello there, Sourdough Enthusiasts!',
			channel_is_verified: null,
			thumbnails: [
				{
					url: '//yt3.googleusercontent.com/abc=s88-c-k-c0x00ffffff-no-rj-mo',
					height: 88,
					width: 88,
				},
				{
					url: '//yt3.googleusercontent.com/abc=s176-c-k-c0x00ffffff-no-rj-mo',
					height: 176,
					width: 176,
				},
			],
		},
	],
});

const playlistJson = JSON.stringify({
	entries: [
		{
			_type: 'url',
			ie_key: 'YoutubeTab',
			id: 'PLt_lOWx8jR_PQQqNquacTdaUuGWCD-V1S',
			url: 'https://www.youtube.com/playlist?list=PLt_lOWx8jR_PQQqNquacTdaUuGWCD-V1S',
			title: 'Your Beginners Guide to Making Sourdough Bread',
			channel: 'LifebyMikeG',
			channel_id: 'UCzH5n3Ih5kgQoiDAQt2FwLw',
			uploader: 'LifebyMikeG',
			duration: null,
			view_count: null,
			thumbnails: [
				{ url: 'https://i.ytimg.com/vi/BJEHsvW2J6M/hq720.jpg', height: 404, width: 720 },
			],
		},
	],
});

describe('parseSearchEntries', () => {
	it('maps video entries and picks the largest thumbnail', () => {
		const { results, rawCount } = parseSearchEntries(videoJson, 'video');
		expect(rawCount).toBe(3);
		expect(results).toHaveLength(2);
		expect(results[0]).toEqual({
			type: 'video',
			id: '7W3TwaIAlLo',
			title: "TWO reasons your sourdough doesn't SPRING",
			url: 'https://www.youtube.com/watch?v=7W3TwaIAlLo',
			uploader: 'LifebyMikeG',
			channelId: 'UCzH5n3Ih5kgQoiDAQt2FwLw',
			channelUrl: 'https://www.youtube.com/channel/UCzH5n3Ih5kgQoiDAQt2FwLw',
			thumbnail: 'https://i.ytimg.com/vi/7W3TwaIAlLo/hq720.jpg',
			duration: 1289,
			viewCount: 2761758,
			verified: true,
			description: 'Having issues with your sourdough starter?',
			existingDownload: null,
		});
	});

	it('tolerates missing fields and synthesizes a watch URL from the id', () => {
		const { results } = parseSearchEntries(videoJson, 'video');
		expect(results[1]).toMatchObject({
			type: 'video',
			id: 'dQw4w9WgXcQ',
			title: 'Bare minimum',
			url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			verified: false,
			existingDownload: null,
		});
		expect(results[1]).not.toHaveProperty('duration', expect.anything());
	});

	it('maps channel entries and fixes protocol-relative thumbnails', () => {
		const { results } = parseSearchEntries(channelJson, 'channel');
		expect(results[0]).toEqual({
			type: 'channel',
			id: 'UCMeIfTykbcnPvbPyX7Kqr0Q',
			title: 'Oh my Bread Sourdough Baking School ',
			url: 'https://www.youtube.com/channel/UCMeIfTykbcnPvbPyX7Kqr0Q',
			thumbnail: 'https://yt3.googleusercontent.com/abc=s176-c-k-c0x00ffffff-no-rj-mo',
			subscriberCount: 17500,
			description: 'Hello there, Sourdough Enthusiasts!',
		});
	});

	it('maps playlist entries without inventing a video count', () => {
		const { results } = parseSearchEntries(playlistJson, 'playlist');
		expect(results[0]).toEqual({
			type: 'playlist',
			id: 'PLt_lOWx8jR_PQQqNquacTdaUuGWCD-V1S',
			title: 'Your Beginners Guide to Making Sourdough Bread',
			url: 'https://www.youtube.com/playlist?list=PLt_lOWx8jR_PQQqNquacTdaUuGWCD-V1S',
			thumbnail: 'https://i.ytimg.com/vi/BJEHsvW2J6M/hq720.jpg',
			uploader: 'LifebyMikeG',
			channelId: 'UCzH5n3Ih5kgQoiDAQt2FwLw',
		});
		expect(results[0]).not.toHaveProperty('videoCount');
	});

	it('skips entries whose shape does not match the requested type', () => {
		// asking for channels but getting video entries yields nothing
		const { results, rawCount } = parseSearchEntries(videoJson, 'channel');
		expect(results).toHaveLength(0);
		expect(rawCount).toBe(3);
	});

	it('returns empty on malformed JSON', () => {
		expect(parseSearchEntries('not json', 'video')).toEqual({ results: [], rawCount: 0 });
	});

	it('returns empty when entries is absent', () => {
		expect(parseSearchEntries('{}', 'video')).toEqual({ results: [], rawCount: 0 });
	});
});

import { vi, beforeEach, afterEach } from 'vitest';
import { youtubeSearchService } from './youtube-search.service';

// vi.mock is hoisted above every import, so the service module below is loaded
// with this mock already in place. The factory returns a closure over
// runYtdlpJsonMock rather than the fn itself — the closure body is not
// evaluated at hoist time, which is what keeps this out of the TDZ.
const runYtdlpJsonMock = vi.fn();
vi.mock('../utils/ytdlp-json', () => ({
	runYtdlpJson: (...a: any[]) => runYtdlpJsonMock(...a),
}));

const oneVideo = JSON.stringify({
	entries: [{ _type: 'url', ie_key: 'Youtube', id: 'abc', title: 'A' }],
});

function nVideos(n: number) {
	return JSON.stringify({
		entries: Array.from({ length: n }, (_, i) => ({
			_type: 'url',
			ie_key: 'Youtube',
			id: `v${i}`,
			title: `V${i}`,
		})),
	});
}

const base = {
	query: 'sourdough',
	type: 'video' as const,
	sort: 'relevance' as const,
	uploadDate: 'any' as const,
	duration: 'any' as const,
	offset: 0,
	limit: 20,
};

describe('youtubeSearchService.search', () => {
	beforeEach(() => {
		runYtdlpJsonMock.mockReset();
		youtubeSearchService.clearCache();
		vi.useRealTimers();
	});
	afterEach(() => vi.useRealTimers());

	it('builds the results URL with an encoded query and sp param', async () => {
		runYtdlpJsonMock.mockResolvedValue(oneVideo);
		await youtubeSearchService.search({ ...base, query: 'sourdough bread' });

		const [target] = runYtdlpJsonMock.mock.calls[0];
		expect(target).toBe(
			'https://www.youtube.com/results?search_query=sourdough%20bread&sp=EgIQAQ%3D%3D',
		);
	});

	it('never passes cookies', async () => {
		runYtdlpJsonMock.mockResolvedValue(oneVideo);
		await youtubeSearchService.search(base);
		const [, opts] = runYtdlpJsonMock.mock.calls[0];
		expect(opts.cookiePath).toBeUndefined();
	});

	it('maps offset and limit onto 1-based inclusive playlist indices', async () => {
		runYtdlpJsonMock.mockResolvedValue(oneVideo);
		await youtubeSearchService.search(base);
		expect(runYtdlpJsonMock.mock.calls[0][1].extraArgs).toEqual([
			'--playlist-start',
			'1',
			'--playlist-end',
			'20',
		]);

		youtubeSearchService.clearCache();
		await youtubeSearchService.search({ ...base, offset: 20 });
		expect(runYtdlpJsonMock.mock.calls[1][1].extraArgs).toEqual([
			'--playlist-start',
			'21',
			'--playlist-end',
			'40',
		]);
	});

	it('uses a 45s timeout', async () => {
		runYtdlpJsonMock.mockResolvedValue(oneVideo);
		await youtubeSearchService.search(base);
		expect(runYtdlpJsonMock.mock.calls[0][1].timeoutMs).toBe(45000);
	});

	it('derives hasMore from the raw entry count, not the parsed length', async () => {
		// 20 raw entries, but 2 are channels so only 18 parse as videos
		const mixed = JSON.parse(nVideos(20));
		mixed.entries[0] = { _type: 'url', ie_key: 'YoutubeTab', id: 'UC1', url: '/channel/UC1' };
		mixed.entries[1] = { _type: 'url', ie_key: 'YoutubeTab', id: 'UC2', url: '/channel/UC2' };
		runYtdlpJsonMock.mockResolvedValue(JSON.stringify(mixed));

		const out = await youtubeSearchService.search(base);
		expect(out.results).toHaveLength(18);
		expect(out.hasMore).toBe(true);
	});

	it('reports hasMore false on a short page', async () => {
		runYtdlpJsonMock.mockResolvedValue(nVideos(5));
		const out = await youtubeSearchService.search(base);
		expect(out.hasMore).toBe(false);
	});

	it('serves a repeat query from cache without re-spawning yt-dlp', async () => {
		runYtdlpJsonMock.mockResolvedValue(oneVideo);
		await youtubeSearchService.search(base);
		await youtubeSearchService.search(base);
		expect(runYtdlpJsonMock).toHaveBeenCalledTimes(1);
	});

	it('hands out a clone so mutating a result cannot poison the cache', async () => {
		runYtdlpJsonMock.mockResolvedValue(oneVideo);
		const first = await youtubeSearchService.search(base);
		// Simulate the route handler attaching per-user download state.
		(first.results[0] as any).existingDownload = { id: 'leak', status: 'DOWNLOADING' };

		const second = await youtubeSearchService.search(base);
		expect(runYtdlpJsonMock).toHaveBeenCalledTimes(1); // served from cache
		expect((second.results[0] as any).existingDownload).toBeNull();
	});

	it('treats differing filters as distinct cache keys', async () => {
		runYtdlpJsonMock.mockResolvedValue(oneVideo);
		await youtubeSearchService.search(base);
		await youtubeSearchService.search({ ...base, duration: 'long' });
		await youtubeSearchService.search({ ...base, offset: 20 });
		await youtubeSearchService.search({ ...base, type: 'channel' });
		expect(runYtdlpJsonMock).toHaveBeenCalledTimes(4);
	});

	it('re-fetches once the TTL has elapsed', async () => {
		vi.useFakeTimers();
		runYtdlpJsonMock.mockResolvedValue(oneVideo);
		await youtubeSearchService.search(base);
		vi.advanceTimersByTime(15 * 60 * 1000 + 1);
		await youtubeSearchService.search(base);
		expect(runYtdlpJsonMock).toHaveBeenCalledTimes(2);
	});

	it('evicts the oldest entry once the cap is reached', async () => {
		runYtdlpJsonMock.mockResolvedValue(oneVideo);
		// Fill the cache past its 200-entry cap.
		for (let i = 0; i < 201; i++) {
			await youtubeSearchService.search({ ...base, query: `q${i}` });
		}
		expect(runYtdlpJsonMock).toHaveBeenCalledTimes(201);

		// q0 was evicted, so it re-fetches; q200 is still cached.
		await youtubeSearchService.search({ ...base, query: 'q0' });
		expect(runYtdlpJsonMock).toHaveBeenCalledTimes(202);
		await youtubeSearchService.search({ ...base, query: 'q200' });
		expect(runYtdlpJsonMock).toHaveBeenCalledTimes(202);
	});

	it('propagates yt-dlp failures to the caller', async () => {
		runYtdlpJsonMock.mockRejectedValue(new Error('ERROR: Sign in to confirm'));
		await expect(youtubeSearchService.search(base)).rejects.toThrow('Sign in to confirm');
	});

	it('does not cache a failed search', async () => {
		runYtdlpJsonMock.mockRejectedValueOnce(new Error('boom'));
		await expect(youtubeSearchService.search(base)).rejects.toThrow('boom');
		runYtdlpJsonMock.mockResolvedValue(oneVideo);
		const out = await youtubeSearchService.search(base);
		expect(out.results).toHaveLength(1);
		expect(runYtdlpJsonMock).toHaveBeenCalledTimes(2);
	});
});

import { parseSearchParams } from './youtube-search.service';

describe('parseSearchParams', () => {
	const p = (s: string) => new URLSearchParams(s);

	it('applies defaults when only q is given', () => {
		expect(parseSearchParams(p('q=sourdough'))).toEqual({
			query: 'sourdough',
			type: 'video',
			sort: 'relevance',
			uploadDate: 'any',
			duration: 'any',
			offset: 0,
			limit: 20,
		});
	});

	it('trims the query', () => {
		expect(parseSearchParams(p('q=%20%20hi%20%20')).query).toBe('hi');
	});

	it('rejects a missing or blank query', () => {
		expect(() => parseSearchParams(p(''))).toThrow('Query is required');
		expect(() => parseSearchParams(p('q=%20%20'))).toThrow('Query is required');
	});

	it('rejects a query over 200 characters', () => {
		expect(() => parseSearchParams(p(`q=${'a'.repeat(201)}`))).toThrow('Query is too long');
	});

	it('accepts a query of exactly 200 characters', () => {
		expect(parseSearchParams(p(`q=${'a'.repeat(200)}`)).query).toHaveLength(200);
	});

	it('rejects out-of-enum values rather than passing them to the encoder', () => {
		expect(() => parseSearchParams(p('q=x&type=movie'))).toThrow('Invalid type');
		expect(() => parseSearchParams(p('q=x&sort=oldest'))).toThrow('Invalid sort');
		expect(() => parseSearchParams(p('q=x&uploadDate=decade'))).toThrow('Invalid uploadDate');
		expect(() => parseSearchParams(p('q=x&duration=epic'))).toThrow('Invalid duration');
	});

	it('accepts every valid enum value', () => {
		expect(parseSearchParams(p('q=x&type=channel')).type).toBe('channel');
		expect(parseSearchParams(p('q=x&sort=views')).sort).toBe('views');
		expect(parseSearchParams(p('q=x&uploadDate=month')).uploadDate).toBe('month');
		expect(parseSearchParams(p('q=x&duration=medium')).duration).toBe('medium');
	});

	it('clamps limit to 50 and floors it at 1', () => {
		expect(parseSearchParams(p('q=x&limit=999')).limit).toBe(50);
		expect(parseSearchParams(p('q=x&limit=0')).limit).toBe(1);
		expect(parseSearchParams(p('q=x&limit=-5')).limit).toBe(1);
	});

	it('floors offset at 0 and ignores non-numeric input', () => {
		expect(parseSearchParams(p('q=x&offset=-10')).offset).toBe(0);
		expect(parseSearchParams(p('q=x&offset=abc')).offset).toBe(0);
		expect(parseSearchParams(p('q=x&limit=abc')).limit).toBe(20);
	});
});
