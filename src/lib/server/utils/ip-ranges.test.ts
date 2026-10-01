import { describe, it, expect } from 'vitest';
import { parseAddress, parseNumericHost, isPrivateOrSpecialAddress } from './ip-ranges';

describe('parseAddress', () => {
	it('parses IPv4 and reports its ranges', () => {
		const loopback = parseAddress('127.0.0.1');
		expect(loopback?.family).toBe('ipv4');
		expect(loopback?.loopback).toBe(true);
		expect(loopback?.privateRange).toBe(false);

		expect(parseAddress('10.1.2.3')?.privateRange).toBe(true);
		expect(parseAddress('172.16.0.1')?.privateRange).toBe(true);
		expect(parseAddress('172.15.255.255')?.privateRange).toBe(false);
		expect(parseAddress('192.168.4.5')?.privateRange).toBe(true);
		expect(parseAddress('100.64.0.2')?.cgnat).toBe(true);
		expect(parseAddress('100.63.255.255')?.cgnat).toBe(false);
		expect(parseAddress('100.127.0.1')?.cgnat).toBe(true);
		expect(parseAddress('100.128.0.1')?.cgnat).toBe(false);
		expect(parseAddress('169.254.169.254')?.linkLocal).toBe(true);
		expect(parseAddress('0.0.0.0')?.unspecified).toBe(true);
		expect(parseAddress('8.8.8.8')?.loopback).toBe(false);
		expect(parseAddress('203.0.113.9')?.cgnat).toBe(false);
	});

	it('parses IPv6 and sees through the v4 wrappers', () => {
		expect(parseAddress('::1')?.loopback).toBe(true);
		expect(parseAddress('::')?.unspecified).toBe(true);
		expect(parseAddress('fd12:3456::1')?.uniqueLocal).toBe(true);
		expect(parseAddress('fc00::1')?.uniqueLocal).toBe(true);
		expect(parseAddress('fe80::1')?.linkLocal).toBe(true);
		expect(parseAddress('febf::1')?.linkLocal).toBe(true);
		expect(parseAddress('fec0::1')?.ipv6SiteLocal).toBe(true);
		expect(parseAddress('2001:4860:4860::8888')?.loopback).toBe(false);

		// The two spellings of "this IPv6 address wraps an IPv4 address" — dotted
		// and hex-folded (Node's URL parser emits the latter).
		expect(parseAddress('[::ffff:127.0.0.1]')?.loopback).toBe(true);
		expect(parseAddress('::ffff:7f00:1')?.loopback).toBe(true);
		expect(parseAddress('::ffff:10.0.0.1')?.privateRange).toBe(true);
		expect(parseAddress('::ffff:169.254.169.254')?.linkLocal).toBe(true);
		// Deprecated IPv4-compatible spelling, same wrapper minus the ffff.
		expect(parseAddress('::169.254.169.254')?.linkLocal).toBe(true);
	});

	it('normalizes brackets, zone ids and case', () => {
		expect(parseAddress('[FE80::1%eth0]')?.linkLocal).toBe(true);
		expect(parseAddress(' 127.0.0.1 ')?.loopback).toBe(true);
	});

	it('returns null for anything that is not an address', () => {
		for (const bad of ['', 'example.com', 'localhost', '300.1.1.1', '1.2.3', 'gg::zz', '1::2::3']) {
			expect(parseAddress(bad), bad).toBeNull();
		}
	});
});

describe('parseNumericHost', () => {
	it('folds the non-dotted IPv4 spellings to dotted-quad', () => {
		const cases: Array<[string, string]> = [
			['2130706433', '127.0.0.1'], // decimal
			['0x7f000001', '127.0.0.1'], // hex
			['017700000001', '127.0.0.1'], // octal
			['127.1', '127.0.0.1'], // two-part fold
			['0x7f.1', '127.0.0.1'], // hex part + fold
			['10.7.1', '10.7.0.1'], // class-C form: the last part fills two octets
			['127.0.0.1', '127.0.0.1'], // already canonical
			['127.0.0.1.', '127.0.0.1'], // trailing root label
		];
		for (const [input, want] of cases) expect(parseNumericHost(input), input).toBe(want);
	});

	it('rejects out-of-range and non-numeric hosts', () => {
		for (const bad of [
			'99999999999999', // > 32 bits
			'1.2.3.4.5', // too many parts
			'0x7fffffff00', // > 32 bits (hex)
			'127.0.0.1.evil.com', // a hostname, not a literal
			'localhost',
			'::1', // IPv6 is parseAddress's job
			'',
			'.1',
		]) {
			expect(parseNumericHost(bad), bad).toBeNull();
		}
	});
});

describe('isPrivateOrSpecialAddress', () => {
	// The trusted-proxy predicate moved here from rate-limit.ts, so the set it
	// accepts has to be exactly what it accepted before.
	it('matches the ranges the trusted-proxy check relies on', () => {
		const trusted = [
			'127.0.0.1',
			'::1',
			'::ffff:127.0.0.1',
			'10.1.2.3',
			'172.16.0.1',
			'172.31.255.255',
			'192.168.4.5',
			'100.64.0.2',
			'100.127.255.255',
			'fd12:3456::1',
			'fe80::1',
			'169.254.1.1',
		];
		const untrusted = [
			'203.0.113.9',
			'8.8.8.8',
			'172.15.0.1',
			'100.63.0.1',
			'100.128.0.1',
			'0.0.0.0',
			'example.com',
			'',
		];
		for (const ip of trusted) expect(isPrivateOrSpecialAddress(ip), ip).toBe(true);
		for (const ip of untrusted) expect(isPrivateOrSpecialAddress(ip), ip).toBe(false);
	});
});
