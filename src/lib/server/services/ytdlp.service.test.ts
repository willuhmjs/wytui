import { describe, it, expect } from 'vitest';
import { ytdlpService } from './ytdlp.service';

const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const OUT = '/tmp/out';

describe('buildArgs speed options', () => {
	it('adds --concurrent-fragments when > 1', () => {
		const args = ytdlpService.buildArgs(URL, OUT, [], { concurrentFragments: 4 });
		const i = args.indexOf('--concurrent-fragments');
		expect(i).toBeGreaterThan(-1);
		expect(args[i + 1]).toBe('4');
	});

	it('omits --concurrent-fragments when 0 or 1', () => {
		expect(ytdlpService.buildArgs(URL, OUT, [], { concurrentFragments: 1 })).not.toContain(
			'--concurrent-fragments',
		);
		expect(ytdlpService.buildArgs(URL, OUT, [], { concurrentFragments: 0 })).not.toContain(
			'--concurrent-fragments',
		);
	});

	it('adds --http-chunk-size when set', () => {
		const args = ytdlpService.buildArgs(URL, OUT, [], { httpChunkSize: '10M' });
		const i = args.indexOf('--http-chunk-size');
		expect(args[i + 1]).toBe('10M');
	});

	it('uses aria2c only when enabled AND available', () => {
		const on = ytdlpService.buildArgs(URL, OUT, [], { useAria2c: true, aria2cAvailable: true });
		expect(on).toContain('--downloader');
		expect(on[on.indexOf('--downloader') + 1]).toBe('aria2c');

		const missing = ytdlpService.buildArgs(URL, OUT, [], {
			useAria2c: true,
			aria2cAvailable: false,
		});
		expect(missing).not.toContain('--downloader');
	});
});
