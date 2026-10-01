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

describe('buildArgs proxy option', () => {
	it('adds --proxy when set', () => {
		const args = ytdlpService.buildArgs(URL, OUT, [], { proxyUrl: 'socks5://127.0.0.1:1080' });
		const i = args.indexOf('--proxy');
		expect(i).toBeGreaterThan(-1);
		expect(args[i + 1]).toBe('socks5://127.0.0.1:1080');
	});

	it('omits --proxy when unset', () => {
		expect(ytdlpService.buildArgs(URL, OUT, [], {})).not.toContain('--proxy');
		expect(ytdlpService.buildArgs(URL, OUT, [], { proxyUrl: null })).not.toContain('--proxy');
	});
});

describe('buildDefaultsArgs', () => {
	it('combines proxy and extra flags', () => {
		expect(
			ytdlpService.buildDefaultsArgs({
				proxyUrl: 'socks5h://proxy.internal:1080',
				extraFlags: ['--sleep-requests', '1'],
			}),
		).toEqual(['--proxy', 'socks5h://proxy.internal:1080', '--sleep-requests', '1']);
	});

	it('returns an empty array when no defaults are configured', () => {
		expect(ytdlpService.buildDefaultsArgs({})).toEqual([]);
		expect(ytdlpService.buildDefaultsArgs({ proxyUrl: null, extraFlags: [] as string[] })).toEqual(
			[],
		);
	});

	it('carries the resolved session file next to the proxy it belongs to', () => {
		expect(
			ytdlpService.buildDefaultsArgs({
				cookiePath: '/tmp/wytui-yt-123.txt',
				proxyUrl: 'http://account-proxy:8080',
				extraFlags: ['--sleep-requests', '1'],
			}),
		).toEqual([
			'--cookies',
			'/tmp/wytui-yt-123.txt',
			'--proxy',
			'http://account-proxy:8080',
			'--sleep-requests',
			'1',
		]);
	});
});

