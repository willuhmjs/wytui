/**
 * Normalize YouTube word-timed auto-caption files into conventional subtitle
 * cues.
 *
 * YouTube auto-caption VTTs are "rolling" display text: every cue repeats the
 * current phrase and appends a few new words (marked with inline
 * `<00:00:01.234><c>word</c>` timing tags), interleaved with 10ms "reset" cues
 * that just re-show the phrase. Played back as-is, the screen constantly
 * changes half a sentence at a time.
 *
 * This module extracts the word stream (using the inline timing where present,
 * skipping the echoed text), then regroups the words into stable cues of up to
 * ~2 lines that hold on screen like ordinary movie/series subtitles.
 *
 * Files that do not look like YouTube word-timed captions are left untouched
 * (returns null) so hand-made subtitles are never rewritten.
 */

export interface MergedCue {
	start: number; // seconds
	end: number; // seconds
	text: string;
}

interface RawCue {
	start: number;
	end: number;
	lines: string[];
}

interface TimedWord {
	text: string;
	start: number; // seconds (approximate for unmarked words)
}

const MAX_CUE_CHARS = 42;
const CUE_GAP_SECONDS = 1.0;
const CUE_TAIL_SECONDS = 0.8;
const EST_WORD_SECONDS = 0.25;

/** Signature of YouTube word-timed captions: inline time tag before a <c>. */
const WORD_TIMED_RE = /<\d{1,2}(?::\d{1,2}){1,2}(?:\.\d{1,3})?><c>/;

export function isYouTubeWordTimed(content: string): boolean {
	return WORD_TIMED_RE.test(content);
}

/** Parse a timestamp like 00:00:01.234, 00:01.234 or 1.234 into seconds. */
export function parseSubtitleTimestamp(ts: string): number {
	const t = ts.trim().replace(',', '.');
	const parts = t.split(':');
	const last = parseFloat(parts[parts.length - 1]) || 0;
	if (parts.length === 3) {
		return (parseInt(parts[0], 10) || 0) * 3600 + (parseInt(parts[1], 10) || 0) * 60 + last;
	}
	if (parts.length === 2) {
		return (parseInt(parts[0], 10) || 0) * 60 + last;
	}
	return last;
}

/**
 * Split subtitle text into cues (start, end, raw text lines).
 *
 * Blocks are separated by genuinely empty lines only — YouTube cues may
 * contain whitespace-only lines that are part of the cue text.
 */
export function parseSubtitleCues(content: string): RawCue[] {
	const cues: RawCue[] = [];
	for (const block of content.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
		const lines = block.split('\n');
		const tsIdx = lines.findIndex((l) => l.includes('-->'));
		if (tsIdx === -1) continue;
		const m = lines[tsIdx].match(/([\d:.]+)\s*-->\s*([\d:.]+)/);
		if (!m) continue;
		cues.push({
			start: parseSubtitleTimestamp(m[1]),
			end: parseSubtitleTimestamp(m[2]),
			lines: lines.slice(tsIdx + 1),
		});
	}
	return cues;
}

interface Mark {
	time: number;
	/** [start, end) span of the marked word inside the plain string. */
	wordOffset: number;
	wordEnd: number;
}

/**
 * Strip the inline timing/colour markup from a cue's raw text, returning the
 * plain text plus the position and time of every word-timing mark.
 */
function plainTextAndMarks(raw: string): { plain: string; marks: Mark[] } {
	const markRe = /<(\d{1,2}(?::\d{1,2}){1,2}(?:\.\d{1,3})?)><c>([^<]*)<\/c>/g;
	let plain = '';
	const marks: Mark[] = [];
	let last = 0;
	for (const m of raw.matchAll(markRe)) {
		plain += decodeEntities(raw.slice(last, m.index));
		const word = decodeEntities(m[2]);
		marks.push({
			time: parseSubtitleTimestamp(m[1]),
			wordOffset: plain.length,
			wordEnd: plain.length + word.length,
		});
		plain += word;
		last = m.index + m[0].length;
	}
	plain += decodeEntities(raw.slice(last));
	return { plain, marks };
}

