import { prisma } from '../db';
import { getActingUserId } from '../request-context';

/**
 * Event type vocabulary for the user-facing event log. Call sites record
 * events with these exact keys; the Logs page groups/badges by the
 * "prefix.*" convention (subscription.* / download.* / cookies.* / …).
 */
export const EventTypes = {
	// Downloads
	DOWNLOAD_CREATED: 'download.created',
	DOWNLOAD_COMPLETED: 'download.completed',
	DOWNLOAD_FAILED: 'download.failed',
	DOWNLOAD_SKIPPED: 'download.skipped',
	DOWNLOAD_RETRIED: 'download.retried',
	DOWNLOAD_DELETED: 'download.deleted',
	DOWNLOAD_CANCELLED: 'download.cancelled',
	DOWNLOAD_PROMOTED: 'download.promoted',
	// Subscriptions
	SUBSCRIPTION_CREATED: 'subscription.created',
	SUBSCRIPTION_CHECKED: 'subscription.checked',
	SUBSCRIPTION_CHECK_FAILED: 'subscription.check_failed',
	SUBSCRIPTION_UPDATED: 'subscription.updated',
	SUBSCRIPTION_DELETED: 'subscription.deleted',
	SUBSCRIPTION_BACKFILL: 'subscription.backfill',
	// Users & auth
	USER_LOGIN: 'user.login',
	USER_CREATED: 'user.created',
	USER_UPDATED: 'user.updated',
	USER_DELETED: 'user.deleted',
	USER_PASSWORD_CHANGED: 'user.password_changed',
	// Settings & system
	SETTINGS_UPDATED: 'settings.updated',
	COOKIES_UPDATED: 'cookies.updated',
	COOKIES_INVALIDATED: 'cookies.invalidated',
	LOGS_CLEARED: 'logs.cleared',
	// Library
	LIBRARY_REQUEST_APPROVED: 'library.request_approved',
	LIBRARY_REQUEST_DENIED: 'library.request_denied',
	CACHE_CLEARED: 'cache.cleared',
	// Playlists
	PLAYLIST_CREATED: 'playlist.created',
	PLAYLIST_DELETED: 'playlist.deleted',
	// Download profiles
	PROFILE_SAVED: 'profile.saved',
	// API keys
	KEY_CREATED: 'key.created',
	KEY_DELETED: 'key.deleted',
	// YouTube account links
	YOUTUBE_LINKED: 'youtube.linked',
	YOUTUBE_UNLINKED: 'youtube.unlinked',
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

/** Events are kept for at most this many days. */
const RETENTION_DAYS = 30;
/** Pruning is throttled to at most one sweep per hour (volume is low). */
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

// Module-level state shared by the singleton: timestamp (ms) of the last
// retention prune. 0 = never pruned in this process.
let lastPrune = 0;

class EventLogService {
	/**
	 * Record a user-facing event. MUST never throw to callers: event logging
	 * is strictly best-effort and must never break the operation that
	 * triggered it.
	 *
	 * The acting user is resolved from the request context — call sites never
	 * pass the admin/user object. An explicit `userId` only serves as a
	 * fallback for events raised in background work (queue jobs, schedulers),
	 * where the subject user is still worth recording (e.g. a download
	 * completing for its owner).
	 */
	async record(type: EventType, message: string, userId?: string | null): Promise<void> {
		const actingUserId = getActingUserId();
		try {
			await prisma.eventLog.create({
				data: { type, message, userId: actingUserId ?? userId ?? null },
			});
		} catch (e) {
			console.error(`[EventLog] Failed to record "${type}":`, e);
			return;
		}
		this.maybePrune();
	}

	/**
	 * Fire-and-forget retention sweep, throttled to once per hour. Runs after
	 * an insert so steady traffic keeps the table bounded without a dedicated
	 * scheduled job.
	 */
	private maybePrune(): void {
		const now = Date.now();
		if (now - lastPrune < PRUNE_INTERVAL_MS) return;
		lastPrune = now;
		const cutoff = new Date(now - RETENTION_DAYS * 24 * 60 * 60 * 1000);
		prisma.eventLog
			.deleteMany({ where: { createdAt: { lt: cutoff } } })
			.catch((e) => console.error('[EventLog] Retention prune failed:', e));
	}
}

export const eventLogService = new EventLogService();
