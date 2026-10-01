import { randomBytes } from 'crypto';
import type { Cookies } from '@sveltejs/kit';

const CSRF_COOKIE_NAME = 'wytui.csrf-token';
const CSRF_HEADER_NAME = 'x-csrf-token';

/**
 * Generate or retrieve existing CSRF token for the session
 */
export function getOrCreateCsrfToken(cookies: Cookies): string {
	const existingToken = cookies.get(CSRF_COOKIE_NAME);
	if (existingToken) {
		return existingToken;
	}

	const newToken = randomBytes(32).toString('hex');
	// Only use secure cookies in production AND when not on localhost
	// This allows Docker production builds to work on http://localhost
	const isSecure =
		process.env.NODE_ENV === 'production' &&
		!(process.env.ORIGIN?.includes('localhost') || process.env.ORIGIN?.includes('127.0.0.1'));

	cookies.set(CSRF_COOKIE_NAME, newToken, {
		path: '/',
		httpOnly: true,
		secure: isSecure,
		sameSite: 'lax',
		maxAge: 60 * 60 * 24, // 24 hours
	});

	return newToken;
}

/**
 * Validate CSRF token from request
 * Returns true if valid, false otherwise
 */
export function validateCsrfToken(cookies: Cookies, request: Request): boolean {
	const cookieToken = cookies.get(CSRF_COOKIE_NAME);
	if (!cookieToken) {
		return false;
	}

	// Check token in header first (for fetch/axios requests)
	const headerToken = request.headers.get(CSRF_HEADER_NAME);
	if (headerToken) {
		return headerToken === cookieToken;
	}

	// For form submissions, check in FormData
	// This will be handled at the form action level
	return false;
}

// Extension origins can't be pinned to a fixed ID: Firefox randomises the
// moz-extension:// UUID per profile, and Chrome only assigns a stable ID once
// published to the Web Store. Since ANY installed extension with host
// permissions can spoof this Origin header, trust is scoped to the small set
// of routes the wytui extension actually calls, rather than exempting
// extension origins app-wide.
//
// Two separate lists, because the Origin header is used for two different
// decisions and they no longer want the same set:
//
//   EXTENSION_CORS_PATHS — routes an extension Origin may *read* (it gets
//     Access-Control-Allow-Origin). Needed because the extension's background
//     worker is a cross-origin caller; a path missing here breaks the extension
//     even when the request is authenticated by other means.
//
//   EXTENSION_CSRF_EXEMPT_PATHS — routes where an extension Origin may skip the
//     CSRF token check. This is the one that grants power: it lets a request
//     that carries only the victim's session cookie mutate state. It is
//     therefore the smaller set, and it deliberately excludes the two calls the
//     extension makes with a Bearer API key — a Bearer request is already exempt
//     (an attacker cannot make a cross-site request that sets that header), so
//     listing them here bought nothing but a cookie-only path to the same route.
const EXTENSION_CORS_PATHS: RegExp[] = [
	/^\/api\/downloads\/quick$/,
	/^\/api\/downloads\/(?!quick$|batch$|refresh$)[^/]+$/,
	/^\/api\/youtube\/link$/,
	/^\/api\/profiles$/,
	/^\/api\/settings$/,
	/^\/api\/auth\/me$/,
];

/**
 * Paths where a `*-extension://` Origin skips the CSRF token check.
 *
 * Not exempted (state-changing, and the wytui extension reaches them with a
 * Bearer key, which `isCsrfExempt` already handles):
 *   POST   /api/youtube/link   — now requires the API key outright (see
 *                                routes/api/youtube/link/+server.ts): a
 *                                session-cookie-only POST let any installed
 *                                extension swap in its own YouTube jar.
 *   DELETE /api/downloads/{id} — keyless fallback dropped; the web UI sends
 *                                x-csrf-token and is unaffected.
 *   PATCH/DELETE /api/youtube/link — web-UI-only calls (the extension never
 *                                issues them) that still rely on the token.
 *
 * Still exempt: /api/downloads/quick (the extension POSTs a quick download
 * there in keyless mode, carrying only the session cookie) and /api/profiles,
 * /api/settings, /api/auth/me — which the extension only ever GETs, so their
 * entries are dead weight kept for symmetry rather than need. Retiring the
 * keyless mode entirely would let this list shrink to nothing, but that is a
 * separate change to the extension.
 */
const EXTENSION_CSRF_EXEMPT_PATHS: RegExp[] = [
	/^\/api\/downloads\/quick$/,
	/^\/api\/profiles$/,
	/^\/api\/settings$/,
	/^\/api\/auth\/me$/,
];

/** Whether an extension Origin is allowed to call this path at all (CORS). */
export function isExtensionAllowedPath(pathname: string): boolean {
	return EXTENSION_CORS_PATHS.some((pattern) => pattern.test(pathname));
}

/** Whether an extension Origin skips the CSRF check for this path. */
export function isExtensionCsrfExemptPath(pathname: string): boolean {
	return EXTENSION_CSRF_EXEMPT_PATHS.some((pattern) => pattern.test(pathname));
}

/**
 * Check if request should be exempt from CSRF validation
 */
export function isCsrfExempt(request: Request): boolean {
	// GET, HEAD, OPTIONS are safe methods
	if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
		return true;
	}

	// Bearer token authentication (API keys) are exempt
	const authHeader = request.headers.get('authorization');
	if (authHeader?.startsWith('Bearer ')) {
		return true;
	}

	// Browser extension origins are trusted for CORS, but only the routes in
	// EXTENSION_CSRF_EXEMPT_PATHS may skip the token check — not app-wide, since
	// the Origin header can't be tied to a specific extension.
	const origin = request.headers.get('origin');
	const isExtensionOrigin =
		origin && /^(chrome-extension|moz-extension|safari-web-extension):\/\//.test(origin);
	if (isExtensionOrigin) {
		const pathname = new URL(request.url).pathname;
		return isExtensionCsrfExemptPath(pathname);
	}

	return false;
}
