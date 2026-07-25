import { error } from '@sveltejs/kit';

type SessionUser = NonNullable<NonNullable<App.Locals['session']>['user']>;

/**
 * Ensures the request is authenticated. Returns the authenticated user id and
 * narrows `locals.session` so callers can safely access `locals.session.user`.
 */
export function requireAuth(locals: App.Locals): string {
	const user = locals.session?.user;
	if (!user?.id) {
		throw error(401, 'Authentication required');
	}
	return user.id;
}

/**
 * Ensures the request is authenticated AND the user is an admin. Narrows
 * `locals.session.user` for callers via the assertion signature.
 */
export function requireAdmin(
	locals: App.Locals,
): asserts locals is App.Locals & { session: { user: SessionUser } } {
	if (!locals.session?.user?.isAdmin) {
		throw error(403, 'Admin access required');
	}
}
