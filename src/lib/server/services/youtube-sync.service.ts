import { prisma } from '../db';
import { youtubeService, type NeedsRelink } from './youtube.service';
import { youtubeLinkService } from './youtube-link.service';

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

	/** Pull YT history → mark matching library items watched. */
	async reconcileHistory(userId: string): Promise<{ marked: number } | NeedsRelink> {
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
		for (const entry of result) {
			const dl = downloadByVideoId.get(entry.id);
			if (!dl) continue;
			await prisma.watchProgress.upsert({
				where: { userId_downloadId: { userId, downloadId: dl.id } },
				create: { userId, downloadId: dl.id, watched: true, watchedAt: syncedAt },
				update: { watched: true, watchedAt: syncedAt },
			});
			marked++;
		}
		// Advance the sync watermark past the rows we just stamped so they are
		// excluded from the next push (best-effort; failures are non-fatal).
		await prisma.youTubeLink
			.update({ where: { userId }, data: { lastHistorySync: syncedAt } })
			.catch(() => {});
		return { marked };
	}

	/** One pass over all linked users, honoring per-user toggles. Best-effort. */
	async runOnce(): Promise<void> {
		const links = await prisma.youTubeLink.findMany();
		for (const link of links) {
			try {
				// Push BEFORE reconcile, and reconcile advances lastHistorySync to the
				// timestamp it stamps its rows with. Together this stops the loop where
				// freshly-pulled YouTube history rows (watchedAt=now) kept satisfying
				// push's `watchedAt > lastHistorySync` filter and were re-pushed to
				// YouTube every cycle. Push here uses the pre-reconcile watermark.
				if (link.syncWatchedToYouTube) await this.pushWatchedToYouTube(link.userId);
				if (link.syncHistoryToWytui) await this.reconcileHistory(link.userId);
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
