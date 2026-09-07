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
	 * Reconcile missing files by either marking them as DELETED or removing the DB
	 * records entirely. The missing-files report this acts on can be stale - a
	 * promotion may have moved the file back into place since the scan - so every
	 * file is re-checked immediately before its record is touched; rows whose file
	 * exists again are skipped and reported.
	 */
	async reconcile(actions: { markMissing?: string[]; deleteRecords?: string[] }) {
		let marked = 0;
		let deleted = 0;
		let skipped = 0;

		if (actions.markMissing && actions.markMissing.length > 0) {
			const { missing, found } = await this.partitionStillMissing(actions.markMissing);
			skipped += found.length;
			if (missing.length > 0) {
				const result = await prisma.download.updateMany({
					where: { id: { in: missing } },
					data: { status: 'DELETED' },
				});
				marked = result.count;
			}
		}

		if (actions.deleteRecords && actions.deleteRecords.length > 0) {
			const { missing, found } = await this.partitionStillMissing(actions.deleteRecords);
			skipped += found.length;
			if (missing.length > 0) {
				// Delete related records first to avoid FK violations
				await prisma.watchProgress.deleteMany({
					where: { downloadId: { in: missing } },
				});
				await prisma.playlistItem.deleteMany({
					where: { downloadId: { in: missing } },
				});
				const result = await prisma.download.deleteMany({
					where: { id: { in: missing } },
				});
				deleted = result.count;
			}
		}

		return { marked, deleted, skipped };
	}

	/**
	 * Split ids into those whose file is confirmed missing and those that exist
	 * again (a promotion completed, or the scan's report was stale).
	 */
	private async partitionStillMissing(
		ids: string[],
	): Promise<{ missing: string[]; found: string[] }> {
		const rows = await prisma.download.findMany({
			where: { id: { in: ids } },
			select: { id: true, filepath: true },
		});
		const missing: string[] = [];
		const found: string[] = [];
		for (const row of rows) {
			if (!row.filepath) {
				missing.push(row.id);
				continue;
			}
			try {
				await fs.access(row.filepath);
				found.push(row.id);
			} catch {
				missing.push(row.id);
			}
		}
		return { missing, found };
	}
}

export const rescanService = new RescanService();
