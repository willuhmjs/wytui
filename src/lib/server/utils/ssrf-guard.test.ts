import { describe, it, expect, vi } from 'vitest';
import { checkUrlHost, describeUrlHostCheck, classifyHostLiteral } from './ssrf-guard';

// Injected resolver: vi.mock of node:dns does not intercept the import under this vitest version.
const resolverReturning = (...addresses: string[]) => vi.fn(async () => addresses);
const failingResolver = vi.fn(async () => {
	throw Object.assign(new Error('queryA ENOTFOUND'), { code: 'ENOTFOUND' });
});

describe('checkUrlHost: literal IP forms', () => {
	const blocked: Array<[string, string]> = [
		['http://127.0.0.1/video', 'loopback'],
		['http://127.0.0.1:8080/video', 'loopback'],
		['http://127.1/video', 'loopback'],
		['http://2130706433/video', 'loopback'], // decimal
		['http://0x7f000001/video', 'loopback'], // hex
		['http://0177.0.0.1/video', 'loopback'], // octal
		['http://127.255.255.254/video', 'loopback'], // the whole /8, not just .1
		['http://[::1]/video', 'loopback'],
		['http://[::ffff:127.0.0.1]/video', 'loopback'],
		['http://0.0.0.0/video', 'unspecified'],
		['http://[::]/video', 'unspecified'],
		['http://169.254.169.254/latest/meta-data', 'link-local'], // cloud metadata
		['http://169.254.1.1/video', 'link-local'],
		['http://[fe80::1]/video', 'link-local'],
		['http://100.64.0.1/video', 'cgnat'], // Tailscale / RFC6598
		['http://100.127.255.255/video', 'cgnat'],
		['http://[fec0::1]/video', 'reserved'],
	];

	for (const [url, blockedClass] of blocked) {
		it(`blocks ${url} as ${blockedClass}`, async () => {
			const check = await checkUrlHost(url, resolverReturning('203.0.113.9'));
			expect(check).toMatchObject({ ok: false, reason: 'blocked', blocked: blockedClass });
		});
	}

	const allowed = [
		'https://www.youtube.com/watch?v=abc',
		'http://10.0.0.50/video', // RFC1918 stays allowed by owner policy
		'http://172.20.3.4/video',
		'http://192.168.1.60:8080/video',
		'http://[fd12:3456::1]/video',
		'http://100.63.0.1/video', // just below CGNAT
		'http://100.128.0.1/video', // just above it
		'http://169.253.0.1/video', // just below link-local
	];

	for (const url of allowed) {
		it(`allows ${url}`, async () => {
			expect(await checkUrlHost(url, resolverReturning('203.0.113.9'))).toEqual({ ok: true });
		});
	}

	it('never echoes the address back in the message', async () => {
		const check = await checkUrlHost('http://169.254.169.254/latest/meta-data', failingResolver);
		if (check.ok) throw new Error('expected the metadata address to be blocked');
		const message = describeUrlHostCheck(check);
		expect(message).toContain('link-local');
		expect(message).not.toContain('169.254.169.254');
	});
});

describe('checkUrlHost: resolved names', () => {
	it('blocks a name that resolves to loopback (127.0.0.1.evil.com case)', async () => {
		const resolve = resolverReturning('127.0.0.1');
		const check = await checkUrlHost('http://127.0.0.1.evil.com/video', resolve);
		expect(check).toMatchObject({ ok: false, blocked: 'loopback' });
		expect(resolve).toHaveBeenCalledWith('127.0.0.1.evil.com');
	});

	it('blocks a name whose only public answer sits next to a metadata address', async () => {
		const check = await checkUrlHost(
			'https://attacker.example/video',
			resolverReturning('203.0.113.9', '169.254.169.254'),
		);
		expect(check).toMatchObject({ ok: false, blocked: 'link-local' });
	});

	it('blocks an AAAA-only name pointing at loopback', async () => {
		const check = await checkUrlHost('https://attacker.example/video', resolverReturning('::1'));
		expect(check).toMatchObject({ ok: false, blocked: 'loopback' });
	});

	it('allows a name that resolves to a public or LAN address', async () => {
		expect(await checkUrlHost('https://x.example', resolverReturning('142.250.0.1'))).toEqual({
			ok: true,
		});
		expect(await checkUrlHost('https://nas.internal', resolverReturning('192.168.1.20'))).toEqual({
			ok: true,
		});
	});

	it('does not resolve when the host is already an IP literal', async () => {
		const resolve = resolverReturning('203.0.113.9');
		await checkUrlHost('http://192.168.1.20/video', resolve);
		expect(resolve).not.toHaveBeenCalled();
	});

	it('fails open when the name does not resolve', async () => {
		expect(await checkUrlHost('https://nope.invalid/video', failingResolver)).toEqual({ ok: true });
	});

	it('rejects malformed URLs and non-http schemes', async () => {
		for (const bad of ['not a url', 'file:///etc/passwd', 'gopher://127.0.0.1:11211/', '']) {
			expect(await checkUrlHost(bad, failingResolver), bad).toMatchObject({
				ok: false,
				reason: 'invalid_url',
			});
		}
		expect(await checkUrlHost(undefined, failingResolver)).toMatchObject({
			ok: false,
			reason: 'invalid_url',
		});
	});
});

describe('classifyHostLiteral', () => {
	it('ignores names and empty input', () => {
		expect(classifyHostLiteral('localhost')).toBeNull();
		expect(classifyHostLiteral('127.0.0.1.evil.com')).toBeNull();
		expect(classifyHostLiteral('')).toBeNull();
	});

	it('catches the literal forms without a URL wrapper', () => {
		expect(classifyHostLiteral('[::1]')).toBe('loopback');
		expect(classifyHostLiteral('2130706433')).toBe('loopback');
		expect(classifyHostLiteral('100.64.0.1')).toBe('cgnat');
		expect(classifyHostLiteral('8.8.8.8')).toBeNull();
	});
});
