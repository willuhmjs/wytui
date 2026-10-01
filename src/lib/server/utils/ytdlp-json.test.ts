import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const { spawnMock } = vi.hoisted(() => ({
	spawnMock: vi.fn(),
}));

vi.mock('child_process', () => {
	return {
		default: {
			spawn: spawnMock,
		},
		spawn: spawnMock,
	};
});

/** Minimal stand-in for a ChildProcess: emits on stdout/stderr, then closes. */
function fakeProc() {
	const p: any = new EventEmitter();
	p.stdout = new EventEmitter();
	p.stderr = new EventEmitter();
	p.kill = vi.fn();
	return p;
}

describe('runYtdlpJson', () => {
	beforeEach(() => {
		spawnMock.mockReset();
		vi.useRealTimers();
	});

	it('resolves stdout and passes the expected base args', async () => {
		const p = fakeProc();
		spawnMock.mockReturnValue(p);
		const { runYtdlpJson } = await import('./ytdlp-json');
		const promise = runYtdlpJson('ytsearch1:hi');

		p.stdout.emit('data', '{"a":');
		p.stdout.emit('data', '1}');
		p.emit('close', 0);

		await expect(promise).resolves.toBe('{"a":1}');
		const args = spawnMock.mock.calls[0][1];
		expect(args).toEqual([
			'--flat-playlist',
			'--dump-single-json',
			'--no-warnings',
			'ytsearch1:hi',
		]);
	});

	it('inserts --cookies and extraArgs before the target', async () => {
		const p = fakeProc();
		spawnMock.mockReturnValue(p);
		const { runYtdlpJson } = await import('./ytdlp-json');
		const promise = runYtdlpJson('TARGET', {
			cookiePath: '/tmp/c.txt',
			extraArgs: ['--playlist-start', '1'],
		});
		p.emit('close', 0);
		await promise;

		expect(spawnMock.mock.calls[0][1]).toEqual([
			'--flat-playlist',
			'--dump-single-json',
			'--no-warnings',
			'--cookies',
			'/tmp/c.txt',
			'--playlist-start',
			'1',
			'TARGET',
		]);
	});

	it('inserts --proxy after --cookies when proxyUrl is set', async () => {
		const p = fakeProc();
		spawnMock.mockReturnValue(p);
		const { runYtdlpJson } = await import('./ytdlp-json');
		const promise = runYtdlpJson('TARGET', {
			cookiePath: '/tmp/c.txt',
			proxyUrl: 'socks5h://1.2.3.4:1080',
		});
		p.emit('close', 0);

		await promise;

		expect(spawnMock.mock.calls[0][1]).toEqual([
			'--flat-playlist',
			'--dump-single-json',
			'--no-warnings',
			'--cookies',
			'/tmp/c.txt',
			'--proxy',
			'socks5h://1.2.3.4:1080',
			'TARGET',
		]);
	});

	it('rejects with stderr text on non-zero exit', async () => {
		const p = fakeProc();
		spawnMock.mockReturnValue(p);
		const { runYtdlpJson } = await import('./ytdlp-json');
		const promise = runYtdlpJson('TARGET');
		p.stderr.emit('data', 'ERROR: boom');
		p.emit('close', 1);
		await expect(promise).rejects.toThrow('ERROR: boom');
	});

	it('rejects with RateLimitError on HTTP 429', async () => {
		const p = fakeProc();
		spawnMock.mockReturnValue(p);
		const { runYtdlpJson, RateLimitError } = await import('./ytdlp-json');
		const promise = runYtdlpJson('TARGET');
		p.stderr.emit('data', 'ERROR: [youtube:tab] HTTP Error 429: Too Many Requests');
		p.emit('close', 1);
		await expect(promise).rejects.toBeInstanceOf(RateLimitError);
	});

	it('rejects with RateLimitError on bot-check prompts', async () => {
		const p = fakeProc();
		spawnMock.mockReturnValue(p);
		const { runYtdlpJson, RateLimitError } = await import('./ytdlp-json');
		const promise = runYtdlpJson('TARGET');
		p.stderr.emit('data', 'ERROR: Sign in to confirm you\u2019re not a bot');
		p.emit('close', 1);
		await expect(promise).rejects.toBeInstanceOf(RateLimitError);
	});

	it('rejects with AgeRestrictedError on age-gate prompts, not RateLimitError', async () => {
		const p = fakeProc();
		spawnMock.mockReturnValue(p);
		const { runYtdlpJson, AgeRestrictedError, RateLimitError } = await import('./ytdlp-json');
		const promise = runYtdlpJson('TARGET');
		p.stderr.emit(
			'data',
			'ERROR: [youtube] vid1: Sign in to confirm your age. This video may be inappropriate for some users.',
		);
		p.emit('close', 1);
		const err = await promise.catch((e) => e);
		expect(err).toBeInstanceOf(AgeRestrictedError);
		expect(err).not.toBeInstanceOf(RateLimitError);
		expect(err.isAgeRestricted).toBe(true);
	});

	it('classifies age gates and bot checks as distinct conditions', async () => {
		const { isRateLimitedError, isAgeRestrictedError } = await import('./ytdlp-json');
		const ageMsg =
			'ERROR: Sign in to confirm your age. This video may be inappropriate for some users.';
		const botMsg = 'ERROR: Sign in to confirm you\u2019re not a bot';
		expect(isAgeRestrictedError(ageMsg)).toBe(true);
		expect(isRateLimitedError(ageMsg)).toBe(false);
		expect(isAgeRestrictedError(botMsg)).toBe(false);
		expect(isRateLimitedError(botMsg)).toBe(true);
	});

	it('rejects with YtdlpAuthError on dead-session errors', async () => {
		const p = fakeProc();
		spawnMock.mockReturnValue(p);
		const { runYtdlpJson, YtdlpAuthError } = await import('./ytdlp-json');
		const promise = runYtdlpJson('TARGET');
		p.stderr.emit(
			'data',
			'ERROR: [youtube] This account has been terminated due to a claim of copyright infringement',
		);
		p.emit('close', 1);
		await expect(promise).rejects.toBeInstanceOf(YtdlpAuthError);
	});

	it('keeps network/transient failures as plain errors with stderr text', async () => {
		const p = fakeProc();
		spawnMock.mockReturnValue(p);
		const { runYtdlpJson, RateLimitError, YtdlpAuthError } = await import('./ytdlp-json');
		const promise = runYtdlpJson('TARGET');
		p.stderr.emit('data', 'ERROR: Unable to download webpage: FooBar (caused by ProxyError)');
		p.emit('close', 1);
		const err = await promise.catch((e) => e);
		expect(err).toBeInstanceOf(Error);
		expect(err).not.toBeInstanceOf(RateLimitError);
		expect(err).not.toBeInstanceOf(YtdlpAuthError);
		expect(err.message).toContain('Unable to download webpage');
	});

	it('kills the process and rejects when the timeout elapses', async () => {
		vi.useFakeTimers();
		const p = fakeProc();
		spawnMock.mockReturnValue(p);
		const { runYtdlpJson } = await import('./ytdlp-json');
		const promise = runYtdlpJson('TARGET', { timeoutMs: 1000 });
		vi.advanceTimersByTime(1001);
		await expect(promise).rejects.toThrow('yt-dlp timed out');
		expect(p.kill).toHaveBeenCalledWith('SIGKILL');
	});

	it('ignores a late close after the timeout already rejected', async () => {
		vi.useFakeTimers();
		const p = fakeProc();
		spawnMock.mockReturnValue(p);
		const { runYtdlpJson } = await import('./ytdlp-json');
		const promise = runYtdlpJson('TARGET', { timeoutMs: 1000 });
		vi.advanceTimersByTime(1001);
		await expect(promise).rejects.toThrow('yt-dlp timed out');
		expect(() => p.emit('close', 0)).not.toThrow();
	});
});

