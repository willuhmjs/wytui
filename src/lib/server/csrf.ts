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
// of routes the wytui extension actually calls in its cookie-fallback (no API
// key configured) mode, rather than exempting extension origins app-wide.
const EXTENSION_ALLOWED_PATHS: RegExp[] = [
	/^\/api\/downloads\/quick$/,
	/^\/api\/downloads\/(?!quick$|batch$|refresh$)[^/]+$/,
	/^\/api\/youtube\/link$/,
	/^\/api\/profiles$/,
	/^\/api\/settings$/,
	/^\/api\/auth\/me$/,
];

export function isExtensionAllowedPath(pathname: string): boolean {
	return EXTENSION_ALLOWED_PATHS.some((pattern) => pattern.test(pathname));
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

	// Browser extension origins are trusted, but only for the routes the
	// extension is designed to call (see isExtensionAllowedPath above) — not
	// app-wide, since the Origin header can't be tied to a specific extension.
	const origin = request.headers.get('origin');
	const isExtensionOrigin =
		origin && /^(chrome-extension|moz-extension|safari-web-extension):\/\//.test(origin);
	if (isExtensionOrigin) {
		const pathname = new URL(request.url).pathname;
		return isExtensionAllowedPath(pathname);
	}

	return false;
}
