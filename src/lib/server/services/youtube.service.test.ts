import { describe, it, expect } from 'vitest';
import { parseFlatEntries } from './youtube.service';

const flat = JSON.stringify({
	entries: [
		{
			id: 'vid1',
			title: 'First',
			url: 'https://youtu.be/vid1',
			uploader: 'Chan A',
			channel_id: 'UC1',
		},
		{ id: 'vid2', title: 'Second', channel_id: 'UC2' },
		{ nope: true }, // malformed entry, should be skipped
	],
});

describe('parseFlatEntries', () => {
	it('maps yt-dlp flat entries and skips malformed ones', () => {
		const out = parseFlatEntries(flat);
		expect(out).toHaveLength(2);
		expect(out[0]).toMatchObject({
			id: 'vid1',
			title: 'First',
			uploader: 'Chan A',
			channelId: 'UC1',
		});
		expect(out[1].url).toContain('vid2'); // url synthesized from id when absent
	});
	it('returns [] on non-JSON', () => {
		expect(parseFlatEntries('not json')).toEqual([]);
	});
});
