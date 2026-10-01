import { prisma } from '../db';
import { EventTypes } from '../services/event-log.service';
import { youtubeLinkService } from '../services/youtube-link.service';
import { readableCookiePath, type CookieSource } from './ytdlp-cookies';

/**
 * The cookie state Settings shows: which credential a YouTube request would
 * actually run with, and whether the most recent evidence says it is dead.
 *
 * This has to be computed, not read off `settings.cookiePath`: the linked
 * account's session is the primary credential, so an admin who authenticates
 * purely through a link has no cookie file and would otherwise be told there are
 * no cookies while their downloads fail on authentication.
 */
export interface CookieStatus {
	/** Either credential can authenticate a request right now. */
	hasCookies: boolean;
	/** The uploaded file, when it is both configured and on disk — it is what the
	 *  admin's Remove button deletes, so a stale path (container disk, not a volume)
	 *  reports as no file rather than offering to delete a missing one. */
	path: string | null;
	/** Which credential this user's traffic resolves to. */
	source: CookieSource;
	/** This user has a linked YouTube account at all. */
	linked: boolean;
	/** A link row exists but its stored session will not decrypt — re-linking is
	 *  the fix, uploading a cookie file is not. */
	needsRelink: boolean;
	/** When the linked session was last written (ISO), null when unlinked. */
	linkUpdatedAt: string | null;
	/** The newest auth failure is newer than the newest credential refresh. */
	expired: boolean;
}

/**
 * Failure-driven expiry: the downloads themselves are the check. Cookies are
 * expired when the most recent invalidation (a download failing authentication —
 * sign-in, members-only, bot check) is newer than the most recent refresh of
 * *either* credential — an admin re-upload or a fresh session pushed by the
 * extension's re-link. No cookie file is parsed here.
 */
export async function computeCookieStatus(userId: string): Promise<CookieStatus> {
	const [settings, health, invalidated, updated] = await Promise.all([
		prisma.settings.findUnique({ where: { id: 'singleton' } }),
		youtubeLinkService.getSessionHealth(userId),
		prisma.eventLog.findFirst({
			where: { type: EventTypes.COOKIES_INVALIDATED },
			orderBy: { createdAt: 'desc' },
			select: { createdAt: true },
		}),
		prisma.eventLog.findFirst({
			where: { type: EventTypes.COOKIES_UPDATED },
			orderBy: { createdAt: 'desc' },
			select: { createdAt: true },
		}),
	]);

	// Same rule the spawn applies: a path that survived in the DB but not on the
	// container's disk is not a credential, and reporting it as one gives the
	// settings UI a Remove button for a file that is already gone.
	const settingsPath = await readableCookiePath(settings?.cookiePath);
	const usableLink = health.linked && health.usable;
	const source: CookieSource = usableLink ? 'link' : settingsPath ? 'settings' : 'none';

	const refreshedAt = [updated?.createdAt, health.cookieUpdatedAt].reduce<Date | null>(
		(newest, at) => (at && (!newest || at > newest) ? at : newest),
		null,
	);
	const expired = !!invalidated && (!refreshedAt || invalidated.createdAt > refreshedAt);

	return {
		hasCookies: source !== 'none',
		path: settingsPath,
		source,
		linked: health.linked,
		needsRelink: health.linked && !health.usable,
		linkUpdatedAt: health.cookieUpdatedAt?.toISOString() ?? null,
		expired,
	};
}
