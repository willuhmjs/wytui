import { prisma } from '../db';
import { downloadService } from './download.service';
import type { YtEntry } from './youtube.service';

class PlaylistService {
	async create(userId: string, name: string, description?: string) {
		return prisma.playlist.create({
			data: { userId, name, description },
		});
	}

	async list(userId: string) {
		const playlists = await prisma.playlist.findMany({
			where: { userId },
			include: { _count: { select: { items: true } } },
			orderBy: { updatedAt: 'desc' },
		});

		return playlists.map((p) => ({
			...p,
			itemCount: p._count.items,
			_count: undefined,
		}));
	}

	async get(playlistId: string, userId: string) {
		const playlist = await prisma.playlist.findUnique({
			where: { id: playlistId },
			include: {
				items: {
					include: { download: true },
					orderBy: { position: 'asc' },
				},
			},
		});

		if (!playlist) return null;
		if (playlist.userId !== userId) return null;

		return {
			...playlist,
			items: playlist.items.map((item) => ({
				...item,
				// Pending items (synced from YouTube, not yet downloaded) have no
				// download row — expose null and rely on the snapshot fields instead.
				download: item.download
					? {
							...item.download,
							filesize: item.download.filesize?.toString() ?? null,
							downloadedBytes: item.download.downloadedBytes?.toString() ?? null,
							totalBytes: item.download.totalBytes?.toString() ?? null,
						}
					: null,
			})),
		};
	}

	async update(playlistId: string, userId: string, data: { name?: string; description?: string }) {
		const playlist = await prisma.playlist.findUnique({ where: { id: playlistId } });
		if (!playlist) throw new Error('Playlist not found');
		if (playlist.userId !== userId) throw new Error('Access denied');

		return prisma.playlist.update({
			where: { id: playlistId },
			data,
		});
	}

	async delete(playlistId: string, userId: string) {
		const playlist = await prisma.playlist.findUnique({ where: { id: playlistId } });
		if (!playlist) throw new Error('Playlist not found');
		if (playlist.userId !== userId) throw new Error('Access denied');

		return prisma.playlist.delete({ where: { id: playlistId } });
	}

	async addItem(playlistId: string, userId: string, downloadId: string) {
		const playlist = await prisma.playlist.findUnique({ where: { id: playlistId } });
		if (!playlist) throw new Error('Playlist not found');
		if (playlist.userId !== userId) throw new Error('Access denied');

		// Only library items can live in playlists — cache items are transient and may be
		// evicted, which would leave dangling playlist entries.
		const download = await prisma.download.findUnique({
			where: { id: downloadId },
			select: { storagePool: true },
		});
		if (!download) throw new Error('Download not found');
		if (download.storagePool !== 'library') throw new Error('Not in library');

		const maxPosition = await prisma.playlistItem.aggregate({
			where: { playlistId },
			_max: { position: true },
		});

		const nextPosition = (maxPosition._max.position ?? -1) + 1;

		return prisma.playlistItem.create({
			data: { playlistId, downloadId, position: nextPosition },
		});
	}

	async removeItem(playlistId: string, userId: string, downloadId: string) {
		const playlist = await prisma.playlist.findUnique({ where: { id: playlistId } });
		if (!playlist) throw new Error('Playlist not found');
		if (playlist.userId !== userId) throw new Error('Access denied');

		return prisma.playlistItem.delete({
			where: { playlistId_downloadId: { playlistId, downloadId } },
		});
	}

	async getPlaylistsForDownload(userId: string, downloadId: string) {
		const items = await prisma.playlistItem.findMany({
			where: { downloadId },
			include: { playlist: { select: { id: true, name: true, userId: true } } },
		});
		return items
			.filter((item) => item.playlist.userId === userId)
			.map((item) => ({ id: item.playlist.id, name: item.playlist.name }));
	}