describe('findDangerousFlag', () => {
	it('allows ordinary flags and their plain values', () => {
		expect(ytdlpService.findDangerousFlag(['--sleep-requests', '1'])).toBeNull();
		expect(ytdlpService.findDangerousFlag(['-f', 'bv*+ba/b', '--no-warnings'])).toBeNull();
		expect(
			ytdlpService.findDangerousFlag(['--extractor-args', 'youtube:player_client=web_safari']),
		).toBeNull();
	});

	it('passes unknown-but-inert flags through for yt-dlp to reject', () => {
		// yt-dlp's own parser rejects unrecognized options, so the denylist
		// only needs to cover execution/loading capability.
		expect(ytdlpService.findDangerousFlag(['--console-title'])).toBeNull();
		expect(ytdlpService.findDangerousFlag(['--some-future-flag', 'value'])).toBeNull();
	});

	it('rejects command-executing flags and their abbreviations', () => {
		expect(ytdlpService.findDangerousFlag(['--exec', 'curl http://evil.example'])).toBe('--exec');
		expect(ytdlpService.findDangerousFlag(['--exec-before-download', 'rm -rf /'])).toBe(
			'--exec-before-download',
		);
		// argparse expands unambiguous prefixes: --exe resolves to --exec
		expect(ytdlpService.findDangerousFlag(['--exe', 'echo pwned'])).toBe('--exe');
		expect(ytdlpService.findDangerousFlag(['--exec=touch /tmp/pwned'])).toBe(
			'--exec=touch /tmp/pwned',
		);

		// --downloader/--downloader-args are aliases of --external-downloader
		expect(ytdlpService.findDangerousFlag(['--downloader', '/bin/sh'])).toBe('--downloader');
		expect(ytdlpService.findDangerousFlag(['--downloader-args', 'sh:-c evil'])).toBe(
			'--downloader-args',
		);
		expect(ytdlpService.findDangerousFlag(['--external-downloader', 'curl'])).toBe(
			'--external-downloader',
		);
	});

	it('rejects code/config/sensitive-file loading flags', () => {
		expect(ytdlpService.findDangerousFlag(['--plugin-dirs', '/tmp/pl'])).toBe('--plugin-dirs');
		expect(ytdlpService.findDangerousFlag(['--config-locations', '/tmp/evil.conf'])).toBe(
			'--config-locations',
		);
		expect(ytdlpService.findDangerousFlag(['-a', '/etc/passwd'])).toBe('-a');
		expect(ytdlpService.findDangerousFlag(['--batch', 'urls.txt'])).toBe('--batch');
		expect(ytdlpService.findDangerousFlag(['--ffmpeg-location', '/tmp/evil-ffmpeg'])).toBe(
			'--ffmpeg-location',
		);
		expect(ytdlpService.findDangerousFlag(['--js-runtimes', 'deno:/tmp/evil.sh'])).toBe(
			'--js-runtimes',
		);
		expect(ytdlpService.findDangerousFlag(['--load-info-json', '/etc/shadow'])).toBe(
			'--load-info-json',
		);
		expect(ytdlpService.findDangerousFlag(['--print-to-file', 'id', '/etc/cron.d/x'])).toBe(
			'--print-to-file',
		);
	});

	it('rejects file-path override and arg-injection vectors', () => {
		// Output path overrides = arbitrary write outside the download dir
		expect(ytdlpService.findDangerousFlag(['--output', '/etc/cron.d/pwn'])).toBe('--output');
		expect(ytdlpService.findDangerousFlag(['-o', '/tmp/evil/%(title)s'])).toBe('-o');
		expect(ytdlpService.findDangerousFlag(['--paths', '/tmp/evil'])).toBe('--paths');
		expect(ytdlpService.findDangerousFlag(['-P', '/tmp/evil'])).toBe('-P');
		expect(ytdlpService.findDangerousFlag(['--download-archive', '/etc/app/archive.txt'])).toBe(
			'--download-archive',
		);
		// Cookie files: cross-session hijack (e.g. another user's cookies)
		expect(ytdlpService.findDangerousFlag(['--cookies', '/app/cookies/alice.txt'])).toBe(
			'--cookies',
		);
		expect(ytdlpService.findDangerousFlag(['--cookies-from', 'chrome'])).toBe('--cookies-from');
		expect(ytdlpService.findDangerousFlag(['--cookies-from-browser', 'chrome'])).toBe(
			'--cookies-from-browser',
		);
		// ffmpeg arg injection can read arbitrary files into the output video
		expect(ytdlpService.findDangerousFlag(['--postprocessor-args', 'Merger:-i /etc/shadow'])).toBe(
			'--postprocessor-args',
		);
		expect(ytdlpService.findDangerousFlag(['--ppa', 'Merger:-v'])).toBe('--ppa');
		// Server-side fetch of arbitrary URLs / header injection
		expect(ytdlpService.findDangerousFlag(['--sponsorblock-api', 'http://evil.example'])).toBe(
			'--sponsorblock-api',
		);
		expect(ytdlpService.findDangerousFlag(['--add-headers', 'Authorization: Bearer x'])).toBe(
			'--add-headers',
		);
	});

	it('rejects credential-leak and transport-weakening flags', () => {
		expect(ytdlpService.findDangerousFlag(['--proxy', 'http://attacker:8888'])).toBe('--proxy');
		expect(ytdlpService.findDangerousFlag(['--proxy=socks5://attacker:1080'])).toBe(
			'--proxy=socks5://attacker:1080',
		);
		expect(ytdlpService.findDangerousFlag(['--no-check-certificates'])).toBe(
			'--no-check-certificates',
		);
		expect(ytdlpService.findDangerousFlag(['--no-check-certificate'])).toBe(
			'--no-check-certificate',
		);
		expect(ytdlpService.findDangerousFlag(['--netrc-cmd', 'gpg --decrypt ~/.auth.gpg'])).toBe(
			'--netrc-cmd',
		);
		expect(
			ytdlpService.findDangerousFlag([
				'--parse-metadata',
				'description:(?P<additional_urls>https://evil.example/x)',
			]),
		).toBe('--parse-metadata');
	});

	it('still allows the safe exact flags that prefix a dangerous one', () => {
		// argparse resolves exact matches before abbreviations
		expect(ytdlpService.findDangerousFlag(['--print', 'id'])).toBeNull();
		// Short flags are case-sensitive: -O is --print (safe), -o is --output
		expect(ytdlpService.findDangerousFlag(['-O', 'id'])).toBeNull();
		// Internal args are added by buildArgs itself, not user flags, so
		// app-managed --cookies/<aria2c> --downloader usage is unaffected.
	});

	it('allows the official negation flags', () => {
		expect(ytdlpService.findDangerousFlag(['--no-exec'])).toBeNull();
		expect(ytdlpService.findDangerousFlag(['--no-plugin-dirs'])).toBeNull();
		expect(ytdlpService.findDangerousFlag(['--no-config-locations'])).toBeNull();
		expect(ytdlpService.findDangerousFlag(['--ignore-config'])).toBeNull();
	});

	it('rejects shell metacharacters in any token', () => {
		expect(ytdlpService.findDangerousFlag(['--proxy;evil'])).toBe('--proxy;evil');
		expect(ytdlpService.findDangerousFlag(['--format', 'mp4|sh'])).toBe('mp4|sh');
	});
});

