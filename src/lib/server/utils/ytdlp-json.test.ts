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

	it('rejects with stderr text on non-zero exit', async () => {
		const p = fakeProc();
		spawnMock.mockReturnValue(p);
		const { runYtdlpJson } = await import('./ytdlp-json');
		const promise = runYtdlpJson('TARGET');
		p.stderr.emit('data', 'ERROR: boom');
		p.emit('close', 1);
		await expect(promise).rejects.toThrow('ERROR: boom');
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
