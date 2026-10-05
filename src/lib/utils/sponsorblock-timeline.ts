/**
 * SponsorBlock segments come back from the API in YouTube's timeline. Downloads
 * made with `--sponsorblock-remove` had those ranges physically cut out of the
 * media, so their file timeline is shorter than YouTube's and every segment
 * after a cut points at the wrong content.
 */
export interface SbSegmentLike {
	segment: [number, number];
	category: string;
}

/** Segments shorter than this after remapping are not worth a skip. */
const MIN_SEGMENT_SECONDS = 0.5;

/**
 * Map segments onto the shortened timeline of a cut file, dropping the segments
 * the cut already deleted (skipping them again would eat real content).
 *
 * The cut ranges are reconstructed from the segments of the removed categories,
 * which is only an approximation for legacy files: the database may have voted
 * those segments since the download. Mark-only downloads (the default) pass an
 * empty `removedCategories` and get their segments back untouched.
 */
export function mapSegmentsToCutTimeline<T extends SbSegmentLike>(
	segments: T[],
	removedCategories: string[],
): T[] {
	if (removedCategories.length === 0) return segments;
	const cutEverything = removedCategories.includes('all');
	const wasCut = (category: string) => cutEverything || removedCategories.includes(category);

	const cuts: { start: number; end: number }[] = [];
	for (const s of segments) {
		if (!wasCut(s.category) || s.segment[1] <= s.segment[0]) continue;
		cuts.push({ start: s.segment[0], end: s.segment[1] });
	}
	cuts.sort((a, b) => a.start - b.start);

	// Overlapping submissions must not remove the same seconds twice.
	const merged: { start: number; end: number }[] = [];
	for (const c of cuts) {
		const last = merged[merged.length - 1];
		if (last && c.start <= last.end) last.end = Math.max(last.end, c.end);
		else merged.push(c);
	}

	const removedBefore = (t: number) => {
		let removed = 0;
		for (const c of merged) {
			if (c.end <= t) removed += c.end - c.start;
			else if (c.start < t) removed += t - c.start;
			else break;
		}
		return removed;
	};

	const mapped: T[] = [];
	for (const s of segments) {
		if (wasCut(s.category)) continue;
		const segment: [number, number] = [
			s.segment[0] - removedBefore(s.segment[0]),
			s.segment[1] - removedBefore(s.segment[1]),
		];
		if (segment[1] - segment[0] < MIN_SEGMENT_SECONDS) continue;
		mapped.push({ ...s, segment });
	}
	return mapped;
}
