import { prisma } from '../db';

class WatchProgressService {
	async saveProgress(userId: string, downloadId: string, position: number, duration?: number) {
		// Determine if this position means "watched" (>90% through)
		const isWatchedNow = duration ? position / duration > 0.9 : false;

		// Check if there's an existing record that's already marked watched
		const existing = await prisma.watchProgress.findUnique({
			where: { userId_downloadId: { userId, downloadId } },
		});

		// Don't un-watch something that was already marked watched
		const watched = existing?.watched === true || isWatchedNow;

		return prisma.watchProgress.upsert({
			where: { userId_downloadId: { userId, downloadId } },
			update: {
				position,
				duration,
				watched,
				watchedAt: isWatchedNow && !existing?.watched ? new Date() : undefined,
			},
			create: {
				userId,
				downloadId,
				position,
				duration,
				watched,
				watchedAt: watched ? new Date() : undefined,
			},
		});
	}

	async getContinueWatching(userId: string, limit = 10) {
		const items = await prisma.watchProgress.findMany({
			where: { userId, watched: false, position: { gt: 0 } },
			include: { download: true },
			orderBy: { updatedAt: 'desc' },
			take: limit,
		});

		return items.map((item) => ({
			...item,
			download: {
				...item.download,
				filesize: item.download.filesize?.toString() ?? null,
				downloadedBytes: item.download.downloadedBytes?.toString() ?? null,
				totalBytes: item.download.totalBytes?.toString() ?? null,
			},
		}));
	}

	async markWatched(userId: string, downloadId: string) {
		return prisma.watchProgress.upsert({
			where: { userId_downloadId: { userId, downloadId } },
			update: { watched: true, watchedAt: new Date() },
			create: { userId, downloadId, position: 0, watched: true, watchedAt: new Date() },
		});
	}

	async markUnwatched(userId: string, downloadId: string) {
		return prisma.watchProgress.upsert({
			where: { userId_downloadId: { userId, downloadId } },
			update: { watched: false, watchedAt: null, position: 0 },
			create: { userId, downloadId, position: 0, watched: false },
		});
	}
}

export const watchProgressService = new WatchProgressService();