describe('classifyDownloadFailure', () => {
	// Verbatim from the production `downloads.error` column. The bot-check row
	// carries YouTube's U+2019 in "you’re" exactly as stored.
	const BOT_CHECK =
		'Metadata fetch failed: RateLimitError: [youtube] DrPARAh50vU: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication.';
	const AGE_GATE =
		'Metadata fetch failed: AgeRestrictedError: [youtube] e-_nrOrmYdk: Sign in to confirm your age. This video may be inappropriate.';
	const AGE_GATE_RAISED_AS_RATELIMIT =
		'Metadata fetch failed: RateLimitError: [youtube] X2bu3UjCxj0: Sign in to confirm your age. Use --cookies';
	const MEMBERS_ONLY =
		'Metadata fetch failed: Error: [youtube] tn0376-XtnY: Join this channel to get access to members-only content.';

	const CASES: Array<[string, string | null, 'transient' | 'cookie' | 'permanent']> = [
		[
			'HTTP 429 on the subtitle fetch',
			"ERROR: Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests",
			'transient',
		],
		[
			'metadata fetch timeout',
			'Metadata fetch failed: Error: yt-dlp metadata fetch timed out',
			'transient',
		],
		['bot check', BOT_CHECK, 'cookie'],
		['age gate', AGE_GATE, 'cookie'],
		['age gate raised as RateLimitError', AGE_GATE_RAISED_AS_RATELIMIT, 'cookie'],
		['members-only', MEMBERS_ONLY, 'cookie'],
		[
			'video unavailable',
			'Metadata fetch failed: Error: [youtube] DrPARAh50vU: Video unavailable',
			'permanent',
		],
		['forbidden flag', 'Forbidden flag: --postprocessor-args', 'permanent'],
		[
			'ffmpeg result not representable',
			'ERROR: Postprocessing: Error opening input files: Result not representable',
			'permanent',
		],
		[
			'upcoming live event',
			'Metadata fetch failed: Error: [youtube] A-4cDfvhvco: This live event will begin in a few moments.',
			'transient',
		],
		['stall watchdog', 'Download stalled (no progress for 600s)', 'transient'],
		['network unreachable', 'ERROR: [Errno 101] Network is unreachable', 'transient'],
		['null error', null, 'permanent'],
		['empty error', '', 'permanent'],
		['never-seen error', 'something we have never seen', 'permanent'],
	];

	for (const [label, error, expected] of CASES) {
		it(`classifies ${label} as ${expected}`, async () => {
			const { classifyDownloadFailure } = await import('./ytdlp-json');
			expect(classifyDownloadFailure(error)).toBe(expected);
		});
	}

	it('matches the bot-check literal despite YouTube’s U+2019 apostrophe', async () => {
		// Regression guard: the literal is written with a straight apostrophe, so
		// without normalizeFailureText() this matched 0 of the 30 bot-check rows
		// in the production table and cookies.invalidated never fired.
		const { isCookieFailureError } = await import('./ytdlp-json');
		expect(BOT_CHECK).toContain('you’re');
		expect(isCookieFailureError(BOT_CHECK)).toBe(true);
		expect(isCookieFailureError(BOT_CHECK.replace('\u2019', "'"))).toBe(true);
	});

	it('folds curly apostrophes and lowercases in normalizeFailureText', async () => {
		const { normalizeFailureText } = await import('./ytdlp-json');
		expect(normalizeFailureText('Sign in to confirm you\u2019re not a BO')).toBe(
			"sign in to confirm you're not a bo",
		);
		expect(normalizeFailureText('you\u2018re')).toBe("you're");
	});

	it('keeps a bot-check off the retry timer even though yt-dlp raises RateLimitError', async () => {
		const { isRateLimitedError, classifyDownloadFailure } = await import('./ytdlp-json');
		// The trap the class ordering exists for: a bot-check reads as a rate
		// limit, but only new cookies fix it — a timer retry hammers the block.
		expect(isRateLimitedError(BOT_CHECK)).toBe(true);
		expect(classifyDownloadFailure(BOT_CHECK)).toBe('cookie');
		expect(classifyDownloadFailure(AGE_GATE_RAISED_AS_RATELIMIT)).toBe('cookie');
	});
});

