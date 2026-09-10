import { prisma } from '../db';
import { youtubeService, type NeedsRelink, type YtEntry } from './youtube.service';
import { youtubeLinkService } from './youtube-link.service';
import { jellyfinService, mapToJellyfinPath } from './jellyfin.service';
import { playlistService } from './playlist.service';
import { RateLimitError } from '../utils/ytdlp-json';

export interface JellyfinSyncResult {
	/** The Jellyfin user the played state was pushed to (null = skipped). */
	user: string | null;
	/** Items marked played in Jellyfin. */
	marked: number;
}

export interface SyncUserResult {
	pushed?: number;
	marked?: number;
	jellyfin?: JellyfinSyncResult;
	watchLaterAdded?: number;
	/** Non-fatal failures, human-readable, for the UI and job logs. */
	errors?: string[];
	/** True when the account's cookies no longer authorize API access. */
	needsRelink?: true;
}

// The full watch-history fetch is the heaviest yt-dlp call the sync makes
// (thousands of entries through an optional proxy), so it gets a longer
// budget than the 120s default; observed healthy runs take ~60s.
const HISTORY_TIMEOUT_MS = 180_000;
const WATCH_LATER_TIMEOUT_MS = 60_000;
// A flaky proxy or a busy YouTube moment often recovers within seconds —
// one delayed retry absorbs most transient failures without waiting 30
// minutes for the next scheduled pass. Public instance field so tests can
// zero it out.
const LAST_ERROR_MAX = 500;

function describeError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

class YouTubeSyncService {
	/** Delay before the one transient-failure retry of the history fetch. */
	transientRetryDelayMs = 30_000;
	/** Record a sync failure on the linked account (shown in Settings). */
	private async recordError(userId: string, message: string): Promise<void> {
		console.error(`[YouTubeSync] ${message}`);
		await prisma.youTubeLink
			.update({ where: { userId }, data: { lastError: message.slice(0, LAST_ERROR_MAX) } })
			.catch(() => {});
	}

	/** Clear a previously recorded error after a fully successful pass. */
	private async clearError(userId: string): Promise<void> {
		await prisma.youTubeLink
			.update({ where: { userId }, data: { lastError: null } })
			.catch(() => {});
	}

	/** Push wytui-watched items to YouTube for a user (best-effort). */
	async pushWatchedToYouTube(userId: string): Promise<{ pushed: number } | NeedsRelink> {
		const link = await prisma.youTubeLink.findUnique({ where: { userId } });
		if (!link?.syncWatchedToYouTube) return { pushed: 0 };
		const cookiesTxt = await youtubeLinkService.getCookiesTxt(userId);
		if (!cookiesTxt) return { needsRelink: true };

		const since = link.lastHistorySync ?? new Date(0);
		const rows = await prisma.watchProgress.findMany({
			where: { userId, watched: true, watchedAt: { gt: since } },
		});
		// Batch-load the downloads for all rows instead of one query per row.
		const downloadIds = rows.map((r) => r.downloadId);
		const downloads = await prisma.download.findMany({
			where: { id: { in: downloadIds } },
		});
		const downloadById = new Map(downloads.map((d) => [d.id, d]));
		let pushed = 0;
		for (const row of rows) {
			const dl = downloadById.get(row.downloadId);
			if (!dl?.videoId) continue;
			if (await youtubeService.markWatchedOnYouTube(dl.videoId, cookiesTxt)) pushed++;
		}
		await prisma.youTubeLink.update({ where: { userId }, data: { lastHistorySync: new Date() } });
		return { pushed };
	}

	/**
	 * Fetch the full watch history with one delayed retry for transient
	 * failures (timeouts, proxy blips). Rate limits are not retried — the
	 * next scheduled pass is the backoff.
	 */
	private async fetchHistoryWithRetry(userId: string): Promise<YtEntry[] | NeedsRelink> {
		try {
			return await youtubeService.fetchHistory(userId, { timeoutMs: HISTORY_TIMEOUT_MS });
		} catch (err) {
			if (err instanceof RateLimitError) throw err;
			console.warn(
				`[YouTubeSync] History fetch failed (${describeError(err)}), retrying in ${
					this.transientRetryDelayMs / 1000
				}s…`,
			);
			await new Promise((r) => setTimeout(r, this.transientRetryDelayMs));
			return await youtubeService.fetchHistory(userId, { timeoutMs: HISTORY_TIMEOUT_MS });
		}
	}

