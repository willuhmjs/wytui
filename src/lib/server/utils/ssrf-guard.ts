import { lookup } from 'node:dns/promises';
import { parseAddress, parseNumericHost } from './ip-ranges';

/**
 * Conservative SSRF guard for user-supplied URLs.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS — AND WHAT IT IS NOT
 * ═══════════════════════════════════════════════════════════════════════════
 * This raises the cost of pointing the server at an address it should not
 * reach. It is NOT a security boundary, for two reasons that cannot be fixed
 * here:
 *
 *  1. TOCTOU / rebinding. We resolve the hostname and check the answers, then
 *     hand the *URL* to yt-dlp, which resolves it again itself. A name with a
 *     short TTL (or one that alternates answers) can pass our check on the
 *     first lookup and resolve to 127.0.0.1 on yt-dlp's. Re-checking is not an
 *     option: we do not perform the fetch, yt-dlp does, and there is no way to
 *     pin its resolver to the address we approved (nor to make the redirect
 *     chain it follows re-enter this guard). Closing this properly needs a
 *     enforcing egress proxy or network policy, not application code.
 *
 *  2. Proxy. When a proxy is configured — `settings.ytdlpProxyUrl` globally or
 *     the per-account `youTubeLink.proxyUrl` — the *proxy* resolves the
 *     hostname, so our local lookup says nothing about where the request
 *     actually goes. A caller who controls that proxy can reach anything it can.
 *     The guard still runs (it is cheap and it stops accidents), but under a
 *     proxy it is best-effort only.
 *
 * Owner policy for the blocked set: loopback, link-local (including the
 * 169.254.169.254 cloud metadata endpoint), CGNAT 100.64.0.0/10 and the
 * "this network" 0/8 — the SAME ranges `isTrustedProxyAddress` treats as
 * internal, reused from `ip-ranges.ts` rather than re-typed. Everything else is
 * allowed, deliberately including the RFC1918 ranges (10/8, 172.16/12,
 * 192.168/16) and fc00::/7: self-hosters legitimately pull from LAN hosts, and
 * blocking those would break the common case to close a case the operator
 * already controls.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type BlockedClass = 'loopback' | 'link-local' | 'cgnat' | 'unspecified' | 'reserved';

export type UrlHostCheck =
	| { ok: true }
	| { ok: false; reason: 'invalid_url' }
	| { ok: false; reason: 'blocked'; blocked: BlockedClass };

/** Resolves a hostname to every address it answers with. Injectable for tests. */
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

/** The block class an address falls in, or null when the policy allows it. */
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

/**
 * Block class for a URL *host string* with no DNS: the literal-IP forms, after
 * normalizing the ways of writing an IPv4 address that a plain string compare
 * would miss (`2130706433`, `0x7f000001`, `127.1`, `[::1]`, `::ffff:127.0.0.1`).
 * Null for a hostname — those are handled by resolving.
 */
export function classifyHostLiteral(host: string): BlockedClass | null {
	const bare = host
		.trim()
		.replace(/^\[|\]$/g, '')
		.toLowerCase();
	if (!bare) return null;
	const direct = classOfAddress(bare);
	if (direct) return direct;
	// Only worth trying when the host is numeric-ish; a name is not a literal.
	if (!/^[0-9a-fx.%:]+$/i.test(bare)) return null;
	const dotted = parseNumericHost(bare);
	return dotted ? classOfAddress(dotted) : null;
}

const systemResolver: HostResolver = async (hostname) => {
	const rows = await lookup(hostname, { all: true, verbatim: true });
	return rows.map((row) => row.address);
};

/**
 * Check a user-supplied URL against the block list, resolving the hostname when
 * it is not an IP literal.
 *
 * `resolve` is injectable so the table of forms can be tested without DNS; every
 * route uses the default (real) resolver.
 */
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

	// WHATWG URL already folds decimal/hex/octal IPv4 hosts into dotted-quad form
	// and keeps IPv6 in brackets; classifyHostLiteral normalizes again on top of
	// that so the check does not depend on the caller pre-parsing the URL.
	const host = parsed.hostname;
	const literal = classifyHostLiteral(host);
	if (literal) return { ok: false, reason: 'blocked', blocked: literal };
	if (parseAddress(host)) return { ok: true }; // an IP literal the policy allows

	let addresses: string[];
	try {
		addresses = await resolve(host);
	} catch {
		// Fail-open on lookup failure. A name that does not resolve is the normal
		// user error (yt-dlp will report it better than we can), and a guard that
		// failed closed here would break every host with a partial DNS record set.
		// This is the same "raised cost, not a boundary" caveat as the TOCTOU one.
		return { ok: true };
	}
	for (const address of addresses) {
		const blocked = classOfAddress(address);
		if (blocked) return { ok: false, reason: 'blocked', blocked };
	}
	return { ok: true };
}
