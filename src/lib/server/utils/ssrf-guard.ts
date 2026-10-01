import { lookup } from 'node:dns/promises';
import { parseAddress, parseNumericHost } from './ip-ranges';

/** Blocks loopback, link-local (cloud metadata), CGNAT and 0/8 in user URLs; RFC1918 is allowed on purpose for self-hosted installs. */

export type BlockedClass = 'loopback' | 'link-local' | 'cgnat' | 'unspecified' | 'reserved';

export type UrlHostCheck =
	| { ok: true }
	| { ok: false; reason: 'invalid_url' }
	| { ok: false; reason: 'blocked'; blocked: BlockedClass };

export type HostResolver = (hostname: string) => Promise<string[]>;

const BLOCKED_MESSAGES: Record<BlockedClass, string> = {
	loopback: 'URL host is a loopback address',
	'link-local':
		'URL host is a link-local address (link-local ranges include cloud metadata endpoints)',
	cgnat: 'URL host is in the CGNAT range (100.64.0.0/10)',
	unspecified: 'URL host is a "this network" address',
	reserved: 'URL host is in a reserved address range',
};

/** The message a route should return. Never contains the resolved address. */
export function describeUrlHostCheck(check: Exclude<UrlHostCheck, { ok: true }>): string {
	return check.reason === 'invalid_url'
		? 'Invalid URL format'
		: `${BLOCKED_MESSAGES[check.blocked]}. Configure the download on that host directly instead.`;
}

function classOfAddress(raw: string): BlockedClass | null {
	const addr = parseAddress(raw);
	if (!addr) return null;
	if (addr.loopback) return 'loopback';
	if (addr.linkLocal) return 'link-local';
	if (addr.cgnat) return 'cgnat';
	if (addr.unspecified) return 'unspecified';
	if (addr.ipv6SiteLocal) return 'reserved';
	return null;
}

/** Block class for a host string with no DNS, normalizing the non-dotted IPv4 spellings; null for a hostname. */
export function classifyHostLiteral(host: string): BlockedClass | null {
	const bare = host
		.trim()
		.replace(/^\[|\]$/g, '')
		.toLowerCase();
	if (!bare) return null;
	const direct = classOfAddress(bare);
	if (direct) return direct;
	if (!/^[0-9a-fx.%:]+$/i.test(bare)) return null;
	const dotted = parseNumericHost(bare);
	return dotted ? classOfAddress(dotted) : null;
}

const systemResolver: HostResolver = async (hostname) => {
	const rows = await lookup(hostname, { all: true, verbatim: true });
	return rows.map((row) => row.address);
};

/** Check a user-supplied URL against the block list, resolving the hostname when it is not an IP literal. */
export async function checkUrlHost(
	rawUrl: unknown,
	resolve: HostResolver = systemResolver,
): Promise<UrlHostCheck> {
	if (typeof rawUrl !== 'string' || !rawUrl.trim()) return { ok: false, reason: 'invalid_url' };

	let parsed: URL;
	try {
		parsed = new URL(rawUrl.trim());
	} catch {
		return { ok: false, reason: 'invalid_url' };
	}
	// The guard is about where a fetch lands; anything but http(s) is the
	// routes' protocol check, and `file:`/`gopher:` must not slip through here.
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		return { ok: false, reason: 'invalid_url' };
	}

	// WHATWG URL already folds decimal/hex/octal hosts to dotted-quad; classifyHostLiteral normalizes again so callers need not pre-parse.
	const host = parsed.hostname;
	const literal = classifyHostLiteral(host);
	if (literal) return { ok: false, reason: 'blocked', blocked: literal };
	if (parseAddress(host)) return { ok: true }; // an IP literal the policy allows

	let addresses: string[];
	try {
		addresses = await resolve(host);
	} catch {
		// Fail open on a DNS error on purpose: an unresolvable name is the user's error, not a block.
		return { ok: true };
	}
	for (const address of addresses) {
		const blocked = classOfAddress(address);
		if (blocked) return { ok: false, reason: 'blocked', blocked };
	}
	return { ok: true };
}
