import { prisma } from '../db';
import { youtubeService, type NeedsRelink } from './youtube.service';
import { youtubeLinkService } from './youtube-link.service';
import { jellyfinService, mapToJellyfinPath } from './jellyfin.service';

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
}

class YouTubeSyncService {
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

	/** Pull YT history → mark matching library items watched (+ Jellyfin played). */
	async reconcileHistory(
		userId: string,
	): Promise<(SyncUserResult & { marked: number }) | NeedsRelink> {
		const link = await prisma.youTubeLink.findUnique({ where: { userId } });
		if (!link?.syncHistoryToWytui) return { marked: 0 };
		const result = await youtubeService.fetchHistory(userId);
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
		let marked = 0;
		const markedDownloadIds: string[] = [];
		for (const entry of result) {
			const dl = downloadByVideoId.get(entry.id);
			if (!dl) continue;
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
	 * the scheduler (via runOnce) and the manual "Sync now" action.
	 */
	async syncForUser(userId: string): Promise<SyncUserResult> {
		const link = await prisma.youTubeLink.findUnique({ where: { userId } });
		if (!link) return {};
		const result: SyncUserResult = {};
		// Push BEFORE reconcile, and reconcile advances lastHistorySync to the
		// timestamp it stamps its rows with. Together this stops the loop where
		// freshly-pulled YouTube history rows (watchedAt=now) kept satisfying
		// push's `watchedAt > lastHistorySync` filter and were re-pushed to
		// YouTube every cycle. Push here uses the pre-reconcile watermark.
		if (link.syncWatchedToYouTube) {
			const pushed = await this.pushWatchedToYouTube(userId);
			if (!('needsRelink' in pushed)) result.pushed = pushed.pushed;
		}
		if (link.syncHistoryToWytui) {
			const marked = await this.reconcileHistory(userId);
			if (!('needsRelink' in marked)) {
				result.marked = marked.marked;
				result.jellyfin = marked.jellyfin;
			}
		}
		return result;
	}

	/** One pass over all linked users, honoring per-user toggles. Best-effort. */
	async runOnce(): Promise<void> {
		const links = await prisma.youTubeLink.findMany();
		for (const link of links) {
			try {
				await this.syncForUser(link.userId);
			} catch (e) {
				await prisma.youTubeLink
					.update({
						where: { userId: link.userId },
						data: { lastError: e instanceof Error ? e.message : 'sync error' },
					})
					.catch(() => {});
			}
		}
	}
}

export const youtubeSyncService = new YouTubeSyncService();