	async reorderItems(playlistId: string, userId: string, itemIds: string[]) {
		const playlist = await prisma.playlist.findUnique({ where: { id: playlistId } });
		if (!playlist) throw new Error('Playlist not found');
		if (playlist.userId !== userId) throw new Error('Access denied');

		const updates = itemIds.map((id, index) =>
			prisma.playlistItem.update({
				where: { id },
				data: { position: index },
			}),
		);

		return prisma.$transaction(updates);
	}

	/**
	 * Create/update wytui playlists from selected YouTube playlists. Each entry
	 * becomes a "pending" item (snapshot only, no download yet). Playlists are
	 * matched by name so re-syncing appends new videos without duplicating.
	 */
	async syncYouTubePlaylists(userId: string, playlists: { title: string; entries: YtEntry[] }[]) {
		let createdPlaylists = 0;
		let addedItems = 0;

		for (const pl of playlists) {
			const name = pl.title?.trim() || 'YouTube Playlist';

			let playlist = await prisma.playlist.findUnique({
				where: { userId_name: { userId, name } },
			});
			if (!playlist) {
				playlist = await prisma.playlist.create({ data: { userId, name } });
				createdPlaylists++;
			}

			// Dedup against videos already in this playlist (pending or downloaded).
			const existing = await prisma.playlistItem.findMany({
				where: { playlistId: playlist.id },
				select: { videoId: true },
			});
			const existingIds = new Set(existing.map((i) => i.videoId).filter(Boolean));

			const maxPosition = await prisma.playlistItem.aggregate({
				where: { playlistId: playlist.id },
				_max: { position: true },
			});
			let position = (maxPosition._max.position ?? -1) + 1;

			for (const entry of pl.entries) {
				if (!entry.id || existingIds.has(entry.id)) continue;
				existingIds.add(entry.id);
				await prisma.playlistItem.create({
					data: {
						playlistId: playlist.id,
						position: position++,
						videoId: entry.id,
						title: entry.title,
						thumbnail: entry.thumbnail ?? null,
						sourceUrl: entry.url,
					},
				});
				addedItems++;
			}
		}

		return { playlists: playlists.length, createdPlaylists, addedItems };
	}

	/** Remove a single item by its own id (works for pending items with no downloadId). */
	async removeItemById(playlistId: string, userId: string, itemId: string) {
		const playlist = await prisma.playlist.findUnique({ where: { id: playlistId } });
		if (!playlist) throw new Error('Playlist not found');
		if (playlist.userId !== userId) throw new Error('Access denied');

		const result = await prisma.playlistItem.deleteMany({ where: { id: itemId, playlistId } });
		if (result.count === 0) throw new Error('Item not found');
	}

	/**
	 * Queue downloads for pending items in a playlist and link each new Download
	 * back to its item. Pass itemIds to download a subset, or omit for all pending.
	 */
	async downloadPendingItems(
		playlistId: string,
		userId: string,
		profileId: string,
		itemIds?: string[],
		saveToLibrary?: boolean,
	) {
		const playlist = await prisma.playlist.findUnique({ where: { id: playlistId } });
		if (!playlist) throw new Error('Playlist not found');
		if (playlist.userId !== userId) throw new Error('Access denied');

		const pending = await prisma.playlistItem.findMany({
			where: {
				playlistId,
				downloadId: null,
				...(itemIds?.length ? { id: { in: itemIds } } : {}),
			},
		});

		let started = 0;
		const errors: string[] = [];

		for (const item of pending) {
			if (!item.sourceUrl) continue;
			try {
				const download = await downloadService.createDownload(
					item.sourceUrl,
					profileId,
					userId,
					undefined,
					!!saveToLibrary,
				);
				await prisma.playlistItem.update({
					where: { id: item.id },
					data: { downloadId: download.id },
				});
				started++;
			} catch (e: any) {
				errors.push(`${item.title || item.sourceUrl}: ${e.message}`);
			}
		}

		return { started, errors };
	}
}

export const playlistService = new PlaylistService();
