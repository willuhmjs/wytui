import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseFlatEntries } from './youtube.service';

const { runYtdlpJsonMock } = vi.hoisted(() => ({ runYtdlpJsonMock: vi.fn() }));

vi.mock('../utils/ytdlp-json', () => {
	class RateLimitError extends Error {
		readonly isRateLimit = true;
	}
	class YtdlpAuthError extends Error {
		readonly isAuthError = true;
	}
	class YtdlpTimeoutError extends Error {
		readonly isTimeout = true;
	}
	return { runYtdlpJson: runYtdlpJsonMock, RateLimitError, YtdlpAuthError, YtdlpTimeoutError };
});

vi.mock('../db', () => ({
	prisma: {
		settings: { findUnique: vi.fn(async () => ({ ytdlpProxyUrl: null })) },
		youTubeLink: { findUnique: vi.fn(async () => ({ proxyUrl: null, extraFlags: [] })) },
	},
}));

vi.mock('./youtube-link.service', () => ({
	youtubeLinkService: { getCookiesTxt: vi.fn(async () => '# Netscape HTTP Cookie File\n') },
}));

const flat = JSON.stringify({
	entries: [
		{
			id: 'vid1',
			title: 'First',
			url: 'https://youtu.be/vid1',
			uploader: 'Chan A',
			channel_id: 'UC1',
		},
		{ id: 'vid2', title: 'Second', channel_id: 'UC2' },
		{ nope: true }, // malformed entry, should be skipped
	],
});

describe('parseFlatEntries', () => {
	it('maps yt-dlp flat entries and skips malformed ones', () => {
		const out = parseFlatEntries(flat);
		expect(out).toHaveLength(2);
		expect(out[0]).toMatchObject({
			id: 'vid1',
			title: 'First',
			uploader: 'Chan A',
			channelId: 'UC1',
		});
		expect(out[1].url).toContain('vid2'); // url synthesized from id when absent
	});
	it('returns [] on non-JSON', () => {
		expect(parseFlatEntries('not json')).toEqual([]);
	});
});

describe('fetchList error classification', () => {
	beforeEach(() => {
		runYtdlpJsonMock.mockReset();
	});

	it('parses entries on success', async () => {
		runYtdlpJsonMock.mockResolvedValue(flat);
		const { youtubeService } = await import('./youtube.service');
		const result = await youtubeService.fetchHistory('u1');
		expect(result).toHaveLength(2);
		expect((result as any[])[0].id).toBe('vid1');
	});

	it('propagates rate-limit errors instead of claiming a dead session', async () => {
		const { RateLimitError } = await import('../utils/ytdlp-json');
		runYtdlpJsonMock.mockRejectedValue(new RateLimitError('YouTube rate limit reached'));
		const { youtubeService } = await import('./youtube.service');
		await expect(youtubeService.fetchHistory('u1')).rejects.toThrow('rate limit');
	});

	it('maps dead-session errors to needsRelink', async () => {
		const { YtdlpAuthError } = await import('../utils/ytdlp-json');
		runYtdlpJsonMock.mockRejectedValue(new YtdlpAuthError('account has been terminated'));
		const { youtubeService } = await import('./youtube.service');
		await expect(youtubeService.fetchHistory('u1')).resolves.toEqual({ needsRelink: true });
	});

	it('propagates transient errors (timeout, proxy failure) instead of needsRelink', async () => {
		runYtdlpJsonMock.mockRejectedValue(new Error('yt-dlp timed out'));
		const { youtubeService } = await import('./youtube.service');
		const err = await youtubeService.fetchHistory('u1').catch((e) => e);
		expect(err).toBeInstanceOf(Error);
		expect((err as any).needsRelink).toBeUndefined();
		expect(err.message).toContain('timed out');
	});

	it('forwards the timeout option to the runner', async () => {
		runYtdlpJsonMock.mockResolvedValue('{"entries":[]}');
		const { youtubeService } = await import('./youtube.service');
		await youtubeService.fetchHistory('u1', { timeoutMs: 12345 });
		expect(runYtdlpJsonMock).toHaveBeenCalledWith(
			':ythistory',
			expect.objectContaining({ timeoutMs: 12345 }),
		);
	});
});
