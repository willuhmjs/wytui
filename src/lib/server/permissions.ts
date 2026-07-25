import type { Settings, User } from '@prisma/client';

export type LibraryAccess = 'allowed' | 'request' | 'denied';

/**
 * Resolve a user's library-save access.
 *
 * Precedence: admins are always allowed; an explicit per-user override
 * (`libraryAccess` true/false) wins next; otherwise the global
 * `libraryAccessMode` applies ("free" → allowed, "request" → must request,
 * "disabled" → denied).
 */
export function libraryAccessStatus(
	user: Pick<User, 'libraryAccess' | 'isAdmin'> | null | undefined,
	settings: Pick<Settings, 'libraryAccessMode'>,
): LibraryAccess {
	if (user?.isAdmin) return 'allowed';
	if (user?.libraryAccess === true) return 'allowed';
	if (user?.libraryAccess === false) return 'denied';
	switch (settings.libraryAccessMode) {
		case 'free':
			return 'allowed';
		case 'request':
			return 'request';
		default:
			return 'denied';
	}
}

/**
 * The cache quota (in bytes) that applies to a user.
 * Per-user `cacheQuotaBytes` overrides the global default when set (non-null).
 */
export function effectiveCacheQuota(
	user: Pick<User, 'cacheQuotaBytes'> | null | undefined,
	settings: Pick<Settings, 'cacheQuotaBytes'>,
): bigint {
	return user?.cacheQuotaBytes ?? settings.cacheQuotaBytes;
}
