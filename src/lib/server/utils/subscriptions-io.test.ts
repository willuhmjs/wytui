import { describe, it, expect } from 'vitest';
import { toOpml, toCsv, parseOpml, parseCsv } from './subscriptions-io';

const items = [
	{ name: 'Chan A', url: 'https://www.youtube.com/channel/UC1', channelId: 'UC1' },
	{ name: 'Chan, B', url: 'https://www.youtube.com/channel/UC2', channelId: 'UC2' },
];

describe('subscriptions-io', () => {
	it('OPML round-trips', () => {
		const parsed = parseOpml(toOpml(items));
		expect(parsed).toHaveLength(2);
		expect(parsed[0].url).toBe('https://www.youtube.com/channel/UC1');
	});
	it('CSV escapes commas and round-trips', () => {
		const csv = toCsv(items);
		expect(csv).toContain('"Chan, B"');
		const parsed = parseCsv(csv);
		expect(parsed[1].name).toBe('Chan, B');
		expect(parsed[1].url).toBe('https://www.youtube.com/channel/UC2');
	});
	it('parseCsv tolerates a header row', () => {
		const parsed = parseCsv('name,url\nChan A,https://x/UC1');
		expect(parsed[0]).toMatchObject({ name: 'Chan A', url: 'https://x/UC1' });
	});
});
