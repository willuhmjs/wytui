/** Shared address parsing for the trusted-proxy check (rate-limit.ts) and the SSRF guard — do not duplicate the range table. */

export type IPv4Parts = readonly [number, number, number, number];

export interface ParsedAddress {
	/** Normalized text: brackets and IPv6 zone id removed, lower-cased. */
	text: string;
	family: 'ipv4' | 'ipv6';
	/** The IPv4 address meant, through the v4-mapped/v4-compatible wrappers — Node gives `::ffff:a.b.c.d` for an IPv4 peer on a dual-stack socket. */
	v4: IPv4Parts | null;
	/** 127.0.0.0/8, ::1 */
	loopback: boolean;
	/** 169.254.0.0/16 (incl. the 169.254.169.254 cloud metadata endpoint), fe80::/12 */
	linkLocal: boolean;
	/** 100.64.0.0/10 (RFC6598 CGNAT — what Tailscale hands out) */
	cgnat: boolean;
	/** 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7 */
	privateRange: boolean;
	/** fc00::/7 (IPv6 unique-local — the IPv6 half of the private ranges) */
	uniqueLocal: boolean;
	/** 0.0.0.0/8 ("this network", routes to the local host), :: */
	unspecified: boolean;
	/** fec0::/10 — deprecated IPv6 site-local, never routable, kept separate from link-local */
	ipv6SiteLocal: boolean;
}

function stripToAddress(raw: string): string {
	return raw
		.trim()
		.replace(/^\[/, '')
		.replace(/\]$/, '')
		.split('%')[0] // drop an IPv6 zone id (fe80::1%eth0)
		.toLowerCase();
}

function flagsForV4(
	parts: IPv4Parts,
): Pick<
	ParsedAddress,
	| 'loopback'
	| 'linkLocal'
	| 'cgnat'
	| 'privateRange'
	| 'unspecified'
	| 'ipv6SiteLocal'
	| 'uniqueLocal'
> {
	const [a, b] = parts;
	return {
		loopback: a === 127,
		linkLocal: a === 169 && b === 254,
		cgnat: a === 100 && b >= 64 && b <= 127,
		privateRange: a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168),
		uniqueLocal: false,
		// RFC1122 "this host on this network": Linux routes 0/8 to the local
		// host, so it belongs with loopback for a fetch guard.
		unspecified: a === 0,
		ipv6SiteLocal: false,
	};
}

/** Strict dotted quad. Leading zeros are tolerated. */
function parseIpv4(text: string): IPv4Parts | null {
	if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return null;
	const parts = text.split('.').map(Number);
	if (parts.some((n) => n > 255)) return null;
	return [parts[0], parts[1], parts[2], parts[3]] as IPv4Parts;
}

