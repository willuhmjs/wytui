import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { libraryService } from '$lib/server/services/library.service';
import { queueService } from '$lib/server/services/queue.service';
import { sseEmitter } from '$lib/server/sse/emitter';
import { statfs } from 'fs/promises';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.session?.user?.id) {
		throw error(401, 'Authentication required');
	}

	const settings = await prisma.settings.findUnique({
		where: { id: 'singleton' },
		select: {
			ytdlpVersion: true,
			maxConcurrentDownloads: true,
			downloadPath: true,
		},
	});

	const [
		cacheUsage,
		libraryUsage,
		downloadCounts,
		subscriptionTotal,
		subscriptionActive,
		monitorTotal,
		monitorEnabled,
		monitorLive,
	] = await Promise.all([
		libraryService.getCacheUsage(),
		libraryService.getLibraryUsage(),
		prisma.download.groupBy({ by: ['status'], _count: true }),
		prisma.subscription.count(),
		prisma.subscription.count({ where: { enabled: true } }),
		prisma.monitor.count(),
		prisma.monitor.count({ where: { enabled: true } }),
		prisma.monitor.count({ where: { isLive: true } }),
	]);

	const statusMap: Record<string, number> = {};
	for (const row of downloadCounts) {
		statusMap[row.status] = row._count;
	}

	let disk: { totalBytes: string; availableBytes: string; percentage: number } | null = null;
	try {
		const downloadPath = settings?.downloadPath || '/downloads';
		const stats = await statfs(downloadPath);
		const totalBytes = stats.bsize * stats.blocks;
		const availableBytes = stats.bsize * stats.bavail;
		const usedBytes = totalBytes - availableBytes;
		const percentage = totalBytes > 0 ? Math.round((Number(usedBytes) / Number(totalBytes)) * 100) : 0;
		disk = {
			totalBytes: String(totalBytes),
			availableBytes: String(availableBytes),
			percentage,
		};
	} catch {}

	const queueStats = queueService.getStats();

	return json({
		connection: {
			sseClients: sseEmitter.getClientCount(),
		},
		downloads: {
			active: (statusMap['DOWNLOADING'] || 0) + (statusMap['PROCESSING'] || 0) + (statusMap['FETCHING_INFO'] || 0),
			queued: statusMap['PENDING'] || 0,
			completed: statusMap['COMPLETED'] || 0,
			failed: statusMap['FAILED'] || 0,
		},
		queue: {
			metadata: queueStats.metadata,
			downloads: queueStats.downloads,
			active: queueStats.active,
			maxConcurrent: queueService.getMaxConcurrent(),
		},
		storage: {
			cache: cacheUsage,
			library: libraryUsage,
			disk,
		},
		system: {
			ytdlpVersion: settings?.ytdlpVersion || null,
			uptimeMs: Math.floor(process.uptime() * 1000),
		},
		subscriptions: {
			total: subscriptionTotal,
			active: subscriptionActive,
		},
		monitors: {
			total: monitorTotal,
			enabled: monitorEnabled,
			live: monitorLive,
		},
	});
};
