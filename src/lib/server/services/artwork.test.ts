import { describe, it, expect } from 'vitest';
import { buildPosterFilterArgs } from './artwork';

describe('buildPosterFilterArgs', () => {
	it('produces a 2:3 blurred-fill ffmpeg command', () => {
		const args = buildPosterFilterArgs('/tmp/src.jpg', '/tmp/poster.jpg');
		expect(args[1]).toBe('-i');
		expect(args[2]).toBe('/tmp/src.jpg');
		expect(args).toContain('-filter_complex');
		const fc = args[args.indexOf('-filter_complex') + 1];
		expect(fc).toContain('1000:1500'); // 2:3 canvas
		expect(fc).toContain('boxblur');
		expect(fc).toContain('overlay');
		expect(args[args.length - 1]).toBe('/tmp/poster.jpg');
		expect(args).toContain('-frames:v');
	});
});
