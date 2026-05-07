import { prisma } from '../db';
import { sseEmitter } from '../sse/emitter';
import { DownloadStatus } from '@prisma/client';
import { copyFile, unlink, mkdir, access, writeFile } from 'fs/promises';
import { join, basename, resolve, extname } from 'path';

function sanitizeFilename(name: string): string {
	return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'Unknown';
}

class LibraryService {
	async promoteToLibrary(downloadId: string): Promise<void> {
		const download = await prisma.download.findUnique({
			where: { id: downloadId },
			include: { profile: true },
		});

		if (!download) throw new Error('Download not found');
		if (download.status !== DownloadStatus.COMPLETED) throw new Error('Download not completed');
		if (!download.filepath) throw new Error('No file path');

		const settings = await this.getSettings();

		const isAudio = download.profile?.audioOnly ?? false;
		const targetLibrary = (isAudio && settings.musicLibraryPath) || settings.libraryPath;
		if (!targetLibrary) throw new Error('Library path not configured');

		const resolvedLibrary = resolve(targetLibrary);
		const resolvedFile = resolve(download.filepath);
		if (resolvedFile.startsWith(resolvedLibrary + '/')) {
			throw new Error('Already in library');
		}

		const uploaderDir = sanitizeFilename(download.uploader || 'Unknown');
		const destDir = resolve(targetLibrary, uploaderDir);
		if (!destDir.startsWith(resolvedLibrary)) {
			throw new Error('Invalid uploader name');
		}
		await mkdir(destDir, { recursive: true });

		const ext = extname(download.filepath);
		const baseFilename = download.title
			? sanitizeFilename(download.title)
			: basename(download.filepath, ext);
		let destPath = join(destDir, baseFilename + ext);

		let suffix = 1;
		while (true) {
			try {
				await access(destPath);
				destPath = join(destDir, `${baseFilename} (${suffix})${ext}`);
				suffix++;
			} catch {
				break;
			}
		}

		await copyFile(download.filepath, destPath);
		try {
			await unlink(download.filepath);
		} catch {
			// Original may already be gone
		}

		if (download.thumbnail && !isAudio) {
			try {
				const thumbRes = await fetch(download.thumbnail);
				if (thumbRes.ok) {
					const thumbBase = basename(destPath, extname(destPath));
					const thumbPath = join(destDir, thumbBase + '.jpg');
					const buffer = Buffer.from(await thumbRes.arrayBuffer());
					await writeFile(thumbPath, buffer);
				}
			} catch {
				// Thumbnail is nice-to-have, don't fail the promote
			}
		}

		await prisma.download.update({
			where: { id: downloadId },
			data: {
				storagePool: 'library',
				filepath: destPath,
			},
		});

		const userId = download.userId;
		if (userId) {
			sseEmitter.broadcastToUser('download:promoted', { id: downloadId, storagePool: 'library' }, userId);
		} else {
			sseEmitter.broadcast('download:promoted', { id: downloadId, storagePool: 'library' });
		}

		await this.triggerLibraryScan();
	}

	async enforceCacheQuota(): Promise<void> {
		const settings = await this.getSettings();
		const quotaBytes = settings.cacheQuotaBytes;

		const result = await prisma.download.aggregate({
			where: {
				storagePool: 'cache',
				status: DownloadStatus.COMPLETED,
			},
			_sum: { filesize: true },
		});

		const usedBytes = result._sum.filesize ?? BigInt(0);
		if (usedBytes <= quotaBytes) return;

		const candidates = await prisma.download.findMany({
			where: {
				storagePool: 'cache',
				status: DownloadStatus.COMPLETED,
			},
			orderBy: { completedAt: 'asc' },
			select: { id: true, filesize: true, filepath: true, userId: true },
		});

		let currentUsage = usedBytes;
		for (const candidate of candidates) {
			if (currentUsage <= quotaBytes) break;

			if (candidate.filepath) {
				try {
					await unlink(candidate.filepath);
				} catch {
					continue;
				}
			}

			const videoId = await this.getVideoIdForDownload(candidate.id);
			if (videoId) {
				await prisma.archive.deleteMany({ where: { videoId } });
			}

			await prisma.download.delete({ where: { id: candidate.id } });

			if (candidate.userId) {
				sseEmitter.broadcastToUser('download:deleted', { id: candidate.id, reason: 'cache_quota' }, candidate.userId);
			} else {
				sseEmitter.broadcast('download:deleted', { id: candidate.id, reason: 'cache_quota' });
			}

			currentUsage -= candidate.filesize ?? BigInt(0);
		}
	}

