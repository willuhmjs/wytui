import { describe, it, expect } from 'vitest';
import { validateProxyUrlInput, isSocksProxy } from './proxy-url';

describe('validateProxyUrlInput', () => {
	it('accepts http and socks schemes', () => {
		expect(validateProxyUrlInput('http://proxy:8080')).toEqual({
			ok: true,
			value: 'http://proxy:8080',
		});
		expect(validateProxyUrlInput('socks5://user:pass@host:1080')).toEqual({
			ok: true,
			value: 'socks5://user:pass@host:1080',
		});
		expect(validateProxyUrlInput('socks5h://host:1080')).toEqual({
			ok: true,
			value: 'socks5h://host:1080',
		});
	});

	it('clears on empty, null, or undefined', () => {
		expect(validateProxyUrlInput('')).toEqual({ ok: true, value: null });
		expect(validateProxyUrlInput('   ')).toEqual({ ok: true, value: null });
		expect(validateProxyUrlInput(null)).toEqual({ ok: true, value: null });
		expect(validateProxyUrlInput(undefined)).toEqual({ ok: true, value: null });
	});

	it('rejects invalid URLs and schemes', () => {
		expect(validateProxyUrlInput('not a url').ok).toBe(false);
		expect(validateProxyUrlInput('ftp://host:21').ok).toBe(false);
		expect(validateProxyUrlInput('socks6://host').ok).toBe(false);
		expect(validateProxyUrlInput(42).ok).toBe(false);
	});

	it('trims surrounding whitespace', () => {
		expect(validateProxyUrlInput('  http://p:1  ')).toEqual({ ok: true, value: 'http://p:1' });
	});
});

describe('isSocksProxy', () => {
	it('detects socks schemes case-insensitively', () => {
		expect(isSocksProxy('socks5://h:1')).toBe(true);
		expect(isSocksProxy('  SOCKS5H://h:1')).toBe(true);
		expect(isSocksProxy('http://h:1')).toBe(false);
		expect(isSocksProxy(null)).toBe(false);
		expect(isSocksProxy('')).toBe(false);
	});
});
