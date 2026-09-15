import { prisma } from '../db';
import { unlink } from 'fs/promises';
import { sseEmitter } from '../sse/emitter';
import { libraryService } from './library.service';
import { DownloadStatus } from '@prisma/client';

/**
 * Watched-item retention, per storage pool.
 *
 * Deletion candidates are COMPLETED downloads with a "watched" signal older
 * than the pool's threshold:
 *   - cache:  settings.autoDeleteWatchedDays (watch_progress.watched)
 *   - library: settings.autoDeleteLibraryDays (watch_progress.watched OR
 *              allWatchedAt, the Jellyfin consensus the watched-cleanup job
 *              maintains — so items watched only in Jellyfin still age out)
 *
 * Library deletion keeps the row as a DELETED tombstone (like the Jellyfin
 * watched-cleanup) so the item stays visible with its redownload affordance;
 * cache deletion removes the row, as it always has.
 *
 * Protection always wins over retention:
 *   - download.protected (user pin)
 *   - channelOverride.protected (channel-wide)
 * A per-channel autoDeleteDays override customizes the threshold for that
 * channel in both pools when the respective feature is enabled.
 */
class AutoDeleteService {
	async deleteWatchedOverThreshold() {
		const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });

		const cacheDays = settings?.autoDeleteWatchedDays ?? 0;
		const libraryDays = settings?.autoDeleteLibraryDays ?? 0;
		if (!cacheDays && !libraryDays) return { deleted: 0 };

		// Per-channel overrides: a custom retention refines the threshold for
		// that channel; `protected` exempts the channel entirely.
		const overrides = await prisma.channelOverride.findMany();
		const overrideDays = new Map<string, number>();
		const protectedChannels = new Set<string>();
		for (const override of overrides) {
			if (override.protected) protectedChannels.add(override.channelUrl);
			else if (override.autoDeleteDays && override.autoDeleteDays > 0)
				overrideDays.set(override.channelUrl, override.autoDeleteDays);
		}

		const thresholdFor = (dl: { channelUrl: string | null }, globalDays: number): Date | null => {
			if (dl.channelUrl && protectedChannels.has(dl.channelUrl)) return null;
			const days = overrideDays.get(dl.channelUrl ?? '') ?? globalDays;
			if (!days || days <= 0) return null;
			const d = new Date();
			d.setDate(d.getDate() - days);
			return d;
		};

		const watchedDownloads = await prisma.watchProgress.findMany({
			where: { watched: true },
			include: { download: true },
		});

		// Library items watched only in Jellyfin surface through allWatchedAt
		// (maintained by the watched-cleanup job) rather than watch_progress.
		const jellyfinWatched =
			libraryDays > 0
				? await prisma.download.findMany({
						where: {
							status: DownloadStatus.COMPLETED,
							storagePool: 'library',
							protected: false,
							allWatchedAt: { not: null },
						},
					})
				: [];

		let deleted = 0;
		let libraryDeleted = 0;
		const seen = new Set<string>();

		for (const wp of watchedDownloads) {
			const dl = wp.download;
			if (dl.status !== DownloadStatus.COMPLETED || dl.protected || seen.has(dl.id)) continue;

			const isLibrary = dl.storagePool === 'library';
			const threshold = thresholdFor(dl, isLibrary ? libraryDays : cacheDays);
			if (!threshold) continue;

			const watchedAt = wp.watchedAt || wp.updatedAt;
			if (watchedAt >= threshold) continue;

			seen.add(dl.id);
			if (isLibrary) {
				await this.deleteLibraryItem(dl);
				libraryDeleted++;
			} else {
				await this.deleteCacheItem(dl);
			}
			deleted++;
		}

		for (const dl of jellyfinWatched) {
			if (seen.has(dl.id)) continue;
			const threshold = thresholdFor(dl, libraryDays);
			if (!threshold || !dl.allWatchedAt || dl.allWatchedAt >= threshold) continue;

			seen.add(dl.id);
			await this.deleteLibraryItem(dl);
			libraryDeleted++;
			deleted++;
		}

		if (libraryDeleted > 0) {
			// Let Jellyfin drop the removed items; best-effort, never fatal.
			await libraryService.triggerLibraryScan().catch(() => {});
		}

		return { deleted };
	}

	private async deleteCacheItem(dl: {
		id: string;
		filepath: string | null;
		userId: string | null;
	}) {
		if (dl.filepath) {
			try {
				await unlink(dl.filepath);
			} catch {}
			await libraryService.removeVideoArtifacts(dl.filepath);
		}
		await prisma.download.delete({ where: { id: dl.id } });
		if (dl.userId) {
			sseEmitter.broadcastToUser('download:deleted', { id: dl.id }, dl.userId);
		} else {
			sseEmitter.broadcast('download:deleted', { id: dl.id });
		}
	}

	private async deleteLibraryItem(dl: {
		id: string;
		filepath: string | null;
		userId: string | null;
	}) {
		if (dl.filepath) {
			try {
				await unlink(dl.filepath);
			} catch {}
			// Sidecars, per-video artwork, and the now-empty video directory.
			await libraryService.removeVideoArtifacts(dl.filepath);
		}
		// Keep the row as a tombstone: the item remains listed (DELETED) with
		// its redownload affordance, and a later rescan can't report it missing.
		await prisma.download.update({
			where: { id: dl.id },
			data: { status: DownloadStatus.DELETED, filepath: null },
		});
		if (dl.userId) {
			sseEmitter.broadcastToUser(
				'download:updated',
				{ id: dl.id, status: 'DELETED', filepath: null },
				dl.userId,
			);
		} else {
			sseEmitter.broadcast('download:updated', { id: dl.id, status: 'DELETED', filepath: null });
		}
	}
}

export const autoDeleteService = new AutoDeleteService();
