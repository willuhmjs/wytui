import { describe, it, expect } from 'vitest';
import { newVideoIds } from './feed-diff';

describe('newVideoIds', () => {
	it('returns only unseen ids, de-duplicated, order preserved', () => {
		const feed = [{ id: 'a' }, { id: 'b' }, { id: 'a' }, { id: 'c' }];
		expect(newVideoIds(feed, new Set(['b']))).toEqual(['a', 'c']);
	});
	it('returns [] when all seen', () => {
		expect(newVideoIds([{ id: 'a' }], new Set(['a']))).toEqual([]);
	});
});
