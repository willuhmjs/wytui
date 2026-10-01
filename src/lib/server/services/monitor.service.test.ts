import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// The cookie resolver and the process spawn both run for real here (builtin
// mocks are a no-op under this vitest version, so the "binary" is a shell script
// in a temp dir). Only the encrypted-session source and the collaborators the
// monitor calls out to are stubbed.
const SESSION = '# Netscape HTTP Cookie File\nSID\tvalue\n';

const store = {
	links: {} as Record<string, { proxyUrl: string | null; cookiesTxt: string | null }>,
	settings: null as any,
	monitors: {} as Record<string, any>,
	createdDownloads: [] as any[][],
};

vi.mock('../db', () => ({
	prisma: {
		settings: {
			findUnique: vi.fn(async () => store.settings),
		},
		youTubeLink: {
			findUnique: vi.fn(async ({ where }: any) =>
				store.links[where.userId]
					? { proxyUrl: store.links[where.userId].proxyUrl, extraFlags: [] as string[] }
					: null,
			),
		},
		monitor: {
			findUnique: vi.fn(async ({ where }: any) => store.monitors[where.id] ?? null),
			update: vi.fn(async ({ where, data }: any) => {
				store.monitors[where.id] = { ...store.monitors[where.id], ...data };
				return store.monitors[where.id];
			}),
		},
	},
}));

vi.mock('./youtube-link.service', () => ({
	youtubeLinkService: {
		getCookiesTxt: vi.fn(async (userId: string) => store.links[userId]?.cookiesTxt ?? null),
	},
}));

vi.mock('./download.service', () => ({
	downloadService: {
		createDownload: vi.fn(async (...args: any[]) => {
			store.createdDownloads.push(args);
			return { id: 'dl-1' };
		}),
	},
}));

vi.mock('../sse/emitter', () => ({
	sseEmitter: { broadcast: vi.fn(), broadcastToUser: vi.fn() },
}));

import { monitorService } from './monitor.service';
import { ytdlpService } from './ytdlp.service';

/**
 * A stand-in yt-dlp that records its argv and whether the file named by
 * --cookies still existed at the moment it ran — the property that matters for
 * a temp cookie file handed to a long-lived process.
 */
async function fakeYtdlp(dir: string): Promise<{ bin: string; record: string }> {
	const bin = join(dir, 'fake-ytdlp.sh');
	const record = join(dir, 'argv.txt');
	const script = `#!/bin/sh
printf 'args:%s\\n' "$*" >> '${record}'
prev=
for a in "$@"; do
  if [ "$prev" = "--cookies" ]; then
    if [ -f "$a" ]; then printf 'cookies_readable=1\\n' >> '${record}'; else printf 'cookies_readable=0\\n' >> '${record}'; fi
  fi
  prev="$a"
done
exit 0
`;
	await writeFile(bin, script, { mode: 0o755 });
	return { bin, record };
}

function argvFrom(recordText: string): string[] {
	const line = recordText.match(/^args:(.*)$/m);
	return line ? line[1].split(' ') : [];
}

describe('monitor-owned downloads', () => {
	beforeEach(() => {
		store.createdDownloads.length = 0;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('creates the auto-download row owned by the monitor', async () => {
		// handleStreamLive parks a 1h timer to clear the live flag; fake timers keep
		// it from outliving the test.
		vi.useFakeTimers();
		await (monitorService as any).handleStreamLive({
			id: 'm1',
			name: 'M',
			url: 'https://www.youtube.com/@c/live',
			profileId: 'p1',
			userId: 'owner-9',
			autoDownload: true,
			customFlags: ['--limit-rate', '1M'],
		});

		// Without an owner the row could never resolve which linked session to
		// download with.
		expect(store.createdDownloads[0]).toEqual([
			'https://www.youtube.com/@c/live',
			'p1',
			'owner-9',
			undefined,
			false,
			['--limit-rate', '1M'],
		]);
	});

	it('invents no owner for a monitor that has none', async () => {
		vi.useFakeTimers();
		await (monitorService as any).handleStreamLive({
			id: 'm2',
			name: 'M2',
			url: 'https://www.youtube.com/@c/live',
			profileId: 'p1',
			userId: null,
			autoDownload: true,
			customFlags: undefined,
		});

		expect(store.createdDownloads[0][2]).toBeUndefined();
	});
});

describe('monitor yt-dlp probes', () => {
	let dir: string;

	beforeEach(async () => {
		for (const k of Object.keys(store.links)) delete store.links[k];
		for (const k of Object.keys(store.monitors)) delete store.monitors[k];
		store.createdDownloads.length = 0;
		store.settings = { ytdlpProxyUrl: 'socks5h://global:1080' };
		dir = await mkdtemp(join(tmpdir(), 'wytui-monitor-test-'));
	});

	afterEach(async () => {
		monitorService.stopMonitor('m1');
		vi.restoreAllMocks();
		await rm(dir, { recursive: true, force: true });
	});

	it('polls a YouTube live stream with the owner session and its paired proxy', async () => {
		store.links['owner-7'] = { proxyUrl: 'socks5h://owner7:1080', cookiesTxt: SESSION };
		const { bin, record } = await fakeYtdlp(dir);
		vi.spyOn(ytdlpService, 'getPath').mockReturnValue(bin);

		await monitorService.startMonitor({
			id: 'm1',
			type: 'YOUTUBE_LIVE',
			enabled: true,
			autoDownload: false,
			userId: 'owner-7',
			url: 'https://www.youtube.com/@c/live',
			name: 'M',
			profileId: 'p1',
		});

		await vi.waitFor(() => expect(existsSync(record)).toBe(true));
		const text = await readFile(record, 'utf8');
		const args = argvFrom(text);

		const cookieIdx = args.indexOf('--cookies');
		expect(cookieIdx).toBeGreaterThan(-1);
		const cookiePath = args[cookieIdx + 1];
		expect(cookiePath).toContain('wytui-yt-');
		// The probe is long-lived: the resolver has to keep the file alive until it
		// exits, not just until the spawn call returned.
		expect(text).toContain('cookies_readable=1');
		expect(args[args.indexOf('--proxy') + 1]).toBe('socks5h://owner7:1080');

		// And the session is unlinked once the probe is gone.
		await vi.waitFor(() => expect(existsSync(cookiePath)).toBe(false));
	});

	it('runs the Twitch check with the owner session too', async () => {
		store.links['owner-8'] = { proxyUrl: null, cookiesTxt: SESSION };
		const { bin, record } = await fakeYtdlp(dir);
		vi.spyOn(ytdlpService, 'getPath').mockReturnValue(bin);

		await (monitorService as any).checkTwitchStream({
			id: 'm1',
			type: 'TWITCH',
			enabled: true,
			userId: 'owner-8',
			url: 'https://twitch.tv/somechannel',
			name: 'M',
			isLive: true,
		});

		const text = await readFile(record, 'utf8');
		const args = argvFrom(text);
		expect(args).toContain('--cookies');
		expect(text).toContain('cookies_readable=1');
		// No per-link proxy: the server-wide one is used, matching the session source.
		expect(args[args.indexOf('--proxy') + 1]).toBe('socks5h://global:1080');
	});
});