function parseIpv6(text: string): ParsedAddress | null {
	if (!text.includes(':')) return null;
	if (!/^[0-9a-f:.]+$/.test(text)) return null;

	// A dotted-quad tail (::ffff:1.2.3.4) stands for two 16-bit groups; fold it into the hex form and keep it as the address meant.
	let head = text;
	let embedded: IPv4Parts | null = null;
	const lastColon = text.lastIndexOf(':');
	const tail = text.slice(lastColon + 1);
	if (tail.includes('.')) {
		embedded = parseIpv4(tail);
		if (!embedded) return null;
		head =
			text.slice(0, lastColon + 1) +
			((embedded[0] << 8) | embedded[1]).toString(16) +
			':' +
			((embedded[2] << 8) | embedded[3]).toString(16);
	}

	const groups: number[] = [];
	const doubleColon = head.indexOf('::');
	if (doubleColon === -1) {
		for (const g of head.split(':')) {
			if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
			groups.push(parseInt(g, 16));
		}
		if (groups.length !== 8) return null;
	} else {
		const left = head.slice(0, doubleColon);
		const right = head.slice(doubleColon + 2);
		const leftGroups = left ? left.split(':') : [];
		const rightGroups = right ? right.split(':') : [];
		for (const g of [...leftGroups, ...rightGroups]) {
			if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
		}
		if (head.indexOf('::', doubleColon + 1) !== -1) return null; // two "::"
		const fill = 8 - leftGroups.length - rightGroups.length;
		if (fill < 0) return null;
		for (const g of leftGroups) groups.push(parseInt(g, 16));
		for (let i = 0; i < fill; i++) groups.push(0);
		for (const g of rightGroups) groups.push(parseInt(g, 16));
	}

	const bytes: number[] = [];
	for (const g of groups) {
		bytes.push((g >> 8) & 0xff, g & 0xff);
	}

	const allZero = bytes.every((b) => b === 0);
	// v4-mapped (::ffff:a.b.c.d) written in hex groups rather than dotted form.
	const v4Mapped =
		!embedded &&
		bytes.slice(0, 10).every((b) => b === 0) &&
		bytes[10] === 0xff &&
		bytes[11] === 0xff;
	const v4 =
		embedded ?? (v4Mapped ? ([bytes[12], bytes[13], bytes[14], bytes[15]] as IPv4Parts) : null);

	const v6Flags = {
		loopback: !allZero && bytes[15] === 1 && bytes.slice(0, 15).every((b) => b === 0),
		linkLocal: bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80, // fe80::/12
		cgnat: false,
		privateRange: (bytes[0] & 0xfe) === 0xfc, // fc00::/7 is the private range for IPv6
		uniqueLocal: (bytes[0] & 0xfe) === 0xfc,
		unspecified: allZero,
		ipv6SiteLocal: bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0, // fec0::/10
	};

	// An embedded IPv4 address contributes its own range flags: `::ffff:127.0.0.1`
	// is loopback even though the surrounding IPv6 syntax is not.
	const v4Flags = v4 ? flagsForV4(v4) : null;

	return {
		text,
		family: 'ipv6',
		v4,
		loopback: v6Flags.loopback || !!v4Flags?.loopback,
		linkLocal: v6Flags.linkLocal || !!v4Flags?.linkLocal,
		cgnat: !!v4Flags?.cgnat,
		privateRange: v6Flags.privateRange || !!v4Flags?.privateRange,
		uniqueLocal: v6Flags.uniqueLocal,
		unspecified: v6Flags.unspecified || !!v4Flags?.unspecified,
		ipv6SiteLocal: v6Flags.ipv6SiteLocal,
	};
}

/** Parse an IP literal; null means "not an address", which callers must not read as "allowed". */
export function parseAddress(raw: string | null | undefined): ParsedAddress | null {
	const text = stripToAddress(raw ?? '');
	if (!text) return null;
	if (text.includes(':')) return parseIpv6(text);
	const v4 = parseIpv4(text);
	if (!v4) return null;
	return { text, family: 'ipv4', v4, ...flagsForV4(v4) };
}

/** A peer we share a trusted network with, so its X-Forwarded-For can be believed: loopback, the private ranges, CGNAT and their IPv6 equivalents. */
export function isPrivateOrSpecialAddress(raw: string): boolean {
	const addr = parseAddress(raw);
	if (!addr) return false;
	return addr.loopback || addr.privateRange || addr.cgnat || addr.linkLocal || addr.uniqueLocal;
}

/** inet_aton folding: decimal/hex/octal and short folded IPv4 forms → dotted quad, as Node's URL parser and `dns.lookup` apply it. Null for a hostname (`127.0.0.1.evil.com` is caught by resolving, not here). */
export function parseNumericHost(host: string): string | null {
	const text = stripToAddress(host).replace(/\.$/, ''); // one trailing dot is a root label
	if (!text || text.includes(':')) return null;
	const parts = text.split('.');
	if (parts.length > 4) return null;

	const values: number[] = [];
	for (const part of parts) {
		if (!part) return null;
		let value: number;
		if (/^0x[0-9a-f]+$/.test(part)) value = parseInt(part, 16);
		else if (/^0[0-7]+$/.test(part)) value = parseInt(part, 8);
		else if (/^\d+$/.test(part)) value = parseInt(part, 10);
		else return null;
		if (!Number.isFinite(value)) return null;
		values.push(value);
	}

	// Every part but the last is one octet at its own byte; the last absorbs the rest (127.1 and 2130706433 both mean 127.0.0.1).
	for (let i = 0; i < values.length - 1; i++) if (values[i] > 255) return null;
	if (values[values.length - 1] > Math.pow(256, 5 - values.length) - 1) return null;

	let n = 0;
	for (let i = 0; i < values.length - 1; i++) n |= values[i] << (8 * (3 - i));
	n |= values[values.length - 1];
	if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) return null;
	return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}
