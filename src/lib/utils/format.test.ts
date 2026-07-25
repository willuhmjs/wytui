import { describe, it, expect } from 'vitest';
import { formatCount } from './format';

describe('formatCount', () => {
	it('leaves values under 1000 alone', () => {
		expect(formatCount(0)).toBe('0');
		expect(formatCount(999)).toBe('999');
	});

	it('abbreviates thousands', () => {
		expect(formatCount(1000)).toBe('1K');
		expect(formatCount(1200)).toBe('1.2K');
		expect(formatCount(17500)).toBe('17.5K');
		expect(formatCount(999_000)).toBe('999K');
	});

	it('abbreviates millions', () => {
		expect(formatCount(1_000_000)).toBe('1M');
		expect(formatCount(2_761_758)).toBe('2.8M');
		expect(formatCount(3_542_314)).toBe('3.5M');
	});

	it('abbreviates billions', () => {
		expect(formatCount(1_500_000_000)).toBe('1.5B');
	});

	it('drops a trailing .0', () => {
		expect(formatCount(2_000_000)).toBe('2M');
		expect(formatCount(15_000)).toBe('15K');
	});
});