	async getCacheUsage(): Promise<{ usedBytes: string; quotaBytes: string; percentage: number }> {
		const settings = await this.getSettings();
		const quotaBytes = settings.cacheQuotaBytes;

		const result = await prisma.download.aggregate({
			where: {
				storagePool: 'cache',
				status: DownloadStatus.COMPLETED,
			},
			_sum: { filesize: true },
		});

		const usedBytes = result._sum.filesize ?? BigInt(0);
		const percentage = quotaBytes > BigInt(0)
			? Number((usedBytes * BigInt(10000)) / quotaBytes) / 100
			: 0;

		return {
			usedBytes: usedBytes.toString(),
			quotaBytes: quotaBytes.toString(),
			percentage: Math.min(percentage, 100),
		};
	}

	async clearCache(): Promise<number> {
		const candidates = await prisma.download.findMany({
			where: {
				storagePool: 'cache',
				status: DownloadStatus.COMPLETED,
			},
			select: { id: true, filepath: true, url: true, userId: true },
		});

		for (const candidate of candidates) {
			if (candidate.filepath) {
				try {
					await unlink(candidate.filepath);
				} catch {
					continue;
				}
			}

			const videoId = await this.getVideoIdForDownload(candidate.id);
			if (videoId) {
				await prisma.archive.deleteMany({ where: { videoId } });
			}

			await prisma.download.delete({ where: { id: candidate.id } });

			if (candidate.userId) {
				sseEmitter.broadcastToUser('download:deleted', { id: candidate.id, reason: 'cache_clear' }, candidate.userId);
			} else {
				sseEmitter.broadcast('download:deleted', { id: candidate.id, reason: 'cache_clear' });
			}
		}

		return candidates.length;
	}

	async reconcileFiles(): Promise<number> {
		const downloads = await prisma.download.findMany({
			where: {
				status: DownloadStatus.COMPLETED,
				filepath: { not: null },
			},
			select: { id: true, filepath: true, userId: true },
		});

		let removed = 0;
		for (const download of downloads) {
			if (!download.filepath) continue;

			try {
				await access(download.filepath);
			} catch {
				const videoId = await this.getVideoIdForDownload(download.id);
				if (videoId) {
					await prisma.archive.deleteMany({ where: { videoId } });
				}

				await prisma.download.delete({ where: { id: download.id } });

				if (download.userId) {
					sseEmitter.broadcastToUser('download:deleted', { id: download.id, reason: 'file_missing' }, download.userId);
				} else {
					sseEmitter.broadcast('download:deleted', { id: download.id, reason: 'file_missing' });
				}

				removed++;
			}
		}

		if (removed > 0) {
			console.log(`[LibraryService] Reconciliation removed ${removed} orphaned records`);
		}

		return removed;
	}

	async triggerLibraryScan(): Promise<void> {
		const settings = await this.getSettings();
		if (!settings.jellyfinUrl || !settings.jellyfinApiKey) return;

		try {
			const url = `${settings.jellyfinUrl.replace(/\/$/, '')}/Library/Refresh`;
			await fetch(url, {
				method: 'POST',
				headers: {
					'X-Emby-Token': settings.jellyfinApiKey,
				},
			});
		} catch (error) {
			console.error('[LibraryService] Jellyfin scan failed:', error);
		}
	}

	private async getVideoIdForDownload(downloadId: string): Promise<string | null> {
		const download = await prisma.download.findUnique({
			where: { id: downloadId },
			select: { url: true },
		});
		if (!download) return null;

		try {
			const urlObj = new URL(download.url);
			if (urlObj.hostname.includes('youtube.com')) {
				return urlObj.searchParams.get('v');
			} else if (urlObj.hostname.includes('youtu.be')) {
				return urlObj.pathname.slice(1);
			}
		} catch {}
		return null;
	}

	private async getSettings() {
		let settings = await prisma.settings.findUnique({
			where: { id: 'singleton' },
		});

		if (!settings) {
			settings = await prisma.settings.create({
				data: { id: 'singleton' },
			});
		}

		return settings;
	}
}

export const libraryService = new LibraryService();
