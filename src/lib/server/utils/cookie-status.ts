import { prisma } from '../db';
import { EventTypes } from '../services/event-log.service';
import { youtubeLinkService } from '../services/youtube-link.service';
import { decryptSecret } from './crypto-box';
import type { CookieSource } from './ytdlp-cookies';

/**
 * The cookie state Settings shows: which credential a YouTube request would
 * actually run with, and whether the most recent evidence says it is dead.
 *
 * This has to be computed: the linked account's session is the primary
 * credential, so an admin who authenticates purely through a link has no
 * uploaded file and would otherwise be told there are no cookies while their
 * downloads run fine.
 */
export interface CookieStatus {
	/** Either credential can authenticate a request right now. */
	hasCookies: boolean;
	/** An uploaded cookie file is stored and readable — it is what the admin's
	 *  Remove button clears, so a blob that will not decrypt reports as no file
	 *  (re-uploading overwrites it) rather than offering to delete a missing one. */
	stored: boolean;
	/** Always null: uploads live in the database, there is no file to point at. */
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

/** The same rule the spawn applies, so the panel never claims a credential the
 *  next yt-dlp call cannot use. */
function storedCookieUsable(cookiesTxtEnc: string | null | undefined): boolean {
	if (!cookiesTxtEnc) return false;
	try {
		decryptSecret(cookiesTxtEnc);
		return true;
	} catch {
		return false;
	}
}

/**
 * Failure-driven expiry: the downloads themselves are the check. Cookies are
 * expired when the most recent invalidation (a download failing authentication —
 * sign-in, members-only, bot check) is newer than the most recent refresh of
 * *either* credential — an admin re-upload or a fresh session pushed by the
 * extension's re-link. No cookie file is parsed here.
 */
export async function computeCookieStatus(userId: string): Promise<CookieStatus> {
	const [settings, health, invalidated] = await Promise.all([
		prisma.settings.findUnique({ where: { id: 'singleton' } }),
		youtubeLinkService.getSessionHealth(userId),
		prisma.eventLog.findFirst({
			where: { type: EventTypes.COOKIES_INVALIDATED },
			orderBy: { createdAt: 'desc' },
			select: { createdAt: true },
		}),
	]);

	const stored = storedCookieUsable(settings?.cookiesTxtEnc);
	const usableLink = health.linked && health.usable;
	const source: CookieSource = usableLink ? 'link' : stored ? 'settings' : 'none';

	const refreshedAt = [settings?.cookiesUpdatedAt, health.cookieUpdatedAt].reduce<Date | null>(
		(newest, at) => (at && (!newest || at > newest) ? at : newest),
		null,
	);
	const expired = !!invalidated && (!refreshedAt || invalidated.createdAt > refreshedAt);

	return {
		hasCookies: source !== 'none',
		stored,
		path: null,
		source,
		linked: health.linked,
		needsRelink: health.linked && !health.usable,
		linkUpdatedAt: health.cookieUpdatedAt?.toISOString() ?? null,
		expired,
	};
}
