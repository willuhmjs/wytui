import { describe, it, expect } from 'vitest';
import { ffmpegPercent } from './download-progress';

describe('ffmpegPercent', () => {
	it('computes a clamped percent when duration is known', () => {
		expect(ffmpegPercent(30, 60)).toBe(50);
		expect(ffmpegPercent(120, 60)).toBe(100); // clamp
	});
	it('returns null when duration is unknown', () => {
		expect(ffmpegPercent(30, undefined)).toBeNull();
		expect(ffmpegPercent(30, 0)).toBeNull();
	});
});
