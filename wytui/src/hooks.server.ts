import { hasUsers, verifySessionToken } from '$lib/server/auth';
import { jobScheduler } from '$lib/server/jobs/scheduler';
import { ensureDefaults } from '$lib/server/init';
import { redirect, type Handle } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';

// Initialise database defaults and start background jobs on server startup
let initialised = false;
if (!initialised) {
	ensureDefaults().catch((error) => {
		console.error('Failed to initialize database defaults:', error);
	});
	jobScheduler.start().catch((error) => {
		console.error('Failed to start background jobs:', error);
	});
	initialised = true;
}

// Session and protection middleware
export const handle: Handle = async ({ event, resolve }) => {
	// Parse session from cookie
	const sessionToken = event.cookies.get('wytui.session-token');

	if (sessionToken) {
		const sessionData = verifySessionToken(sessionToken);

		if (sessionData) {
			// Get fresh user data from database
			const user = await prisma.user.findUnique({
				where: { id: sessionData.userId },
			});

			if (user) {
				event.locals.session = {
					user: {
						id: user.id,
						email: user.email,
						name: user.name,
						isAdmin: user.isAdmin,
					},
				};
			}
		} else {
			// Invalid or expired session token, clear it
			event.cookies.delete('wytui.session-token', { path: '/' });
		}
	}

	// Public paths that don't require authentication
	const publicPaths = ['/setup', '/api/setup', '/auth'];

	// Check if path is public
	const isPublicPath = publicPaths.some((path) => event.url.pathname.startsWith(path));
	const isApiPath = event.url.pathname.startsWith('/api/');

	// If no users exist yet, redirect to setup (except if already on setup page)
	if (!isPublicPath) {
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

	return resolve(event);
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