	/**
	 * Pull YT history → mark matching library items watched (+ Jellyfin played).
	 *
	 * Marking is incremental: entries whose library download is already marked
	 * watched for this user are skipped, so each pass writes only new rows and
	 * pushes only newly-watched items to Jellyfin instead of re-processing the
	 * entire (ever-growing) history every run.
	 */
	async reconcileHistory(
		userId: string,
	): Promise<(SyncUserResult & { marked: number; error?: string }) | NeedsRelink> {
		const link = await prisma.youTubeLink.findUnique({ where: { userId } });
		if (!link?.syncHistoryToWytui) return { marked: 0 };

		let result: YtEntry[] | NeedsRelink;
		try {
			result = await this.fetchHistoryWithRetry(userId);
		} catch (err) {
			return { marked: 0, error: `History sync failed: ${describeError(err)}` };
		}
		if ('needsRelink' in result) return { needsRelink: true };

		// Stamp every reconciled row with a single timestamp and advance
		// lastHistorySync to it below. pushWatchedToYouTube selects rows with
		// `watchedAt > lastHistorySync`, so setting them equal guarantees these
		// just-pulled-from-YouTube rows are NOT re-pushed back to YouTube next cycle.
		const syncedAt = new Date();
		// Batch-load all matching downloads in one query, keyed by videoId.
		const videoIds = result.map((e) => e.id);
		const downloads = await prisma.download.findMany({ where: { videoId: { in: videoIds } } });
		const downloadByVideoId = new Map<string, (typeof downloads)[number]>();
		for (const d of downloads) {
			if (d.videoId && !downloadByVideoId.has(d.videoId)) downloadByVideoId.set(d.videoId, d);
		}
		// Downloads already marked watched for this user — skipped below so a
		// pass only writes/upserts entries that are new since the last pass.
		const watchedRows = await prisma.watchProgress.findMany({
			where: { userId, watched: true },
			select: { downloadId: true },
		});
		const watchedDownloadIds = new Set(watchedRows.map((w) => w.downloadId));

		let marked = 0;
		const markedDownloadIds: string[] = [];
		for (const entry of result) {
			const dl = downloadByVideoId.get(entry.id);
			if (!dl) continue;
			if (watchedDownloadIds.has(dl.id)) continue;
			await prisma.watchProgress.upsert({
				where: { userId_downloadId: { userId, downloadId: dl.id } },
				create: { userId, downloadId: dl.id, watched: true, watchedAt: syncedAt },
				update: { watched: true, watchedAt: syncedAt },
			});
			marked++;
			markedDownloadIds.push(dl.id);
		}
		const jellyfin = await this.pushPlaystateToJellyfin(link, markedDownloadIds);
		// Advance the sync watermark past the rows we just stamped so they are
		// excluded from the next push (best-effort; failures are non-fatal).
		await prisma.youTubeLink
			.update({ where: { userId }, data: { lastHistorySync: syncedAt } })
			.catch(() => {});
		return { marked, jellyfin };
	}

	/**
	 * Pull the account's Watch Later list into a wytui "Watch Later" playlist.
	 * Entries are recorded as pending items (deduped by videoId); removals on
	 * YouTube are not mirrored back. Backed by the "Sync playlists" toggle and
	 * the manual sync button in Settings.
	 */
	async syncWatchLaterList(
		userId: string,
		opts: { timeoutMs?: number } = {},
	): Promise<{ added: number } | NeedsRelink | { error: string }> {
		const link = await prisma.youTubeLink.findUnique({ where: { userId } });
		if (!link) return { added: 0 };
		let entries: YtEntry[];
		try {
			const result = await youtubeService.fetchWatchLater(userId, {
				timeoutMs: opts.timeoutMs ?? WATCH_LATER_TIMEOUT_MS,
			});
			if ('needsRelink' in result) return { needsRelink: true };
			entries = result;
		} catch (err) {
			return { error: `Watch Later sync failed: ${describeError(err)}` };
		}
		const { addedItems } = await playlistService.syncYouTubePlaylists(userId, [
			{ title: 'Watch Later', entries },
		]);
		return { added: addedItems };
	}

