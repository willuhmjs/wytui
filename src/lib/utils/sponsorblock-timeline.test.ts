import { describe, it, expect } from 'vitest';
import { mapSegmentsToCutTimeline } from './sponsorblock-timeline';

type Seg = { segment: [number, number]; category: string; UUID: string };
const seg = (start: number, end: number, category: string): Seg => ({
	segment: [start, end],
	category,
	UUID: `${category}-${start}`,
});

// The real numbers from "Will My Mercedes Explode?" (q9b4Yby4BtQ): 1257s source,
// two sponsor segments removed, leaving a 1172.73s file.
const CUT = ['sponsor', 'selfpromo'];

describe('mapSegmentsToCutTimeline', () => {
	it('returns segments untouched for a file that was never cut', () => {
		const segments = [seg(0, 30, 'intro'), seg(312.44, 386.52, 'sponsor')];
		expect(mapSegmentsToCutTimeline(segments, [])).toBe(segments);
	});

	it('drops segments the cut already removed and shifts later ones onto the file timeline', () => {
		const out = mapSegmentsToCutTimeline(
			[
				seg(0, 30, 'intro'),
				seg(312.44, 386.52, 'sponsor'),
				seg(1235.92, 1246.11, 'sponsor'),
				seg(1246.11, 1257, 'outro'),
			],
			CUT,
		);
		expect(out.map((s) => s.category)).toEqual(['intro', 'outro']);
		expect(out[0].segment).toEqual([0, 30]);
		// Outro starts 84.27s into the removed total.
		expect(out[1].segment[0]).toBeCloseTo(1161.84, 2);
		expect(out[1].segment[1]).toBeCloseTo(1172.73, 2);
	});

	it('keeps the part of a segment that survived the cut', () => {
		const out = mapSegmentsToCutTimeline(
			[seg(312.44, 386.52, 'sponsor'), seg(300, 320, 'interaction')],
			CUT,
		);
		expect(out.map((s) => s.category)).toEqual(['interaction']);
		expect(out[0].segment[0]).toBeCloseTo(300, 3);
		// 320 - (320 - 312.44) removed seconds = the cut boundary in file time.
		expect(out[0].segment[1]).toBeCloseTo(312.44, 2);
	});

	it('drops a segment that fell entirely inside a removed range', () => {
		const out = mapSegmentsToCutTimeline(
			[seg(312.44, 386.52, 'sponsor'), seg(385, 386, 'interaction')],
			CUT,
		);
		expect(out).toEqual([]);
	});

	it('counts overlapping removals once', () => {
		const out = mapSegmentsToCutTimeline(
			[seg(100, 200, 'sponsor'), seg(150, 250, 'sponsor'), seg(300, 310, 'outro')],
			CUT,
		);
		expect(out).toHaveLength(1);
		expect(out[0].segment).toEqual([150, 160]);
	});

	it('treats "all" as every category being cut', () => {
		const out = mapSegmentsToCutTimeline([seg(0, 30, 'intro'), seg(60, 90, 'outro')], ['all']);
		expect(out).toEqual([]);
	});

	it('preserves extra segment fields', () => {
		const out = mapSegmentsToCutTimeline([seg(0, 30, 'intro')], CUT);
		expect(out[0].UUID).toBe('intro-0');
	});
});
