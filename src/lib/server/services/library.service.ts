import { prisma } from '../db';
import { sseEmitter } from '../sse/emitter';
import { DownloadStatus } from '@prisma/client';
import { copyFile, unlink, mkdir, access, writeFile, statfs } from 'fs/promises';
import { join, basename, resolve, extname, sep } from 'path';
import { musicMetadataService } from './music-metadata.service';
import { ytdlpService } from './ytdlp.service';
import { plexService } from './plex.service';
import { effectiveCacheQuota } from '../permissions';
import { internalFetch } from '../utils/fetch';
import { resolveBestThumbnailUrl } from './thumbnail';
import { writeJellyfinArtwork } from './artwork';

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
		if (resolvedFile.startsWith(resolvedLibrary + sep)) {
			throw new Error('Already in library');
		}

		if (isAudio) {
			await this.promoteAudioToLibrary(download, resolvedLibrary, targetLibrary);
		} else {
			await this.promoteVideoToLibrary(download, resolvedLibrary, targetLibrary);
		}

		const userId = download.userId;
		if (userId) {
			sseEmitter.broadcastToUser(
				'download:promoted',
				{ id: download.id, storagePool: 'library' },
				userId,
			);
		} else {
			sseEmitter.broadcast('download:promoted', { id: download.id, storagePool: 'library' });
		}

		await this.triggerLibraryScan();
	}

	private async promoteAudioToLibrary(
		download: any,
		resolvedLibrary: string,
		targetLibrary: string,
	): Promise<void> {
		const ext = extname(download.filepath);
		const info = await musicMetadataService.resolveAndTag(download);

		const artistDir = sanitizeFilename(info.artist);
		const albumDir = sanitizeFilename(info.album);
		let filename: string;

		if (info.trackNumber) {
			filename = `${String(info.trackNumber).padStart(2, '0')} - ${sanitizeFilename(info.title)}${ext}`;
		} else {
			filename = `${sanitizeFilename(info.title)}${ext}`;
		}

		const albumPath = resolve(targetLibrary, artistDir, albumDir);
		if (albumPath !== resolvedLibrary && !albumPath.startsWith(resolvedLibrary + sep)) {
			throw new Error('Invalid path');
		}

		await mkdir(albumPath, { recursive: true });

		let destPath = join(albumPath, filename);
		let suffix = 1;
		while (true) {
			try {
				await access(destPath);
				const base = sanitizeFilename(info.title);
				destPath = join(albumPath, `${base} (${suffix})${ext}`);
				suffix++;
			} catch {
				break;
			}
		}

		await copyFile(download.filepath, destPath);
		try {
			await unlink(download.filepath);
		} catch {}

		if (info.coverArtBuffer) {
			const coverPath = join(albumPath, 'cover.jpg');
			try {
				await access(coverPath);
			} catch {
				await writeFile(coverPath, info.coverArtBuffer);
			}
		}

		await this.ensureChannelArt(resolve(targetLibrary, artistDir), download.channelUrl);

		await prisma.download.update({
			where: { id: download.id },
			data: {
				storagePool: 'library',
				filepath: destPath,
				artist: info.artist,
				album: info.album,
				trackNumber: info.trackNumber,
				releaseYear: info.year,
			},
		});
	}

	private async promoteVideoToLibrary(
		download: any,
		resolvedLibrary: string,
		targetLibrary: string,
	): Promise<void> {
		const ext = extname(download.filepath);
		const uploaderDir = sanitizeFilename(download.uploader || 'Unknown');
		const baseFilename = download.title
			? sanitizeFilename(download.title)
			: basename(download.filepath, ext);

		let videoDir = resolve(targetLibrary, uploaderDir, baseFilename);
		if (!videoDir.startsWith(resolvedLibrary + sep)) {
			throw new Error('Invalid uploader name');
		}

		let suffix = 1;
		while (true) {
			try {
				await access(videoDir);
				videoDir = resolve(targetLibrary, uploaderDir, `${baseFilename} (${suffix})`);
				suffix++;
			} catch {
				break;
			}
		}

		await mkdir(videoDir, { recursive: true });

		const destFilename = basename(videoDir);
		const destPath = join(videoDir, destFilename + ext);

		await copyFile(download.filepath, destPath);
		try {
			await unlink(download.filepath);
		} catch {}

		try {
			const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
			const sourceUrl = await resolveBestThumbnailUrl({
				videoId: download.videoId,
				thumbnail: download.thumbnail,
				// download.thumbnails is not persisted; videoId + thumbnail cover current cases.
			});
			if (sourceUrl) {
				await writeJellyfinArtwork({
					sourceUrl,
					videoDir,
					generatePoster: settings?.generateJellyfinPosters ?? true,
				});
			}
		} catch {
			/* artwork is best-effort; never block the library move */
		}

		const uploaderPath = resolve(targetLibrary, uploaderDir);
		await this.ensureChannelArt(uploaderPath, download.channelUrl);

		await prisma.download.update({
			where: { id: download.id },
			data: {
				storagePool: 'library',
				filepath: destPath,
			},
		});
	}

	private async ensureChannelArt(dirPath: string, channelUrl?: string | null): Promise<void> {
		if (!channelUrl) return;
		const folderJpg = join(dirPath, 'folder.jpg');
		try {
			await access(folderJpg);
			return;
		} catch {}
		try {
			const buffer = await ytdlpService.fetchChannelThumbnail(channelUrl);
			if (buffer) {
				await writeFile(folderJpg, buffer);
			}
		} catch (err) {
			console.error('[LibraryService] Failed to fetch channel art:', err);
		}
	}

	/**
	 * Evict oldest cache downloads until under quota. When `userId` is given,
	 * scope both the usage tally and eviction to that user using their effective
	 * (per-user or default) quota; otherwise enforce the global quota app-wide.
	 */
	async enforceCacheQuota(userId?: string): Promise<void> {
		const settings = await this.getSettings();
		let quotaBytes = settings.cacheQuotaBytes;
		if (userId) {
			const user = await prisma.user.findUnique({
				where: { id: userId },
				select: { cacheQuotaBytes: true },
			});
			quotaBytes = effectiveCacheQuota(user, settings);
		}
		const scope = userId ? { userId } : {};

		const result = await prisma.download.aggregate({
			where: {
				storagePool: 'cache',
				status: DownloadStatus.COMPLETED,
				...scope,
			},
			_sum: { filesize: true },
		});

		const usedBytes = result._sum.filesize ?? BigInt(0);
		if (usedBytes <= quotaBytes) return;

		const candidates = await prisma.download.findMany({
			where: {
				storagePool: 'cache',
				status: DownloadStatus.COMPLETED,
				...scope,
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
				sseEmitter.broadcastToUser(
					'download:deleted',
					{ id: candidate.id, reason: 'cache_quota' },
					candidate.userId,
				);
			} else {
				sseEmitter.broadcast('download:deleted', { id: candidate.id, reason: 'cache_quota' });
			}

			currentUsage -= candidate.filesize ?? BigInt(0);
		}
	}

	async getCacheUsage(
		userId?: string,
	): Promise<{ usedBytes: string; quotaBytes: string; percentage: number }> {
		const settings = await this.getSettings();
		let quotaBytes = settings.cacheQuotaBytes;
		if (userId) {
			const user = await prisma.user.findUnique({
				where: { id: userId },
				select: { cacheQuotaBytes: true },
			});
			quotaBytes = effectiveCacheQuota(user, settings);
		}
		const scope = userId ? { userId } : {};

		const result = await prisma.download.aggregate({
			where: {
				storagePool: 'cache',
				status: DownloadStatus.COMPLETED,
				...scope,
			},
			_sum: { filesize: true },
		});

		const usedBytes = result._sum.filesize ?? BigInt(0);
		const percentage =
			quotaBytes > BigInt(0) ? Number((usedBytes * BigInt(10000)) / quotaBytes) / 100 : 0;

		return {
			usedBytes: usedBytes.toString(),
			quotaBytes: quotaBytes.toString(),
			percentage: Math.min(percentage, 100),
		};
	}

	/** Total capacity of the disk backing the cache/download path, or null if unreadable. */
	private async getDiskTotalBytes(downloadPath: string): Promise<bigint | null> {
		try {
			const stats = await statfs(downloadPath);
			return BigInt(stats.bsize) * BigInt(stats.blocks);
		} catch {
			return null;
		}
	}

	/** Actual free space available on the disk backing `path`, or null if unreadable. */
	private async getDiskFreeBytes(path: string): Promise<bigint | null> {
		try {
			const stats = await statfs(path);
			return BigInt(stats.bsize) * BigInt(stats.bavail);
		} catch {
			return null;
		}
	}

	/**
	 * Guarantee at least `requiredBytes` of real free space on `downloadPath` before a
	 * download starts. The DB-tallied cache quota (enforceCacheQuota/enforceTotalCacheQuota)
	 * only ever counts `storagePool: 'cache'` rows, so it goes blind whenever downloads are
	 * routed to the library (or a promotion fails and strands a file) — the disk fills up
	 * while the quota tally sees ~0 bytes used and never evicts. This checks the actual
	 * filesystem instead, so it reclaims space regardless of how usage got there.
	 *
	 * Evicts the oldest completed cache-pool downloads (across all users) until either
	 * enough space is free or there's nothing left to evict. Returns `sufficient: true`
	 * if the disk can't be read at all — we don't want to block downloads on a bad stat.
	 */
	async ensureFreeDiskSpace(
		downloadPath: string,
		requiredBytes: bigint,
	): Promise<{ freedBytes: bigint; sufficient: boolean }> {
		let free = await this.getDiskFreeBytes(downloadPath);
		if (free == null) return { freedBytes: BigInt(0), sufficient: true };
		if (free >= requiredBytes) return { freedBytes: BigInt(0), sufficient: true };

		const candidates = await prisma.download.findMany({
			where: { storagePool: 'cache', status: DownloadStatus.COMPLETED },
			orderBy: { completedAt: 'asc' },
			select: { id: true, filesize: true, filepath: true, userId: true },
		});

		let freedBytes = BigInt(0);
		for (const candidate of candidates) {
			free = await this.getDiskFreeBytes(downloadPath);
			if (free != null && free >= requiredBytes) break;

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
			freedBytes += candidate.filesize ?? BigInt(0);

			if (candidate.userId) {
				sseEmitter.broadcastToUser(
					'download:deleted',
					{ id: candidate.id, reason: 'disk_space' },
					candidate.userId,
				);
			} else {
				sseEmitter.broadcast('download:deleted', { id: candidate.id, reason: 'disk_space' });
			}
		}

		free = await this.getDiskFreeBytes(downloadPath);
		return { freedBytes, sufficient: free == null || free >= requiredBytes };
	}

	/**
	 * Effective global cache cap. An explicit Settings.totalCacheQuotaBytes wins;
	 * otherwise default to (disk capacity − 5 GB) so non-PVC installs leave headroom.
	 * Returns null when no explicit cap is set and the disk can't be read — callers
	 * treat null as "no global enforcement" (fail-safe, never mass-evict on bad data).
	 */
	async getEffectiveTotalCacheQuota(settings?: {
		totalCacheQuotaBytes: bigint | null;
		downloadPath: string | null;
	}): Promise<bigint | null> {
		const s = settings ?? (await this.getSettings());
		if (s.totalCacheQuotaBytes != null) return s.totalCacheQuotaBytes;

		const FIVE_GIB = BigInt(5_368_709_120);
		const diskTotal = await this.getDiskTotalBytes(s.downloadPath || '/downloads');
		if (diskTotal == null) return null;
		const cap = diskTotal - FIVE_GIB;
		return cap > BigInt(0) ? cap : BigInt(0);
	}

	/** Global cache usage across all users vs the effective global cap. */
	async getTotalCacheUsage(): Promise<{
		usedBytes: string;
		quotaBytes: string | null;
		percentage: number;
	}> {
		const quotaBytes = await this.getEffectiveTotalCacheQuota();

		const result = await prisma.download.aggregate({
			where: { storagePool: 'cache', status: DownloadStatus.COMPLETED },
			_sum: { filesize: true },
		});
		const usedBytes = result._sum.filesize ?? BigInt(0);

		const percentage =
			quotaBytes && quotaBytes > BigInt(0)
				? Math.min(Number((usedBytes * BigInt(10000)) / quotaBytes) / 100, 100)
				: 0;

		return {
			usedBytes: usedBytes.toString(),
			quotaBytes: quotaBytes == null ? null : quotaBytes.toString(),
			percentage,
		};
	}

	/**
	 * Enforce the global total cache cap by evicting the oldest completed cache
	 * downloads across ALL users until total usage is back under the cap. No-op when
	 * there's no effective cap. Mirrors the per-user eviction in enforceCacheQuota.
	 */
	async enforceTotalCacheQuota(): Promise<void> {
		const quotaBytes = await this.getEffectiveTotalCacheQuota();
		if (quotaBytes == null) return;

		const result = await prisma.download.aggregate({
			where: { storagePool: 'cache', status: DownloadStatus.COMPLETED },
			_sum: { filesize: true },
		});

		const usedBytes = result._sum.filesize ?? BigInt(0);
		if (usedBytes <= quotaBytes) return;

		const candidates = await prisma.download.findMany({
			where: { storagePool: 'cache', status: DownloadStatus.COMPLETED },
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
				sseEmitter.broadcastToUser(
					'download:deleted',
					{ id: candidate.id, reason: 'cache_quota' },
					candidate.userId,
				);
			} else {
				sseEmitter.broadcast('download:deleted', { id: candidate.id, reason: 'cache_quota' });
			}

			currentUsage -= candidate.filesize ?? BigInt(0);
		}
	}

	async getLibraryUsage(): Promise<{
		video: { usedBytes: string; count: number } | null;
		music: { usedBytes: string; count: number } | null;
	}> {
		const settings = await this.getSettings();

		const videoResult = settings.libraryPath
			? await prisma.download.aggregate({
					where: {
						storagePool: 'library',
						status: DownloadStatus.COMPLETED,
						profile: { audioOnly: false },
					},
					_sum: { filesize: true },
					_count: true,
				})
			: null;

		const musicResult = settings.musicLibraryPath
			? await prisma.download.aggregate({
					where: {
						storagePool: 'library',
						status: DownloadStatus.COMPLETED,
						profile: { audioOnly: true },
					},
					_sum: { filesize: true },
					_count: true,
				})
			: null;

		return {
			video: videoResult
				? {
						usedBytes: (videoResult._sum.filesize ?? BigInt(0)).toString(),
						count: videoResult._count,
					}
				: null,
			music: musicResult
				? {
						usedBytes: (musicResult._sum.filesize ?? BigInt(0)).toString(),
						count: musicResult._count,
					}
				: null,
		};
	}

	async clearCache(userId?: string): Promise<number> {
		const candidates = await prisma.download.findMany({
			where: {
				storagePool: 'cache',
				status: DownloadStatus.COMPLETED,
				// Scope to the requesting user so one user can't wipe another's cache.
				...(userId ? { userId } : {}),
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
				sseEmitter.broadcastToUser(
					'download:deleted',
					{ id: candidate.id, reason: 'cache_clear' },
					candidate.userId,
				);
			} else {
				sseEmitter.broadcast('download:deleted', { id: candidate.id, reason: 'cache_clear' });
			}
		}

		return candidates.length;
	}

	/**
	 * If more than this fraction of considered files appear missing in a single pass,
	 * assume a storage outage rather than genuine deletions and abort to avoid wiping records.
	 */
	private static readonly RECONCILE_ABORT_FRACTION = 0.5;
	private static readonly RECONCILE_MIN_FOR_FRACTION = 4;

	async reconcileFiles(): Promise<number> {
		const settings = await this.getSettings();

		// Determine which configured storage roots are currently reachable. If a root is
		// unreachable (e.g. an NFS/SMB mount or Docker volume dropped), every file under it
		// looks "missing" — skip those files instead of deleting the whole library.
		const configuredRoots = [
			settings.downloadPath,
			settings.libraryPath,
			settings.musicLibraryPath,
		].filter((p): p is string => !!p);

		const unavailableRoots: string[] = [];
		for (const root of configuredRoots) {
			try {
				await access(resolve(root));
			} catch {
				unavailableRoots.push(resolve(root));
			}
		}
		if (unavailableRoots.length > 0) {
			console.warn(
				`[LibraryService] Reconciliation: storage root(s) unreachable, skipping files under them: ${unavailableRoots.join(', ')}`,
			);
		}

		const isUnderUnavailableRoot = (filepath: string): boolean => {
			const resolved = resolve(filepath);
			return unavailableRoots.some((root) => resolved === root || resolved.startsWith(root + sep));
		};

		const downloads = await prisma.download.findMany({
			where: {
				status: DownloadStatus.COMPLETED,
				filepath: { not: null },
			},
			select: { id: true, filepath: true, userId: true, storagePool: true },
		});

		// First pass: determine which files are actually missing (no deletions yet) so we can
		// apply a circuit-breaker before destroying any records.
		const missing: typeof downloads = [];
		let checked = 0;
		for (const download of downloads) {
			if (!download.filepath) continue;
			if (isUnderUnavailableRoot(download.filepath)) continue;

			checked++;
			try {
				await access(download.filepath);
			} catch {
				missing.push(download);
			}
		}

		// Circuit-breaker: a sudden disappearance of most files almost always means an outage,
		// not that the user deleted everything. Abort loudly instead of mass-deleting records.
		if (
			missing.length >= LibraryService.RECONCILE_MIN_FOR_FRACTION &&
			missing.length / checked >= LibraryService.RECONCILE_ABORT_FRACTION
		) {
			console.error(
				`[LibraryService] Reconciliation ABORTED: ${missing.length}/${checked} files appear missing ` +
					`(>= ${LibraryService.RECONCILE_ABORT_FRACTION * 100}%). Assuming a storage outage; no records were removed.`,
			);
			return 0;
		}

		let removed = 0;
		for (const download of missing) {
			if (!download.filepath) continue;

			{
				if (download.storagePool === 'library') {
					await prisma.download.update({
						where: { id: download.id },
						data: { status: DownloadStatus.DELETED, filepath: null },
					});

					const event = { id: download.id, status: 'DELETED', filepath: null };
					if (download.userId) {
						sseEmitter.broadcastToUser('download:updated', event, download.userId);
					} else {
						sseEmitter.broadcast('download:updated', event);
					}
				} else {
					const videoId = await this.getVideoIdForDownload(download.id);
					if (videoId) {
						await prisma.archive.deleteMany({ where: { videoId } });
					}

					await prisma.download.delete({ where: { id: download.id } });

					if (download.userId) {
						sseEmitter.broadcastToUser(
							'download:deleted',
							{ id: download.id, reason: 'file_missing' },
							download.userId,
						);
					} else {
						sseEmitter.broadcast('download:deleted', { id: download.id, reason: 'file_missing' });
					}
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

		// Jellyfin scan
		if (settings.jellyfinUrl && settings.jellyfinApiKey) {
			try {
				const url = `${settings.jellyfinUrl.replace(/\/$/, '')}/Library/Refresh`;
				await internalFetch(url, {
					method: 'POST',
					headers: {
						'X-Emby-Token': settings.jellyfinApiKey,
					},
				});
			} catch (error) {
				console.error('[LibraryService] Jellyfin scan failed:', error);
			}
		}

		// Plex scan
		if (settings.plexUrl && settings.plexToken) {
			plexService.notifyLibraryScan(settings.plexUrl, settings.plexToken).catch((error) => {
				console.error('[LibraryService] Plex scan failed:', error);
			});
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
