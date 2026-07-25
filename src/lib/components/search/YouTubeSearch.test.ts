import { describe, it, expect } from 'vitest';

/**
 * Deduplicates search results by id when appending a new page.
 * Extracted from YouTubeSearch.svelte:loadMore() for testability.
 */
function dedupeResults(existing: any[], incoming: any[]): any[] {
	const seen = new Set(existing.map((r) => r.id));
	return incoming.filter((r) => !seen.has(r.id));
}

describe('YouTubeSearch pagination', () => {
	it('dedupes overlapping ids when appending a page', () => {
		const page1 = [
			{ id: 'a', title: 'Video A' },
			{ id: 'b', title: 'Video B' },
			{ id: 'c', title: 'Video C' },
		];
		const page2 = [
			{ id: 'b', title: 'Video B (duplicate)' },
			{ id: 'c', title: 'Video C (duplicate)' },
			{ id: 'd', title: 'Video D' },
			{ id: 'e', title: 'Video E' },
		];

		const newResults = dedupeResults(page1, page2);
		expect(newResults).toHaveLength(2);
		expect(newResults.map((r) => r.id)).toEqual(['d', 'e']);
	});

	it('appends all results when there are no duplicates', () => {
		const page1 = [
			{ id: 'a', title: 'Video A' },
			{ id: 'b', title: 'Video B' },
		];
		const page2 = [
			{ id: 'c', title: 'Video C' },
			{ id: 'd', title: 'Video D' },
		];

		const newResults = dedupeResults(page1, page2);
		expect(newResults).toHaveLength(2);
		expect(newResults).toEqual(page2);
	});

	it('returns empty array when all incoming results are duplicates', () => {
		const page1 = [
			{ id: 'a', title: 'Video A' },
			{ id: 'b', title: 'Video B' },
		];
		const page2 = [
			{ id: 'a', title: 'Video A (dup)' },
			{ id: 'b', title: 'Video B (dup)' },
		];

		const newResults = dedupeResults(page1, page2);
		expect(newResults).toHaveLength(0);
	});
});
