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
