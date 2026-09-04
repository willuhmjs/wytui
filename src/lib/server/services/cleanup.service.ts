import { prisma } from '../db';
import { DownloadStatus } from '@prisma/client';
import { unlink } from 'fs/promises';
import { setTimeout as delay } from 'timers/promises';
import { basename } from 'path';
import { libraryService } from './library.service';
import { sseEmitter } from '../sse/emitter';
import { internalFetch } from '../utils/fetch';

class CleanupService {
	private running = false;

	async runCleanup(): Promise<void> {
		if (this.running) return;
		this.running = true;

		try {
			await this.doCleanup();
		} finally {
			this.running = false;
		}
	}

	private async doCleanup(): Promise<void> {
		const settings = await prisma.settings.findUnique({
			where: { id: 'singleton' },
		});

		if (!settings?.cleanupEnabled || !settings.jellyfinUrl || !settings.jellyfinApiKey) return;
		if (settings.cleanupUserIds.length === 0) return;

		const profileFilter = this.buildProfileFilter(settings.cleanupProfileTypes);
		if (!profileFilter) return;

		const downloads = await prisma.download.findMany({
			where: {
				status: DownloadStatus.COMPLETED,
				storagePool: 'library',
				filepath: { not: null },
				profile: profileFilter,
			},
			include: { profile: true },
		});

		if (downloads.length === 0) return;

		const baseUrl = settings.jellyfinUrl.replace(/\/$/, '');
		const apiKey = settings.jellyfinApiKey;
		let cleanedCount = 0;

		for (const download of downloads) {
			try {
				const wasCleaned = await this.processDownload(
					download,
					baseUrl,
					apiKey,
					settings.cleanupUserIds,
					settings.cleanupGraceHours,
				);
				if (wasCleaned) cleanedCount++;
			} catch (e) {
				console.error(`[Cleanup] Failed to process download ${download.id}:`, e);
			}

			await delay(200);
		}

		if (cleanedCount > 0) {
			console.log(`[Cleanup] Cleaned ${cleanedCount} items`);
			await libraryService.triggerLibraryScan();
		}
	}

	private async processDownload(
		download: any,
		baseUrl: string,
		apiKey: string,
		userIds: string[],
		graceHours: number,
	): Promise<boolean> {
		const filename = basename(download.filepath!);
		const jellyfinItemId = await this.findJellyfinItem(
			baseUrl,
			apiKey,
			filename,
			download.filepath!,
		);

		if (!jellyfinItemId) return false;

		const allWatched = await this.checkAllUsersWatched(baseUrl, apiKey, jellyfinItemId, userIds);

		if (allWatched && !download.allWatchedAt) {
			await prisma.download.update({
				where: { id: download.id },
				data: { allWatchedAt: new Date() },
			});
			console.log(`[Cleanup] All users watched "${download.title}" — grace period started`);
			return false;
		} else if (allWatched && download.allWatchedAt) {
			const graceExpiry = new Date(download.allWatchedAt.getTime() + graceHours * 60 * 60 * 1000);
			if (new Date() >= graceExpiry) {
				await this.deleteItem(download, baseUrl, apiKey, jellyfinItemId);
				return true;
			}
		} else if (!allWatched && download.allWatchedAt) {
			await prisma.download.update({
				where: { id: download.id },
				data: { allWatchedAt: null },
			});
			console.log(`[Cleanup] Watch status reset for "${download.title}"`);
		}

		return false;
	}

	private async findJellyfinItem(
		baseUrl: string,
		apiKey: string,
		filename: string,
		filepath: string,
	): Promise<string | null> {
		const searchTerm = filename.replace(/\.[^.]+$/, '');
		const res = await internalFetch(
			`${baseUrl}/Items?searchTerm=${encodeURIComponent(searchTerm)}&Recursive=true&Fields=Path&Limit=25`,
			{
				headers: { 'X-Emby-Token': apiKey },
				signal: AbortSignal.timeout(15000),
			},
		);

		if (!res.ok) return null;

		const data = await res.json();
		const items = data.Items || [];

		for (const item of items) {
			if (item.Path && item.Path === filepath) {
				return item.Id;
			}
		}

		return null;
	}

	private async checkAllUsersWatched(
		baseUrl: string,
		apiKey: string,
		itemId: string,
		userIds: string[],
	): Promise<boolean> {
		for (const userId of userIds) {
			const res = await internalFetch(`${baseUrl}/Users/${userId}/Items/${itemId}/UserData`, {
				headers: { 'X-Emby-Token': apiKey },
				signal: AbortSignal.timeout(10000),
			});

			if (!res.ok) return false;

			const userData = await res.json();
			if (!userData.Played) return false;

			await delay(100);
		}

		return true;
	}

	private async deleteItem(
		download: any,
		baseUrl: string,
		apiKey: string,
		jellyfinItemId: string,
	): Promise<void> {
		try {
			await unlink(download.filepath!);
		} catch (e) {
			console.error(`[Cleanup] Failed to delete file ${download.filepath}:`, e);
			return;
		}
		// Remove the video's sidecars and now-empty artwork folder so watched
		// deletions don't leave artwork-only husks in the library.
		await libraryService.removeVideoArtifacts(download.filepath!);

		try {
			const res = await internalFetch(`${baseUrl}/Items/${jellyfinItemId}`, {
				method: 'DELETE',
				headers: { 'X-Emby-Token': apiKey },
				signal: AbortSignal.timeout(10000),
			});
			if (!res.ok) {
				console.warn(`[Cleanup] Jellyfin DELETE returned ${res.status} for item ${jellyfinItemId}`);
			}
		} catch (e) {
			console.warn(`[Cleanup] Failed to delete from Jellyfin:`, e);
		}

		await prisma.download.update({
			where: { id: download.id },
			data: {
				status: DownloadStatus.DELETED,
				filepath: null,
			},
		});

		if (download.userId) {
			sseEmitter.broadcastToUser(
				'download:updated',
				{
					id: download.id,
					status: 'DELETED',
					filepath: null,
				},
				download.userId,
			);
		} else {
			sseEmitter.broadcast('download:updated', {
				id: download.id,
				status: 'DELETED',
				filepath: null,
			});
		}

		console.log(`[Cleanup] Deleted "${download.title}" from disk and Jellyfin`);
	}

	private buildProfileFilter(profileTypes: string[]): any {
		if (profileTypes.length === 0) return null;

		const hasVideo = profileTypes.includes('video');
		const hasMusic = profileTypes.includes('music');

		if (hasVideo && hasMusic) return {};
		if (hasVideo) return { audioOnly: false };
		if (hasMusic) return { audioOnly: true };
		return null;
	}
}

export const cleanupService = new CleanupService();
