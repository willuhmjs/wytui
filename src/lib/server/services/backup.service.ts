import { prisma } from '$lib/server/db';
import * as fs from 'fs/promises';
import { join } from 'path';

class BackupService {
	/**
	 * Create a backup of all application data
	 */
	async createBackup(type: 'manual' | 'scheduled' = 'manual') {
		const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
		const backupPath = settings?.backupPath || '/backups';

		// Ensure backup directory exists
		await fs.mkdir(backupPath, { recursive: true });

		// Export all tables as JSON
		const [
			users,
			downloads,
			profiles,
			settingsData,
			subscriptions,
			monitors,
			watchProgress,
			playlists,
			playlistItems,
			channelOverrides,
		] = await Promise.all([
			prisma.user.findMany(),
			prisma.download.findMany(),
			prisma.downloadProfile.findMany(),
			prisma.settings.findMany(),
			prisma.subscription.findMany(),
			prisma.monitor.findMany(),
			prisma.watchProgress.findMany(),
			prisma.playlist.findMany(),
			prisma.playlistItem.findMany(),
			prisma.channelOverride.findMany(),
		]);

		const data = {
			version: 1,
			createdAt: new Date().toISOString(),
			users,
			downloads,
			profiles,
			settings: settingsData,
			subscriptions,
			monitors,
			watchProgress,
			playlists,
			playlistItems,
			channelOverrides,
		};

		// Create timestamped filename
		const timestamp = new Date()
			.toISOString()
			.replace(/:/g, '-')
			.replace(/\.\d+Z$/, '');
		const filename = `wytui-backup-${timestamp}.json`;
		const filepath = join(backupPath, filename);

		// Serialize with BigInt handling
		const jsonContent = JSON.stringify(
			data,
			(_key, value) => {
				if (typeof value === 'bigint') {
					return value.toString();
				}
				return value;
			},
			2,
		);

		await fs.writeFile(filepath, jsonContent, 'utf-8');

		// Get file size
		const stats = await fs.stat(filepath);
		const sizeBytes = BigInt(stats.size);

		// Create backup record
		const backup = await prisma.backup.create({
			data: {
				filename,
				filepath,
				sizeBytes,
				type,
			},
		});

		return {
			...backup,
			sizeBytes: backup.sizeBytes.toString(),
		};
	}

	/**
	 * List all backups ordered by creation date (newest first)
	 */
	async listBackups() {
		const backups = await prisma.backup.findMany({
			orderBy: { createdAt: 'desc' },
		});

		return backups.map((b) => ({
			...b,
			sizeBytes: b.sizeBytes.toString(),
		}));
	}

	/**
	 * Get a single backup by ID
	 */
	async getBackup(id: string) {
		const backup = await prisma.backup.findUnique({ where: { id } });
		if (!backup) return null;

		return {
			...backup,
			sizeBytes: backup.sizeBytes.toString(),
		};
	}

	/**
	 * Delete a backup (file + DB record)
	 */
	async deleteBackup(id: string) {
		const backup = await prisma.backup.findUnique({ where: { id } });
		if (!backup) throw new Error('Backup not found');

		// Try to delete the file, ignore if missing
		try {
			await fs.unlink(backup.filepath);
		} catch {
			// File may already be gone
		}

		await prisma.backup.delete({ where: { id } });
	}

	/**
	 * Restore application data from a backup file
	 */
	async restoreBackup(filepath: string) {
		const content = await fs.readFile(filepath, 'utf-8');
		const data = JSON.parse(content);

		// Validate structure
		const requiredKeys = [
			'users',
			'downloads',
			'profiles',
			'settings',
			'subscriptions',
			'monitors',
			'watchProgress',
			'playlists',
			'playlistItems',
			'channelOverrides',
		];
		for (const key of requiredKeys) {
			if (!(key in data)) {
				throw new Error(`Invalid backup file: missing "${key}" key`);
			}
		}

		// Convert string BigInts back to BigInt where needed
		const convertBigInts = (records: any[], fields: string[]) => {
			return records.map((r: any) => {
				const converted = { ...r };
				for (const field of fields) {
					if (converted[field] !== null && converted[field] !== undefined) {
						converted[field] = BigInt(converted[field]);
					}
				}
				return converted;
			});
		};

		const downloads = convertBigInts(data.downloads, ['filesize', 'downloadedBytes', 'totalBytes']);
		const settingsRecords = convertBigInts(data.settings, ['cacheQuotaBytes']);

		await prisma.$transaction(async (tx) => {
			// Delete all existing data in correct order to avoid FK violations
			await tx.playlistItem.deleteMany();
			await tx.playlist.deleteMany();
			await tx.watchProgress.deleteMany();
			await tx.channelOverride.deleteMany();
			await tx.download.deleteMany();
			await tx.downloadProfile.deleteMany();
			await tx.subscription.deleteMany();
			await tx.monitor.deleteMany();
			await tx.user.deleteMany();
			// Skip Settings — do not delete

			// Insert all data back
			if (data.users.length > 0) {
				await tx.user.createMany({ data: data.users });
			}
			if (data.profiles.length > 0) {
				await tx.downloadProfile.createMany({ data: data.profiles });
			}
			if (data.subscriptions.length > 0) {
				await tx.subscription.createMany({ data: data.subscriptions });
			}
			if (data.monitors.length > 0) {
				await tx.monitor.createMany({ data: data.monitors });
			}
			if (downloads.length > 0) {
				await tx.download.createMany({ data: downloads });
			}
			if (data.watchProgress.length > 0) {
				await tx.watchProgress.createMany({ data: data.watchProgress });
			}
			if (data.playlists.length > 0) {
				await tx.playlist.createMany({ data: data.playlists });
			}
			if (data.playlistItems.length > 0) {
				await tx.playlistItem.createMany({ data: data.playlistItems });
			}
			if (data.channelOverrides.length > 0) {
				await tx.channelOverride.createMany({ data: data.channelOverrides });
			}

			// Restore settings (update singleton, don't recreate)
			if (settingsRecords.length > 0) {
				const s = settingsRecords[0];
				const { id, ...settingsData } = s;
				await tx.settings.update({
					where: { id: 'singleton' },
					data: settingsData,
				});
			}
		});

		return { restored: true };
	}
}

export const backupService = new BackupService();
