import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

let dir: string;
let videoPath: string;
const WORD_TIMED_VTT = `WEBVTT

00:00.320 --> 00:01.590 align:start position:0%
 
All<00:00:00.400><c> right,</c><00:00:00.640><c> I</c><00:00:00.800><c> know</c>

00:01.590 --> 00:01.600 align:start position:0%
All right, I know
 
`;
const PLAIN_VTT = `WEBVTT

00:00:00.000 --> 00:00:02.000
A fully written, ordinary subtitle line.
`;

vi.mock('../db', () => ({
	prisma: {
		download: {
			findUnique: vi.fn(async () => ({ id: 'd1', filepath: videoPath })),
		},
		subtitleLine: {
			deleteMany: vi.fn(async () => ({ count: 0 })),
			createMany: vi.fn(async () => ({ count: 0 })),
		},
	},
}));

import { subtitleService } from './subtitle.service';

describe('subtitleService.normalizeSubtitles', () => {
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'wytui-subs-'));
		videoPath = join(dir, 'My Video.mp4');
		await mkdir(dir, { recursive: true });
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('rewrites a word-timed VTT in place and counts it', async () => {
		await writeFile(join(dir, 'My Video.en.vtt'), WORD_TIMED_VTT);

		const count = await subtitleService.normalizeSubtitles('d1');

		expect(count).toBe(1);
		const out = await readFile(join(dir, 'My Video.en.vtt'), 'utf-8');
		expect(out).not.toContain('<c>');
		expect(out).toContain('All right, I know');
		// Full HH:MM:SS.mmm timestamps.
		expect(out).toMatch(/^WEBVTT\n\n\d{2}:\d{2}:\d{2}\.\d{3} --> /);
	});

	it('leaves a non word-timed VTT untouched', async () => {
		await writeFile(join(dir, 'My Video.en.vtt'), PLAIN_VTT);

		const count = await subtitleService.normalizeSubtitles('d1');

		expect(count).toBe(0);
		expect(await readFile(join(dir, 'My Video.en.vtt'), 'utf-8')).toBe(PLAIN_VTT);
	});

	it('ignores subtitle files that do not match the video base name', async () => {
		await writeFile(join(dir, 'Other Video.en.vtt'), WORD_TIMED_VTT);

		const count = await subtitleService.normalizeSubtitles('d1');

		expect(count).toBe(0);
		expect(await readFile(join(dir, 'Other Video.en.vtt'), 'utf-8')).toBe(WORD_TIMED_VTT);
	});

	it('is idempotent — a second run rewrites nothing', async () => {
		await writeFile(join(dir, 'My Video.en.vtt'), WORD_TIMED_VTT);

		expect(await subtitleService.normalizeSubtitles('d1')).toBe(1);
		expect(await subtitleService.normalizeSubtitles('d1')).toBe(0);
	});

	it('returns 0 when the video has no filepath', async () => {
		const { prisma } = await import('../db');
		(prisma.download.findUnique as any).mockResolvedValueOnce({ id: 'd1', filepath: null });
		expect(await subtitleService.normalizeSubtitles('d1')).toBe(0);
	});
});
