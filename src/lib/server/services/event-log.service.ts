import { prisma } from '../db';

/**
 * Event type vocabulary for the user-facing event log. Call sites record
 * events with these exact keys; the Logs page groups/badges by the
 * "prefix.*" convention (subscription.* / download.* / cookies.*).
 */
export const EventTypes = {
	SUBSCRIPTION_CHECKED: 'subscription.checked',
	SUBSCRIPTION_CHECK_FAILED: 'subscription.check_failed',
	DOWNLOAD_COMPLETED: 'download.completed',
	DOWNLOAD_FAILED: 'download.failed',
	DOWNLOAD_SKIPPED: 'download.skipped',
	DOWNLOAD_RETRIED: 'download.retried',
	DOWNLOAD_DELETED: 'download.deleted',
	DOWNLOAD_PROMOTED: 'download.promoted',
	COOKIES_UPDATED: 'cookies.updated',
	COOKIES_INVALIDATED: 'cookies.invalidated',
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
	 * triggered it. `userId` accepts null because Prisma relations (e.g.
	 * Download.userId) surface as `string | null`.
	 */
	async record(type: EventType, message: string, userId?: string | null): Promise<void> {
		try {
			await prisma.eventLog.create({
				data: { type, message, userId: userId ?? null },
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
