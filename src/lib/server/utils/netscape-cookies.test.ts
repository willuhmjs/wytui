import { describe, it, expect } from 'vitest';
import { cookiesToNetscape, looksLikeYouTubeAuth } from './netscape-cookies';

const sample = [
	{
		domain: '.youtube.com',
		name: 'SAPISID',
		value: 'abc',
		path: '/',
		secure: true,
		expirationDate: 9999999999,
	},
	{ domain: '.youtube.com', name: 'SID', value: 'def', path: '/', secure: true },
];

describe('cookiesToNetscape', () => {
	it('emits the Netscape header', () => {
		expect(cookiesToNetscape(sample)).toContain('# Netscape HTTP Cookie File');
	});
	it('emits a TAB-separated line per cookie with 7 fields', () => {
		const line = cookiesToNetscape(sample)
			.split('\n')
			.find((l) => l.includes('SAPISID'))!;
		expect(line.split('\t')).toHaveLength(7);
		expect(line.split('\t')[5]).toBe('SAPISID');
		expect(line.split('\t')[6]).toBe('abc');
	});
	it('defaults missing expiry to 0', () => {
		const line = cookiesToNetscape(sample)
			.split('\n')
			.find((l) => l.includes('\tSID\t'))!;
		expect(line.split('\t')[4]).toBe('0');
	});
});

describe('looksLikeYouTubeAuth', () => {
	it('true when SAPISID present', () => expect(looksLikeYouTubeAuth(sample)).toBe(true));
	it('false when no auth cookies', () =>
		expect(looksLikeYouTubeAuth([{ domain: '.youtube.com', name: 'PREF', value: 'x' }])).toBe(
			false,
		));
});
