import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join, basename } from 'path';

let dbRows: any[] = [];
vi.mock('../db', () => ({
	prisma: {
		download: {
			findMany: vi.fn(async () => dbRows),
		},
	},
}));

import { escapeXml, buildSeriesNfo, buildEpisodeNfo, nfoService } from './nfo.service';

describe('NFO builders', () => {
	it('escapes XML entities and strips control characters', () => {
		expect(escapeXml('a & <b> "c"')).toBe('a &amp; &lt;b&gt; &quot;c&quot;');
		expect(escapeXml('bad\u0001char')).toBe('badchar');
	});

	it('builds a series NFO with youtube uniqueid', () => {
		const nfo = buildSeriesNfo({ title: 'Chan & Co', channelId: 'UC123' });
		expect(nfo).toContain('<tvshow>');
		expect(nfo).toContain('<title>Chan &amp; Co</title>');
		expect(nfo).toContain('<uniqueid type="youtube" default="true">UC123</uniqueid>');
	});

	it('builds an episode NFO with year season, per-year episode, and aired date', () => {
		const nfo = buildEpisodeNfo({
			title: 'Ep',
			showTitle: 'Chan',
			season: 2024,
			episode: 3,
			aired: new Date('2024-05-01T00:00:00Z'),
			plot: 'A <plot>',
			runtimeSeconds: 120,
			videoId: 'vid1',
		});
		expect(nfo).toContain('<season>2024</season>');
		expect(nfo).toContain('<episode>3</episode>');
		expect(nfo).toContain('<aired>2024-05-01</aired>');
		expect(nfo).toContain('<plot>A &lt;plot&gt;</plot>');
		expect(nfo).toContain('<runtime>2</runtime>');
		expect(nfo).toContain('>vid1</uniqueid>');
	});

	it('omits optional fields when absent', () => {
		const nfo = buildEpisodeNfo({ title: 'Ep', season: 2025, episode: 1 });
		expect(nfo).not.toContain('<aired>');
		expect(nfo).not.toContain('<plot>');
		expect(nfo).not.toContain('<uniqueid');
	});
});

describe('nfoService.syncChannel', () => {
	let dir: string;

	beforeEach(async () => {
		dbRows = [];
		dir = await mkdtemp(join(tmpdir(), 'wytui-nfo-'));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	async function addVideo(name: string, files: Record<string, string> = {}): Promise<string> {
		const videoDir = join(dir, name);
		await mkdir(videoDir, { recursive: true });
		await writeFile(join(videoDir, `${name}.mp4`), 'x');
		for (const [file, content] of Object.entries(files)) {
			await writeFile(join(videoDir, file), content);
		}
		return videoDir;
	}

	it('numbers episodes chronologically with year seasons and writes tvshow.nfo', async () => {
		const early = await addVideo('Early');
		const late = await addVideo('Late');
		dbRows = [
			{
				filepath: join(early, 'Early.mp4'),
				status: 'COMPLETED',
				uploadDate: new Date('2024-05-01T00:00:00Z'),
				completedAt: new Date('2024-05-02T00:00:00Z'),
				title: 'Early & Fast',
				description: 'First one',
				duration: 60,
				videoId: 'v-early',
				uploader: 'Chan',
				channelUrl: 'https://www.youtube.com/channel/UCchan',
			},
			{
				filepath: join(late, 'Late.mp4'),
				status: 'COMPLETED',
				uploadDate: new Date('2025-01-10T00:00:00Z'),
				completedAt: new Date('2025-01-11T00:00:00Z'),
				title: 'Late',
				uploader: 'Chan',
				channelUrl: 'https://www.youtube.com/channel/UCchan',
			},
		];

		const result = await nfoService.syncChannel(dir);
		expect(result.episodes).toBe(2);
		expect(result.channelUrl).toBe('https://www.youtube.com/channel/UCchan');

		const earlyNfo = await readFile(join(early, 'Early.nfo'), 'utf-8');
		expect(earlyNfo).toContain('<title>Early &amp; Fast</title>');
		expect(earlyNfo).toContain('<season>2024</season>');
		expect(earlyNfo).toContain('<episode>1</episode>');
		expect(earlyNfo).toContain('<showtitle>Chan</showtitle>');

		const lateNfo = await readFile(join(late, 'Late.nfo'), 'utf-8');
		expect(lateNfo).toContain('<season>2025</season>');
		expect(lateNfo).toContain('<episode>1</episode>');

		const series = await readFile(join(dir, 'tvshow.nfo'), 'utf-8');
		expect(series).toContain('<title>Chan</title>');
		expect(series).toContain('>UCchan</uniqueid>');
	});

	it('falls back to mtime for videos without DB rows and renumbers within the year', async () => {
		const a = await addVideo('A');
		const b = await addVideo('B');
		dbRows = [];

		const result = await nfoService.syncChannel(dir);
		expect(result.episodes).toBe(2);

		// No rows at all: same-year videos numbered by mtime order.
		const year = new Date().getUTCFullYear();
		const nfoA = await readFile(join(a, 'A.nfo'), 'utf-8');
		const nfoB = await readFile(join(b, 'B.nfo'), 'utf-8');
		expect(nfoA).toContain(`<season>${year}</season>`);
		expect(nfoB).toContain(`<season>${year}</season>`);
		const numA = Number(/<episode>(\d+)<\/episode>/.exec(nfoA)![1]);
		const numB = Number(/<episode>(\d+)<\/episode>/.exec(nfoB)![1]);
		expect(Math.abs(numA - numB)).toBe(1);
		// Channel title falls back to the folder name.
		expect(nfoA).toContain(`<showtitle>${basename(dir)}</showtitle>`);
	});

	it('removes legacy per-episode posters only when a cover exists', async () => {
		const withCover = await addVideo('WithCover', { 'cover.jpg': 'c', 'poster.jpg': 'p' });
		const posterOnly = await addVideo('PosterOnly', { 'poster.jpg': 'p' });
		dbRows = [];

		await nfoService.syncChannel(dir);

		await expect(stat(join(withCover, 'poster.jpg'))).rejects.toThrow();
		await expect(stat(join(posterOnly, 'poster.jpg'))).resolves.toBeTruthy();
	});

	it('skips writes when content is unchanged and skips non-video dirs', async () => {
		await addVideo('Vid');
		await mkdir(join(dir, 'not-a-video'), { recursive: true });
		await writeFile(join(dir, 'loose.txt'), 'x');
		dbRows = [];

		const first = await nfoService.syncChannel(dir);
		expect(first.episodes).toBe(1);
		const nfoPath = join(dir, 'Vid', 'Vid.nfo');
		const before = await stat(nfoPath);
		const second = await nfoService.syncChannel(dir);
		expect(second.episodes).toBe(1);
		const after = await stat(nfoPath);
		expect(after.mtimeMs).toBe(before.mtimeMs);
	});
});