	/**
	 * Push the just-marked downloads' played state to Jellyfin so the media
	 * library reflects the imported YouTube history (and cleanup, which reads
	 * Jellyfin play state, can act on it). Best-effort: failures are logged and
	 * never fail the history sync.
	 */
	private async pushPlaystateToJellyfin(
		link: { jellyfinUserId?: string | null },
		downloadIds: string[],
	): Promise<JellyfinSyncResult> {
		if (downloadIds.length === 0) return { user: null, marked: 0 };
		try {
			const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
			if (!settings?.jellyfinUrl || !settings.jellyfinApiKey) return { user: null, marked: 0 };
			const baseUrl = settings.jellyfinUrl.replace(/\/$/, '');
			const apiKey = settings.jellyfinApiKey;

			// Prefer the account's configured Jellyfin user; otherwise use the
			// server's user when there is exactly one to pick.
			let user = link.jellyfinUserId ?? null;
			if (!user) {
				const users = await jellyfinService.listUsers(baseUrl, apiKey);
				user = users.length === 1 ? users[0].id : null;
			}
			if (!user) return { user: null, marked: 0 };

			const downloads = await prisma.download.findMany({
				where: { id: { in: downloadIds }, filepath: { not: null } },
				select: { filepath: true },
			});
			let marked = 0;
			for (const dl of downloads) {
				if (!dl.filepath) continue;
				const mapped = mapToJellyfinPath(
					dl.filepath,
					settings.jellyfinLocalPath,
					settings.jellyfinRemotePath,
				);
				const itemId = await jellyfinService.findItemIdByPath(baseUrl, apiKey, mapped);
				if (itemId && (await jellyfinService.markItemPlayed(baseUrl, apiKey, user, itemId))) {
					marked++;
				}
			}
			return { user, marked };
		} catch (err) {
			console.error('[YouTubeSync] Jellyfin playstate push failed:', err);
			return { user: null, marked: 0 };
		}
	}

	/**
	 * One sync pass for a single linked user, honoring their toggles. Used by
	 * the scheduler (via runOnce) and the manual "Sync now" action. Failures
	 * are collected in `errors` (and `needsRelink` for dead sessions) instead
	 * of aborting the remaining directions.
	 */
	async syncForUser(userId: string): Promise<SyncUserResult> {
		const link = await prisma.youTubeLink.findUnique({ where: { userId } });
		if (!link) return {};
		const result: SyncUserResult = {};
		const errors: string[] = [];
		let needsRelink = false;

		// Push BEFORE reconcile, and reconcile advances lastHistorySync to the
		// timestamp it stamps its rows with. Together this stops the loop where
		// freshly-pulled YouTube history rows (watchedAt=now) kept satisfying
		// push's `watchedAt > lastHistorySync` filter and were re-pushed to
		// YouTube every cycle. Push here uses the pre-reconcile watermark.
		if (link.syncWatchedToYouTube) {
			const pushed = await this.pushWatchedToYouTube(userId);
			if ('needsRelink' in pushed) needsRelink = true;
			else result.pushed = pushed.pushed;
		}
		if (link.syncHistoryToWytui) {
			const marked = await this.reconcileHistory(userId);
			if ('needsRelink' in marked) {
				needsRelink = true;
			} else {
				result.marked = marked.marked;
				result.jellyfin = marked.jellyfin;
				if (marked.error) errors.push(marked.error);
			}
		}
		if (link.syncWatchLater) {
			const wl = await this.syncWatchLaterList(userId);
			if ('needsRelink' in wl) needsRelink = true;
			else if ('error' in wl) errors.push(wl.error);
			else result.watchLaterAdded = wl.added;
		}

		if (needsRelink) result.needsRelink = true;
		if (errors.length > 0) result.errors = errors;
		return result;
	}

	/**
	 * One pass over all linked users, honoring per-user toggles. Throws when
	 * any user failed so the scheduler records the job run as failed — a
	 * silently "completed" run that synced nothing is worse than a visible
	 * failure.
	 */
	async runOnce(): Promise<void> {
		const links = await prisma.youTubeLink.findMany();
		const failures: string[] = [];
		for (const link of links) {
			try {
				const result = await this.syncForUser(link.userId);
				const parts: string[] = [];
				if (result.pushed) parts.push(`pushed ${result.pushed} to YouTube`);
				if (result.marked !== undefined) parts.push(`marked ${result.marked} from history`);
				if (result.jellyfin?.marked) parts.push(`Jellyfin played ${result.jellyfin.marked}`);
				if (result.watchLaterAdded) parts.push(`watch later +${result.watchLaterAdded}`);
				console.log(
					`[YouTubeSync] ${link.channelHandle ?? link.userId}: ${
						parts.length > 0 ? parts.join(', ') : 'nothing to do'
					}`,
				);
				if (result.needsRelink) {
					const msg = 'YouTube session expired — re-link required';
					failures.push(`${link.userId}: ${msg}`);
					await this.recordError(link.userId, msg);
				}
				if (result.errors?.length) {
					for (const e of result.errors) failures.push(`${link.userId}: ${e}`);
					await this.recordError(link.userId, result.errors.join('; '));
				}
				if (!result.needsRelink && !result.errors?.length) {
					await this.clearError(link.userId);
				}
			} catch (e) {
				const msg = describeError(e);
				failures.push(`${link.userId}: ${msg}`);
				await this.recordError(link.userId, msg);
			}
		}
		if (failures.length > 0) {
			throw new Error(`youtube-sync: ${failures.join(' | ')}`);
		}
	}
}

export const youtubeSyncService = new YouTubeSyncService();