function normWord(w: string): string {
	return w.toLowerCase().replace(/[^a-z0-9']/g, '');
}

/** Decode the HTML entities YouTube emits in cue text (&gt;&gt; etc.). */
function decodeEntities(s: string): string {
	return s
		.replace(/&gt;/g, '>')
		.replace(/&lt;/g, '<')
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&');
}

/**
 * Extract the ordered word stream from rolling YouTube cues. Echoed (repeated)
 * words are dropped; marked words get their exact time, unmarked new words get
 * an estimate near the cue start.
 */
export function extractWordStream(cues: RawCue[]): TimedWord[] {
	const words: TimedWord[] = [];
	let prevTexts: string[] = [];

	for (const cue of cues) {
		const { plain: text, marks } = plainTextAndMarks(cue.lines.join('\n'));
		if (!text.trim()) {
			prevTexts = [];
			continue;
		}

		// Words of this cue, each tied to the timing mark covering it. Tokens
		// without letters or digits (e.g. the ">>" speaker marker) are dropped.
		const cueWords: { text: string; time: number | null }[] = [];
		for (const m of text.matchAll(/\S+/g)) {
			if (!normWord(m[0])) continue;
			const mark = marks.find((mk) => mk.wordOffset <= m.index && m.index < mk.wordEnd);
			cueWords.push({ text: m[0], time: mark ? mark.time : null });
		}
		const texts = cueWords.map((w) => w.text);

		// How many leading words are an echo of the previous cue. The rolling
		// window either grows (this cue extends the previous word run) or the
		// 10ms reset cue re-shows a trailing window of it — only the extension
		// is new content.
		let offset = 0;
		if (prevTexts.length > 0) {
			const n = Math.min(prevTexts.length, texts.length);
			let k = 0;
			while (k < n && normWord(texts[k]) === normWord(prevTexts[k])) k++;
			if (k === prevTexts.length) {
				offset = k;
			} else {
				let sfx = 0;
				const sfxMax = Math.min(texts.length, prevTexts.length);
				while (
					sfx < sfxMax &&
					normWord(texts[texts.length - 1 - sfx]) ===
						normWord(prevTexts[prevTexts.length - 1 - sfx])
				) {
					sfx++;
				}
				if (sfx === texts.length) offset = texts.length;
			}
		}
		prevTexts = texts;

		// The inline mark times are the trustworthy absolute audio times; the
		// cue's wall-clock timestamp can drift from them. Runs of unmarked new
		// words are spread evenly between the word before the run and the
		// marked word after it.
		let i = offset;
		while (i < cueWords.length) {
			const w = cueWords[i];
			if (w.time != null) {
				words.push({ text: w.text, start: w.time });
				i++;
				continue;
			}
			// Unmarked text is new only if it does not repeat the word we just
			// captured.
			const lastWord = words[words.length - 1];
			if (lastWord && normWord(lastWord.text) === normWord(w.text)) {
				i++;
				continue;
			}
			// Collect the whole run of consecutive unmarked words, then place
			// them at once (per-word interpolation would drift past the next
			// mark).
			const run: string[] = [w.text];
			let j = i + 1;
			while (j < cueWords.length && cueWords[j].time == null) {
				run.push(cueWords[j].text);
				j++;
			}
			const tPrev = lastWord ? lastWord.start : cue.start;
			let tNext = j < cueWords.length ? cueWords[j].time! : tPrev + run.length * EST_WORD_SECONDS;
			if (tNext <= tPrev) tNext = tPrev + run.length * EST_WORD_SECONDS;
			for (let k = 0; k < run.length; k++) {
				words.push({
					text: run[k],
					start: tPrev + ((tNext - tPrev) * (k + 1)) / (run.length + 1),
				});
			}
			i = j;
		}
	}
	return words;
}

/** Regroup the word stream into stable cues (gap or length triggers a break). */
function buildCues(words: TimedWord[]): MergedCue[] {
	const cues: MergedCue[] = [];
	let cur: { start: number; words: string[]; maxTime: number } | null = null;

	const flush = () => {
		if (!cur) return;
		cues.push({ start: cur.start, end: cur.maxTime + CUE_TAIL_SECONDS, text: cur.words.join(' ') });
		cur = null;
	};

	// Word timings can occasionally step backwards (ASR glitches); track a
	// monotonic high-water mark so cue ends never precede their starts and cues
	// stay in order.
	let highWater = 0;
	for (const w of words) {
		const t = Math.max(w.start, highWater);
		const wouldBe = cur ? cur.words.join(' ').length + w.text.length + 1 : w.text.length;
		if (cur && (t - cur.maxTime > CUE_GAP_SECONDS || wouldBe > MAX_CUE_CHARS)) flush();
		if (!cur) cur = { start: t, words: [w.text], maxTime: t };
		else {
			cur.words.push(w.text);
			cur.maxTime = t;
		}
		highWater = t;
	}
	flush();

	// Fold single-word orphan cues into the previous cue when it is close by
	// (the 0.8s cue tail plus a length-triggered break can strand one word).
	// Orphans after a real pause stay their own cue.
	const ORPHON_PROXIMITY_SECONDS = CUE_TAIL_SECONDS + 0.2;
	for (let i = 1; i < cues.length; i++) {
		const prev = cues[i - 1];
		const curCue = cues[i];
		const merged = prev.text + ' ' + curCue.text;
		if (
			curCue.text.split(' ').length <= 1 &&
			merged.length <= MAX_CUE_CHARS + 6 &&
			curCue.start <= prev.end + ORPHON_PROXIMITY_SECONDS
		) {
			prev.text = merged;
			prev.end = curCue.end;
			cues.splice(i, 1);
			i--;
		}
	}
	if (cues.length > 1) {
		const first = cues[0];
		if (
			first.text.split(' ').length === 1 &&
			(first.text + ' ' + cues[1].text).length <= MAX_CUE_CHARS + 6 &&
			cues[1].start <= first.end + ORPHON_PROXIMITY_SECONDS
		) {
			cues[1].text = first.text + ' ' + cues[1].text;
			cues[1].start = first.start;
			cues.splice(0, 1);
		}
	}

	// Make cue starts sequential (the 0.8s tail may overlap the next start).
	for (let i = 1; i < cues.length; i++) {
		if (cues[i].start < cues[i - 1].end) cues[i].start = cues[i - 1].end;
	}
	return cues;
}

/** Wrap text to at most two lines, splitting near the middle at a word boundary. */
export function wrapSubtitleText(text: string, max = MAX_CUE_CHARS): string[] {
	if (text.length <= max) return [text];
	const words = text.split(' ');
	if (words.length < 2) return [text];
	let best = 1;
	let bestDiff = Infinity;
	let len = 0;
	for (let i = 0; i < words.length - 1; i++) {
		len += words[i].length + 1;
		const diff = Math.abs(len - text.length / 2);
		if (diff < bestDiff) {
			bestDiff = diff;
			best = i + 1;
		}
	}
	return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

function pad2(n: number): string {
	return String(n).padStart(2, '0');
}

function formatVttTimestamp(s: number): string {
	const h = Math.floor(s / 3600);
	const m = Math.floor(s / 60) % 60;
	const sec = Math.floor(s % 60);
	const ms = Math.round((s - Math.floor(s)) * 1000);
	return `${pad2(h)}:${pad2(m)}:${pad2(sec)}.${String(ms).padStart(3, '0')}`;
}

function formatSrtTimestamp(s: number): string {
	return formatVttTimestamp(s).replace('.', ',');
}

export function cuesToVTT(cues: MergedCue[]): string {
	return (
		'WEBVTT\n\n' +
		cues
			.map(
				(c) =>
					`${formatVttTimestamp(c.start)} --> ${formatVttTimestamp(c.end)}\n${wrapSubtitleText(c.text).join('\n')}`,
			)
			.join('\n\n') +
		'\n'
	);
}

export function cuesToSRT(cues: MergedCue[]): string {
	return (
		cues
			.map(
				(c, i) =>
					`${i + 1}\n${formatSrtTimestamp(c.start)} --> ${formatSrtTimestamp(c.end)}\n${wrapSubtitleText(c.text).join('\n')}`,
			)
			.join('\n\n') + '\n'
	);
}

/**
 * Normalize a YouTube word-timed subtitle file. Returns the rewritten content,
 * or null when the file is not a YouTube word-timed caption (left untouched).
 */
export function normalizeYouTubeSubtitles(content: string, format: 'vtt' | 'srt'): string | null {
	if (!isYouTubeWordTimed(content)) return null;
	const words = extractWordStream(parseSubtitleCues(content));
	if (words.length === 0) return null;
	const cues = buildCues(words);
	if (cues.length === 0) return null;
	return format === 'srt' ? cuesToSRT(cues) : cuesToVTT(cues);
}