describe('isSubtitleFetchFailure', () => {
	// Verbatim from six production rows whose video was fine and only the
	// caption fetch was refused.
	const SUBTITLE_429 =
		"ERROR: Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests";

	it('matches the production subtitle-429 line', async () => {
		const { isSubtitleFetchFailure } = await import('./ytdlp-json');
		expect(isSubtitleFetchFailure(SUBTITLE_429)).toBe(true);
	});

	it('matches the wording variants yt-dlp uses for caption fetches', async () => {
		const { isSubtitleFetchFailure } = await import('./ytdlp-json');
		expect(
			isSubtitleFetchFailure('ERROR: Unable to download subtitles for language en: timed out'),
		).toBe(true);
		expect(
			isSubtitleFetchFailure(
				'ERROR: Unable to download automatic subtitles for language en: HTTP Error 503',
			),
		).toBe(true);
		// Case-insensitive, like every other predicate in this module.
		expect(isSubtitleFetchFailure('unable to download subtitle')).toBe(true);
	});

	it('does not swallow a failure of the media download itself', async () => {
		const { isSubtitleFetchFailure } = await import('./ytdlp-json');
		// Completing on this line would mark a missing video as COMPLETED.
		expect(
			isSubtitleFetchFailure(
				'ERROR: Unable to download video data: HTTP Error 403: Forbidden\n' +
					'ERROR: Unable to download video data: HTTP Error 403: Forbidden',
			),
		).toBe(false);
		expect(isSubtitleFetchFailure('ERROR: [youtube] vid1: Video unavailable')).toBe(false);
		expect(isSubtitleFetchFailure('yt-dlp exited with code 1')).toBe(false);
		expect(isSubtitleFetchFailure('')).toBe(false);
	});
});
