import { prisma } from '$lib/server/db';
import * as fs from 'fs/promises';

export interface RescanReport {
	missing: { id: string; title: string | null; filepath: string }[];
	ok: number;
}

class RescanService {
	/**
	 * Scan all COMPLETED downloads and check whether their files still exist on disk.
	 */
	async rescan(): Promise<RescanReport> {
		const downloads = await prisma.download.findMany({
			where: {
				status: 'COMPLETED',
				filepath: { not: null },
			},
			select: {
				id: true,
				title: true,
				filepath: true,
			},
		});

		const missing: RescanReport['missing'] = [];
		let ok = 0;

		await Promise.all(
			downloads.map(async (dl: { id: string; title: string | null; filepath: string | null }) => {
				try {
					await fs.access(dl.filepath!);
					ok++;
				} catch {
					missing.push({ id: dl.id, title: dl.title, filepath: dl.filepath! });
				}
			}),
		);

		return { missing, ok };
	}

	/**
	 * Reconcile missing files by either marking them as DELETED or removing the DB records entirely.
	 */
	async reconcile(actions: { markMissing?: string[]; deleteRecords?: string[] }) {
		let marked = 0;
		let deleted = 0;

		if (actions.markMissing && actions.markMissing.length > 0) {
			const result = await prisma.download.updateMany({
				where: { id: { in: actions.markMissing } },
				data: { status: 'DELETED' },
			});
			marked = result.count;
		}

		if (actions.deleteRecords && actions.deleteRecords.length > 0) {
			// Delete related records first to avoid FK violations
			await prisma.watchProgress.deleteMany({
				where: { downloadId: { in: actions.deleteRecords } },
			});
			await prisma.playlistItem.deleteMany({
				where: { downloadId: { in: actions.deleteRecords } },
			});
			const result = await prisma.download.deleteMany({
				where: { id: { in: actions.deleteRecords } },
			});
			deleted = result.count;
		}

		return { marked, deleted };
	}
}

export const rescanService = new RescanService();
