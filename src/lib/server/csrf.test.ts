import { describe, it, expect } from 'vitest';
import { isCsrfExempt, isExtensionAllowedPath, isExtensionCsrfExemptPath } from './csrf';

const EXT_ORIGIN = 'chrome-extension://mmllabcfgpjnfefkjidlkdjhdflphabc';

function req(method: string, path: string, headers: Record<string, string> = {}): Request {
	return new Request(`https://wytui.example${path}`, { method, headers });
}

describe('isCsrfExempt: safe methods and Bearer auth', () => {
	it('exempts safe methods', () => {
		for (const method of ['GET', 'HEAD', 'OPTIONS']) {
			expect(isCsrfExempt(req(method, '/api/youtube/link')), method).toBe(true);
		}
	});

	it('exempts any Bearer-key request regardless of Origin', () => {
		// An API key cannot be attached to a request another page initiated, so
		// these are not CSRF-able and need no path list at all.
		expect(
			isCsrfExempt(
				req('POST', '/api/youtube/link', { authorization: 'Bearer wytui_abc', origin: EXT_ORIGIN }),
			),
		).toBe(true);
		expect(
			isCsrfExempt(req('DELETE', '/api/downloads/7', { authorization: 'Bearer wytui_abc' })),
		).toBe(true);
	});

	it('requires the token from a same-site or unrelated caller', () => {
		expect(isCsrfExempt(req('POST', '/api/youtube/link'))).toBe(false);
		expect(isCsrfExempt(req('POST', '/api/youtube/link', { origin: 'https://evil.example' }))).toBe(
			false,
		);
	});
});

describe('isCsrfExempt: extension origins', () => {
	it('no longer exempts POST /api/youtube/link', () => {
		expect(isCsrfExempt(req('POST', '/api/youtube/link', { origin: EXT_ORIGIN }))).toBe(false);
		expect(isCsrfExempt(req('POST', '/api/youtube/link', { origin: 'moz-extension://x/' }))).toBe(
			false,
		);
	});

	it('no longer exempts DELETE /api/downloads/{id}', () => {
		expect(isCsrfExempt(req('DELETE', '/api/downloads/abc123', { origin: EXT_ORIGIN }))).toBe(
			false,
		);
	});

	it('no longer exempts the web-UI-only writes on /api/youtube/link', () => {
		expect(isCsrfExempt(req('PATCH', '/api/youtube/link', { origin: EXT_ORIGIN }))).toBe(false);
		expect(isCsrfExempt(req('DELETE', '/api/youtube/link', { origin: EXT_ORIGIN }))).toBe(false);
	});

	it('still exempts the routes the keyless extension mode depends on', () => {
		expect(isCsrfExempt(req('POST', '/api/downloads/quick', { origin: EXT_ORIGIN }))).toBe(true);
		expect(isCsrfExempt(req('POST', '/api/profiles', { origin: EXT_ORIGIN }))).toBe(true);
		expect(isCsrfExempt(req('POST', '/api/settings', { origin: EXT_ORIGIN }))).toBe(true);
	});

	it('does not extend the exemption past the listed paths', () => {
		expect(isCsrfExempt(req('POST', '/api/downloads/batch', { origin: EXT_ORIGIN }))).toBe(false);
		expect(isCsrfExempt(req('POST', '/api/users/1', { origin: EXT_ORIGIN }))).toBe(false);
	});
});

describe('CORS grant list is unchanged by the CSRF tightening', () => {
	it('still grants the extension its read access', () => {
		for (const path of [
			'/api/downloads/quick',
			'/api/downloads/abc123',
			'/api/youtube/link',
			'/api/profiles',
			'/api/settings',
			'/api/auth/me',
		]) {
			expect(isExtensionAllowedPath(path), path).toBe(true);
		}
	});

	it('grants less than it used to for state changes', () => {
		expect(isExtensionAllowedPath('/api/youtube/link')).toBe(true);
		expect(isExtensionCsrfExemptPath('/api/youtube/link')).toBe(false);
		expect(isExtensionAllowedPath('/api/downloads/abc123')).toBe(true);
		expect(isExtensionCsrfExemptPath('/api/downloads/abc123')).toBe(false);
		expect(isExtensionCsrfExemptPath('/api/settings')).toBe(true);
	});

	it('does not grant arbitrary paths', () => {
		expect(isExtensionAllowedPath('/api/auth/signout')).toBe(false);
		expect(isExtensionAllowedPath('/api/downloads/quick/extra')).toBe(false);
	});
});