describe('buildArgs', () => {
	it('appends the official kill switches after user flags', () => {
		const args = ytdlpService.buildArgs('https://www.youtube.com/watch?v=abc', '/tmp/downloads', [
			'--format',
			'bv*+ba/b',
		]);
		const urlIndex = args.indexOf('https://www.youtube.com/watch?v=abc');
		const noExecIndex = args.indexOf('--no-exec');
		const userFlagIndex = args.indexOf('--format');
		expect(noExecIndex).toBeGreaterThan(-1);
		// Kill switches come after user flags (so they win) and before the URL
		expect(noExecIndex).toBeGreaterThan(userFlagIndex);
		expect(noExecIndex).toBeLessThan(urlIndex);
		expect(args).toContain('--ignore-config');
		expect(args).toContain('--no-plugin-dirs');
		expect(args).toContain('--no-config-locations');
	});

	it('keeps the internal aria2c downloader args (not user-supplied)', () => {
		const args = ytdlpService.buildArgs(
			'https://www.youtube.com/watch?v=abc',
			'/tmp/downloads',
			[],
			{ useAria2c: true, aria2cAvailable: true },
		);
		expect(args).toContain('--downloader');
		expect(args).toContain('aria2c');
	});

	it('throws at runtime on a dangerous flag saved in a profile (stale-DB guard)', () => {
		expect(() =>
			ytdlpService.buildArgs('https://www.youtube.com/watch?v=abc', '/tmp/downloads', [
				'-o',
				'/tmp/evil/%(title)s',
			]),
		).toThrow('Forbidden flag: -o');
	});

	it('app-managed --cookies/--proxy are pushed after custom flags so they win', () => {
		const args = ytdlpService.buildArgs('https://www.youtube.com/watch?v=abc', '/tmp/downloads', [
			'--sleep-requests',
			'1',
		]);
		const withOpts = ytdlpService.buildArgs(
			'https://www.youtube.com/watch?v=abc',
			'/tmp/downloads',
			['--sleep-requests', '1'],
			{ cookiePath: '/app/cookies/admin.txt', proxyUrl: 'socks5://corp:1080' },
		);
		expect(args).not.toContain('--cookies');

		const customIndex = withOpts.indexOf('--sleep-requests');
		const cookiesIndex = withOpts.lastIndexOf('--cookies');
		const proxyIndex = withOpts.lastIndexOf('--proxy');
		expect(withOpts[cookiesIndex + 1]).toBe('/app/cookies/admin.txt');
		expect(withOpts[proxyIndex + 1]).toBe('socks5://corp:1080');
		expect(cookiesIndex).toBeGreaterThan(customIndex);
		expect(proxyIndex).toBeGreaterThan(customIndex);
		expect(proxyIndex).toBeLessThan(withOpts.indexOf('https://www.youtube.com/watch?v=abc'));
	});

	it('refuses a custom flag that tries to override the app proxy', () => {
		expect(() =>
			ytdlpService.buildArgs('https://www.youtube.com/watch?v=abc', '/tmp/downloads', [
				'--proxy',
				'http://attacker:8888',
				'--no-check-certificates',
			]),
		).toThrow('Forbidden flag: --proxy');
	});

	it('leaves flags that merely share a prefix with the denylist alone', () => {
		// Prefix matching exists for abbreviations (--exe → --exec); it must not swallow unrelated real flags.
		expect(
			ytdlpService.findDangerousFlag([
				'--socket-timeout',
				'30',
				'--source-address',
				'10.0.0.5',
				'--force-ipv4',
				'--no-check-thumbnails',
				'--parse-playlist',
			]),
		).toBeNull();
	});

	it('buildDefaultsArgs rejects stale saved extra flags', () => {
		expect(() =>
			ytdlpService.buildDefaultsArgs({ extraFlags: ['--postprocessor-args', 'Merger:-v'] }),
		).toThrow('Forbidden flag in saved extra flags');
		expect(ytdlpService.buildDefaultsArgs({ extraFlags: ['--sleep-requests', '1'] })).toEqual([
			'--sleep-requests',
			'1',
		]);
	});
});
