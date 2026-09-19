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

import { escapeXml, buildCollectionXml, buildMovieNfo, nfoService } from './nfo.service';

describe('NFO builders', () => {
	it('escapes XML entities and strips control characters', () => {
		expect(escapeXml('a & <b> "c"')).toBe('a &amp; &lt;b&gt; &quot;c&quot;');
		expect(escapeXml('bad\u0001char')).toBe('badchar');
	});

	it('builds a collection (BoxSet) XML with youtube uniqueid', () => {
		const xml = buildCollectionXml({ title: 'Chan & Co', channelId: 'UC123' });
		expect(xml).toContain('<collection>');
		expect(xml).toContain('<title>Chan &amp; Co</title>');
		expect(xml).toContain('<uniqueid type="youtube" default="true">UC123</uniqueid>');
	});

	it('builds a movie NFO with premiered date, plot, runtime, and youtube uniqueid', () => {
		const nfo = buildMovieNfo({
			title: 'A Video',
			premiered: new Date('2024-05-01T00:00:00Z'),
			plot: 'A <plot>',
			runtimeSeconds: 120,
			videoId: 'vid1',
			channel: 'Chan & Co',
		});
		expect(nfo).toContain('<movie>');
		expect(nfo).toContain('<title>A Video</title>');
		expect(nfo).toContain('<studio>Chan &amp; Co</studio>');
		expect(nfo).toContain('<premiered>2024-05-01</premiered>');
		expect(nfo).toContain('<plot>A &lt;plot&gt;</plot>');
		expect(nfo).toContain('<runtime>2</runtime>');
		expect(nfo).toContain('>vid1</uniqueid>');
	});

	it('omits optional fields when absent', () => {
		const nfo = buildMovieNfo({ title: 'A Video' });
		expect(nfo).not.toContain('<studio>');
		expect(nfo).not.toContain('<premiered>');
		expect(nfo).not.toContain('<plot>');
		expect(nfo).not.toContain('<runtime>');
		expect(nfo).not.toContain('<uniqueid');
	});

	it('omits the collection uniqueid without a channel id', () => {
		const xml = buildCollectionXml({ title: 'Chan' });
		expect(xml).not.toContain('<uniqueid');
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

	it('writes a movie NFO per video and a collection.xml per channel', async () => {
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
		expect(result.movies).toBe(2);
		expect(result.channelUrl).toBe('https://www.youtube.com/channel/UCchan');

		const earlyNfo = await readFile(join(early, 'Early.nfo'), 'utf-8');
		expect(earlyNfo).toContain('<movie>');
		expect(earlyNfo).toContain('<title>Early &amp; Fast</title>');
		expect(earlyNfo).toContain('<studio>Chan</studio>');
		expect(earlyNfo).toContain('<premiered>2024-05-01</premiered>');
		expect(earlyNfo).toContain('<plot>First one</plot>');
		expect(earlyNfo).toContain('>v-early</uniqueid>');
		expect(earlyNfo).not.toContain('<season>');
		expect(earlyNfo).not.toContain('<episode>');

		const lateNfo = await readFile(join(late, 'Late.nfo'), 'utf-8');
		expect(lateNfo).toContain('<premiered>2025-01-10</premiered>');

		const collection = await readFile(join(dir, 'collection.xml'), 'utf-8');
		expect(collection).toContain('<collection>');
		expect(collection).toContain('<title>Chan</title>');
		expect(collection).toContain('>UCchan</uniqueid>');

		// Legacy TV-model series file is removed.
		await writeFile(join(dir, 'tvshow.nfo'), 'old');
		await nfoService.syncChannel(dir);
		await expect(readFile(join(dir, 'tvshow.nfo'), 'utf-8')).rejects.toThrow();
	});

	it('falls back to folder names for videos without DB rows', async () => {
		const a = await addVideo('A');
		const b = await addVideo('B');
		dbRows = [];

		const result = await nfoService.syncChannel(dir);
		expect(result.movies).toBe(2);

		const nfoA = await readFile(join(a, 'A.nfo'), 'utf-8');
		expect(nfoA).toContain('<title>A</title>');
		expect(nfoA).not.toContain('<premiered>');
		// The studio falls back to the channel folder name.
		expect(nfoA).toContain(`<studio>${basename(dir)}</studio>`);
		// Channel title falls back to the folder name.
		const collection = await readFile(join(dir, 'collection.xml'), 'utf-8');
		expect(collection).toContain(`<title>${basename(dir)}</title>`);
	});

	it('removes legacy per-video posters only when a cover exists', async () => {
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
		expect(first.movies).toBe(1);
		const nfoPath = join(dir, 'Vid', 'Vid.nfo');
		const before = await stat(nfoPath);
		const second = await nfoService.syncChannel(dir);
		expect(second.movies).toBe(1);
		const after = await stat(nfoPath);
		expect(after.mtimeMs).toBe(before.mtimeMs);
	});
});
