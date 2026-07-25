import {
	hasUsers,
	verifySessionToken,
	resolveApiKey,
	issueSessionCookie,
	hashPassword,
} from '$lib/server/auth';
import { jobScheduler } from '$lib/server/jobs/scheduler';
import { ensureDefaults } from '$lib/server/init';
import { redirect, type Handle, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { randomBytes } from 'crypto';
import { isCsrfExempt, validateCsrfToken, isExtensionAllowedPath } from '$lib/server/csrf';
import { rateLimiter, RATE_LIMITS, getClientIdentifier } from '$lib/server/rate-limit';

// Initialise database defaults and start background jobs on server startup
const initPromise = ensureDefaults()
	.then(() => jobScheduler.start())
	.catch((error) => {
		console.error('Failed to initialize:', error);
	});

// Session and protection middleware
export const handle: Handle = async ({ event, resolve }) => {
	await initPromise;

	// Rate limiting - apply before authentication
	const isApiPath = event.url.pathname.startsWith('/api/');
	if (isApiPath) {
		const clientId = getClientIdentifier(event);
		let rateLimitConfig = RATE_LIMITS.general;
		let bucketName = 'general';

		// Apply stricter limits for specific endpoints
		if (event.url.pathname.startsWith('/api/auth') || event.url.pathname.startsWith('/api/setup')) {
			rateLimitConfig = RATE_LIMITS.auth;
			bucketName = 'auth';
		} else if (event.url.pathname.startsWith('/api/downloads')) {
			rateLimitConfig = RATE_LIMITS.downloads;
			bucketName = 'downloads';
		} else if (event.url.pathname.startsWith('/api/settings')) {
			rateLimitConfig = RATE_LIMITS.settings;
			bucketName = 'settings';
		} else if (event.url.pathname.startsWith('/api/youtube/search')) {
			rateLimitConfig = RATE_LIMITS.youtubeSearch;
			bucketName = 'youtubeSearch';
		} else if (
			event.url.pathname.startsWith('/api/youtube/') &&
			event.url.pathname !== '/api/youtube/link' &&
			event.url.pathname !== '/api/youtube/subscriptions/export'
		) {
			rateLimitConfig = RATE_LIMITS.youtubeScrape;
			bucketName = 'youtubeScrape';
		}

		const rateLimitKey = `${bucketName}:${clientId}`;
		const isExceeded = rateLimiter.check(rateLimitKey, rateLimitConfig);
		if (isExceeded) {
			const info = rateLimiter.getInfo(rateLimitKey, rateLimitConfig);
			const resetInSeconds = Math.ceil((info.reset - Date.now()) / 1000);
			throw error(429, `Too many requests. Try again in ${resetInSeconds} seconds.`);
		}
	}

	// Try Bearer token auth first (API keys)
	const authHeader = event.request.headers.get('authorization');
	if (authHeader?.startsWith('Bearer ')) {
		const apiKeyUser = await resolveApiKey(authHeader.slice(7));
		if (apiKeyUser) {
			event.locals.session = {
				user: {
					id: apiKeyUser.id,
					email: apiKeyUser.email,
					name: undefined,
					isAdmin: apiKeyUser.isAdmin,
				},
			};
			event.locals.authMethod = 'apikey';
		}
	}

	// Fall back to cookie session
	if (!event.locals.session?.user) {
		const sessionToken = event.cookies.get('wytui.session-token');

		if (sessionToken) {
			const sessionData = verifySessionToken(sessionToken);

			if (sessionData) {
				const user = await prisma.user.findUnique({
					where: { id: sessionData.userId },
				});

				if (user) {
					// Check if password was changed after token was issued (session revocation)
					if (user.passwordChangedAt) {
						const passwordChangedTimestamp = Math.floor(user.passwordChangedAt.getTime() / 1000);
						const tokenPasswordTimestamp = sessionData.passwordChangedAt || 0;

						if (passwordChangedTimestamp > tokenPasswordTimestamp) {
							// Password was changed after this token was issued - revoke session
							console.info(`[Security] Session revoked for user ${user.email} - password changed`);
							event.cookies.delete('wytui.session-token', { path: '/' });
						} else {
							// Session is valid
							event.locals.session = {
								user: {
									id: user.id,
									email: user.email,
									name: user.name ?? undefined,
									isAdmin: user.isAdmin,
								},
							};
							event.locals.authMethod = 'session';
						}
					} else {
						// No password change timestamp, session is valid
						event.locals.session = {
							user: {
								id: user.id,
								email: user.email,
								name: user.name ?? undefined,
								isAdmin: user.isAdmin,
							},
						};
						event.locals.authMethod = 'session';
					}
				}
			} else {
				event.cookies.delete('wytui.session-token', { path: '/' });
			}
		}
	}

	// Try reverse-proxy auth headers (Authelia/Authentik/etc.)
	if (!event.locals.session?.user) {
		const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
		if (settings?.proxyAuthEnabled) {
			// Validate request comes from trusted proxy IP
			const trustedProxyIps = (process.env.TRUSTED_PROXY_IPS || '').split(',').filter(Boolean);
			const forwardedFor = event.request.headers.get('x-forwarded-for');
			const clientIp = forwardedFor ? forwardedFor.split(',')[0].trim() : event.getClientAddress();

			// If TRUSTED_PROXY_IPS is set, validate it. If not set, log a warning.
			if (trustedProxyIps.length > 0 && !trustedProxyIps.includes(clientIp)) {
				console.warn(`[Security] Proxy auth attempt from untrusted IP: ${clientIp}`);
			} else {
				if (trustedProxyIps.length === 0) {
					console.warn(
						'[Security] TRUSTED_PROXY_IPS not set. Proxy authentication is accepting headers from any IP. This is insecure!',
					);
				}

				const headerName = settings.proxyAuthHeader || 'X-Forwarded-User';
				const proxyUser = event.request.headers.get(headerName);

				if (proxyUser) {
					// Log proxy auth events
					console.info(`[Security] Proxy auth: ${proxyUser} from ${clientIp}`);

					// Treat header value as username/email — look up or auto-create
					const identifier = proxyUser.trim();
					if (identifier) {
						// Normalise to email-like if no @ present
						const email = identifier.includes('@') ? identifier : `${identifier}@proxy.local`;

						let user = await prisma.user.findUnique({ where: { email } });

						if (!user) {
							// Auto-create with a random password (they authenticate via proxy)
							const randomPassword = randomBytes(32).toString('hex');
							const hashedPassword = await hashPassword(randomPassword);
							const isFirstUser = (await prisma.user.count()) === 0;
							user = await prisma.user.create({
								data: {
									email,
									password: hashedPassword,
									name: identifier.includes('@') ? identifier.split('@')[0] : identifier,
									isAdmin: isFirstUser,
									emailVerified: new Date(),
								},
							});
						}

						event.locals.session = {
							user: {
								id: user.id,
								email: user.email,
								name: user.name ?? undefined,
								isAdmin: user.isAdmin,
							},
						};
						event.locals.authMethod = 'proxy';

						// Issue a session cookie so subsequent requests don't re-query
						issueSessionCookie(event.cookies, {
							id: user.id,
							email: user.email,
							isAdmin: user.isAdmin,
							passwordChangedAt: user.passwordChangedAt,
						});
					}
				}
			}
		}
	}

	// Public paths that don't require authentication
	const publicPaths = ['/setup', '/api/setup', '/auth', '/api/docs', '/docs', '/llms'];

	// Check if path is public
	const isPublicPath = publicPaths.some((path) => event.url.pathname.startsWith(path));

	// If no users exist yet, redirect to setup (except setup pages and OIDC callback for first-user signup)
	const isSetupPath =
		event.url.pathname.startsWith('/setup') || event.url.pathname.startsWith('/api/setup');
	const isOidcFlow = event.url.pathname.startsWith('/auth/oidc');
	if (!isSetupPath && !isOidcFlow) {
		const usersExist = await hasUsers();
		if (!usersExist) {
			if (!isApiPath) {
				throw redirect(303, '/setup');
			} else {
				return new Response(JSON.stringify({ error: 'Setup required' }), {
					status: 503,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}
	}

	// Handle CORS for browser extension requests to the API
	if (isApiPath) {
		const origin = event.request.headers.get('origin');
		// Allow browser extension origins (chrome-extension://, moz-extension://, etc.),
		// but only on the routes the extension actually calls — see
		// isExtensionAllowedPath for why the origin itself can't be pinned to a
		// specific extension.
		const isExtensionOrigin =
			!!origin &&
			/^(chrome-extension|moz-extension|safari-web-extension):\/\//.test(origin) &&
			isExtensionAllowedPath(event.url.pathname);

		if (event.request.method === 'OPTIONS') {
			const headers: Record<string, string> = {
				'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type, Authorization',
				'Access-Control-Allow-Credentials': 'true',
				'Access-Control-Max-Age': '86400',
			};
			if (isExtensionOrigin) headers['Access-Control-Allow-Origin'] = origin;
			return new Response(null, { status: 204, headers });
		}

		if (isExtensionOrigin) {
			event.locals.corsOrigin = origin;
		}
	}

	// CSRF protection for state-changing requests
	if (!isCsrfExempt(event.request)) {
		// Skip CSRF check for public paths (setup, auth endpoints)
		if (!isPublicPath) {
			const isValid = validateCsrfToken(event.cookies, event.request);
			if (!isValid) {
				console.warn('CSRF validation failed for', event.request.method, event.url.pathname);
				if (isApiPath) {
					return new Response(JSON.stringify({ error: 'CSRF validation failed' }), {
						status: 403,
						headers: { 'Content-Type': 'application/json' },
					});
				} else {
					throw redirect(303, '/auth/signin?error=csrf');
				}
			}
		}
	}

	// If users exist and user is not authenticated and not on public path
	if (!isPublicPath && !event.locals.session?.user) {
		// Redirect to signin for UI routes, return 401 for API routes
		if (isApiPath) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			});
		} else {
			throw redirect(303, '/auth/signin');
		}
	}

	const response = await resolve(event);

	if (event.locals.corsOrigin) {
		response.headers.set('Access-Control-Allow-Origin', event.locals.corsOrigin);
		response.headers.set('Access-Control-Allow-Credentials', 'true');
		response.headers.set('Vary', 'Origin');
	}

	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set(
		'Content-Security-Policy',
		"default-src 'self'; img-src 'self' https://*.ytimg.com https://*.ggpht.com https://*.googleusercontent.com https://i.ytimg.com data:; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; font-src 'self' https://cdn.jsdelivr.net; script-src 'self' 'unsafe-inline' https://www.gstatic.com; connect-src 'self' https://sponsor.ajay.app https://returnyoutubedislikeapi.com; media-src 'self'; frame-ancestors 'none'",
	);

	return response;
};

// Cleanup on server shutdown
process.on('SIGTERM', () => {
	console.log('Received SIGTERM, shutting down gracefully...');
	jobScheduler.stop();
	process.exit(0);
});

process.on('SIGINT', () => {
	console.log('Received SIGINT, shutting down gracefully...');
	jobScheduler.stop();
	process.exit(0);
});
