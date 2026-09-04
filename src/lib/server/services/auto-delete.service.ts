import { prisma } from '../db';
import { unlink } from 'fs/promises';
import { sseEmitter } from '../sse/emitter';
import { libraryService } from './library.service';

class AutoDeleteService {
	async deleteWatchedOverThreshold() {
		// 1. Get global settings
		const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
		if (!settings?.autoDeleteWatchedDays) return { deleted: 0 };

		const globalThresholdDate = new Date();
		globalThresholdDate.setDate(globalThresholdDate.getDate() - settings.autoDeleteWatchedDays);

		// 2. Get channel overrides with their own autoDeleteDays
		const overrides = await prisma.channelOverride.findMany({
			where: { autoDeleteDays: { not: null } },
		});

		// Build a map of channelUrl -> threshold date
		const channelThresholds = new Map<string, Date>();
		for (const override of overrides) {
			if (override.autoDeleteDays) {
				const d = new Date();
				d.setDate(d.getDate() - override.autoDeleteDays);
				channelThresholds.set(override.channelUrl, d);
			}
		}

		// 3. Find watched downloads that exceed their threshold
		const watchedDownloads = await prisma.watchProgress.findMany({
			where: { watched: true },
			include: { download: true },
		});

		let deleted = 0;
		for (const wp of watchedDownloads) {
			const dl = wp.download;
			if (dl.status !== 'COMPLETED' || dl.storagePool === 'library') continue;

			const watchedAt = wp.watchedAt || wp.updatedAt;
			const threshold =
				dl.channelUrl && channelThresholds.has(dl.channelUrl)
					? channelThresholds.get(dl.channelUrl)!
					: globalThresholdDate;

			if (watchedAt < threshold) {
				// Delete file
				if (dl.filepath) {
					try {
						await unlink(dl.filepath);
					} catch {}
					await libraryService.removeVideoArtifacts(dl.filepath);
				}
				// Delete record
				await prisma.download.delete({ where: { id: dl.id } });
				if (dl.userId) {
					sseEmitter.broadcastToUser('download:deleted', { id: dl.id }, dl.userId);
				} else {
					sseEmitter.broadcast('download:deleted', { id: dl.id });
				}
				deleted++;
			}
		}

		return { deleted };
	}
}

export const autoDeleteService = new AutoDeleteService();
