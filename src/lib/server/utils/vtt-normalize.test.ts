import { describe, it, expect } from 'vitest';
import {
	isYouTubeWordTimed,
	parseSubtitleTimestamp,
	normalizeYouTubeSubtitles,
	wrapSubtitleText,
} from './vtt-normalize';

// A faithful sample of YouTube word-timed auto-captions: rolling cues that
// repeat the phrase, inline <time><c>word</c> marks, and 10ms reset cues.
const SAMPLE_VTT = `WEBVTT

00:00.320 --> 00:01.590 align:start position:0%
 
All<00:00:00.400><c> right,</c><00:00:00.640><c> I</c><00:00:00.800><c> know</c><00:00:00.880><c> what</c><00:00:01.120><c> you</c><00:00:01.280><c> guys</c><00:00:01.439><c> are</c>

00:01.590 --> 00:01.600 align:start position:0%
All right, I know what you guys are
 

00:01.600 --> 00:03.990 align:start position:0%
All right, I know what you guys are
thinking.<00:00:02.720><c> This</c><00:00:02.960><c> guy's</c><00:00:03.439><c> definitely</c>

00:03.990 --> 00:04.000 align:start position:0%
thinking. This guy's definitely
 

00:04.000 --> 00:05.670 align:start position:0%
thinking. This guy's definitely
cheating,

00:05.670 --> 00:05.680 align:start position:0%
cheating,
 
`;

describe('isYouTubeWordTimed', () => {
	it('detects word-timed captions and ignores plain files', () => {
		expect(isYouTubeWordTimed(SAMPLE_VTT)).toBe(true);
		expect(isYouTubeWordTimed('WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello there\n')).toBe(
			false,
		);
		expect(isYouTubeWordTimed('WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n<c>Hello</c>\n')).toBe(
			false,
		);
	});
});

describe('parseSubtitleTimestamp', () => {
	it('handles HH:MM:SS.mmm, MM:SS.mmm, SS.mmm and SRT commas', () => {
		expect(parseSubtitleTimestamp('00:00:01.234')).toBeCloseTo(1.234);
		expect(parseSubtitleTimestamp('00:01.234')).toBeCloseTo(1.234);
		expect(parseSubtitleTimestamp('01:01:01.000')).toBeCloseTo(3661);
		expect(parseSubtitleTimestamp('00:01:01,500')).toBeCloseTo(61.5);
		expect(parseSubtitleTimestamp('2.5')).toBeCloseTo(2.5);
	});
});

describe('normalizeYouTubeSubtitles', () => {
	it('returns null for files that are not word-timed', () => {
		expect(
			normalizeYouTubeSubtitles(
				'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nA normal, fully written subtitle line.\n',
				'vtt',
			),
		).toBeNull();
	});

	it('merges rolling cues into stable cues without duplicated words', () => {
		const out = normalizeYouTubeSubtitles(SAMPLE_VTT, 'vtt');
		expect(out).toBeTruthy();
		// Cue text = every line that is not a header or a timing line.
		const text = out!
			.split('\n')
			.filter(
				(l) =>
					!l.includes('-->') &&
					!l.startsWith('WEBVTT') &&
					!/^\d{1,2}:\d{2}(:\d{2})?(\.\d+)?$/.test(l.trim()),
			)
			.join(' ')
			.replace(/\s+/g, ' ')
			.trim();
		// Every word appears exactly once — the echoed text must not repeat.
		expect(text.match(/guys/gi)?.length).toBe(1);
		expect(text.match(/definitely/gi)?.length).toBe(1);
		expect(text).toContain('All right, I know what you guys are');
		expect(text).toContain('thinking. This guy');
		expect(text).toContain('cheating,');
		// No inline timing or colour markup survives.
		expect(out).not.toMatch(/<\d/);
		expect(out).not.toContain('<c>');
	});

	it('keeps cues on screen long enough and in order', () => {
		const out = normalizeYouTubeSubtitles(SAMPLE_VTT, 'vtt');
		const cueTimes = [
			...out!.matchAll(/(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})/g),
		].map((m) => [parseSubtitleTimestamp(m[1]), parseSubtitleTimestamp(m[2])] as const);
		expect(cueTimes.length).toBeGreaterThan(0);
		expect(cueTimes.length).toBeLessThan(5); // the sample is ~7s of speech
		for (let i = 0; i < cueTimes.length; i++) {
			const [start, end] = cueTimes[i];
			expect(end).toBeGreaterThan(start + 0.5);
			if (i > 0) expect(start).toBeGreaterThanOrEqual(cueTimes[i - 1][0]);
		}
	});

	it('breaks cues on long pauses between words', () => {
		const vtt = [
			'WEBVTT',
			'',
			'00:00.000 --> 00:00.100',
			'hello<00:00:00.1><c> world</c>',
			'',
			'00:05.000 --> 00:05.100',
			'hello world<00:00:05.0><c> again</c>',
			'',
		].join('\n');
		const out = normalizeYouTubeSubtitles(vtt, 'vtt');
		expect(out).toContain('hello world');
		expect(out).toContain('again');
		// 5s gap forces a new cue.
		const cueCount = (out!.match(/-->/g) ?? []).length;
		expect(cueCount).toBe(2);
	});

	it('splits long cues at a word boundary near the middle', () => {
		const words = Array.from({ length: 20 }, (_, i) => `w${i}`).join(' ');
		const [l1, l2] = wrapSubtitleText(words);
		expect(l1).not.toBe('');
		expect(l2).not.toBe('');
		expect(l1.split(' ').length + l2.split(' ').length).toBe(20);
		expect(Math.abs(l1.length - l2.length)).toBeLessThan(12);
		expect(wrapSubtitleText('short line')).toEqual(['short line']);
	});

	it('emits valid SRT with 1-based numbering', () => {
		const out = normalizeYouTubeSubtitles(SAMPLE_VTT, 'srt');
		expect(out).toMatch(/^1\n\d{2}:\d{2}:\d{2},\d{3} --> /);
		expect(out).not.toContain('WEBVTT');
	});

	it('does not crash when a cue is longer than the previous one (suffix match)', () => {
		// Previous cue is a single word; the next cue is longer and only its
		// tail overlaps. The suffix comparison must not read past the shorter
		// previous word list.
		const vtt = [
			'WEBVTT',
			'',
			'00:00.000 --> 00:00.100',
			'world',
			'',
			'00:01.000 --> 00:01.200',
			'a<00:00:01.0><c> b</c> world',
			'',
		].join('\n');
		expect(() => normalizeYouTubeSubtitles(vtt, 'vtt')).not.toThrow();
		const out = normalizeYouTubeSubtitles(vtt, 'vtt');
		expect(out).toContain('world');
	});
});
