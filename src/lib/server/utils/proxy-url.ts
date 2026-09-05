/** Proxy URL schemes yt-dlp accepts for --proxy. */
const ALLOWED_PROXY_SCHEMES = ['http:', 'https:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'];

export type ProxyCheck = { ok: true; value: string | null } | { ok: false; error: string };

/**
 * Validate a user-supplied proxy URL. Empty/undefined/null clears the setting
 * (returns value null); anything else must parse as an allowed scheme.
 */
export function validateProxyUrlInput(raw: unknown): ProxyCheck {
	if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
		return { ok: true, value: null };
	}
	if (typeof raw !== 'string') {
		return { ok: false, error: 'Proxy URL must be a string' };
	}
	const proxy = raw.trim();
	let scheme: string | null = null;
	try {
		scheme = new URL(proxy).protocol;
	} catch {
		// fall through to the scheme error below
	}
	if (!scheme || !ALLOWED_PROXY_SCHEMES.includes(scheme)) {
		return {
			ok: false,
			error: 'must be a valid http(s)/socks4/socks5/socks5h proxy URL (e.g. "socks5://host:port")',
		};
	}
	return { ok: true, value: proxy };
}

/** aria2c only understands HTTP proxies; SOCKS URLs break every download. */
export function isSocksProxy(proxyUrl?: string | null): boolean {
	return !!proxyUrl && proxyUrl.trim().toLowerCase().startsWith('socks');
}
