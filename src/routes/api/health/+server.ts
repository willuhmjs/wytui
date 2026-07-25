import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { libraryService } from '$lib/server/services/library.service';
import { queueService } from '$lib/server/services/queue.service';
import { sseEmitter } from '$lib/server/sse/emitter';
import { statfs, access } from 'fs/promises';
import { resolve } from 'path';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/health',
	'GET',
	{
		summary: 'Get system health status',
		tags: ['System'],
		auth: true,
		responses: {
			200: {
				description: 'System health including downloads, queue, storage, and uptime',
				schema: {
					type: 'object',
					properties: {
						connection: { type: 'object', properties: { sseClients: { type: 'integer' } } },
						downloads: {
							type: 'object',
							properties: {
								active: { type: 'integer' },
								queued: { type: 'integer' },
								completed: { type: 'integer' },
								failed: { type: 'integer' },
							},
						},
						queue: {
							type: 'object',
							properties: {
								metadata: { type: 'integer' },
								downloads: { type: 'integer' },
								active: { type: 'integer' },
								maxConcurrent: { type: 'integer' },
							},
						},
						storage: {
							type: 'object',
							properties: {
								cache: { type: 'object' },
								totalCache: { type: 'object', nullable: true },
								library: { type: 'object' },
								disk: { type: 'object', nullable: true },
							},
						},
						system: {
							type: 'object',
							properties: {
								ytdlpVersion: { type: 'string', nullable: true },
								uptimeMs: { type: 'integer' },
							},
						},
						subscriptions: {
							type: 'object',
							properties: { total: { type: 'integer' }, active: { type: 'integer' } },
						},
						monitors: {
							type: 'object',
							properties: {
								total: { type: 'integer' },
								enabled: { type: 'integer' },
								live: { type: 'integer' },
							},
						},
					},
				},
			},
		},
	},
	async ({ locals }) => {
		if (!locals.session?.user?.id) {
			throw error(401, 'Authentication required');
		}

		const userId = locals.session.user.id;
		const isAdmin = !!locals.session.user.isAdmin;

		const settings = await prisma.settings.findUnique({
			where: { id: 'singleton' },
			select: {
				ytdlpVersion: true,
				maxConcurrentDownloads: true,
				downloadPath: true,
				statsVisibleToNonAdmins: true,
				showTotalSizeToNonAdmins: true,
			},
		});

		// Admin can hide the stats panel from non-admins entirely.
		if (!isAdmin && settings && !settings.statsVisibleToNonAdmins) {
			throw error(403, 'Stats are not available');
		}

		// Non-admins see their OWN cache usage; global disk/library totals are gated.
		const showTotals = isAdmin || !!settings?.showTotalSizeToNonAdmins;

		const [
			cacheUsage,
			totalCacheUsage,
			libraryUsage,
			downloadCounts,
			subscriptionTotal,
			subscriptionActive,
			monitorTotal,
			monitorEnabled,
			monitorLive,
		] = await Promise.all([
			// Always the requester's OWN cache usage vs their per-user limit.
			libraryService.getCacheUsage(userId),
			// Global total cache usage — gated like other totals (admins always).
			showTotals ? libraryService.getTotalCacheUsage() : Promise.resolve(null),
			showTotals ? libraryService.getLibraryUsage() : Promise.resolve(null),
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

		let disk: { totalBytes: string; usedBytes: string; percentage: number } | null = null;
		try {
			if (!showTotals) throw new Error('totals hidden');
			const downloadPath = resolve(settings?.downloadPath || '/downloads');
			await access(downloadPath);
			const stats = await statfs(downloadPath);
			const totalBytes = stats.bsize * stats.blocks;
			const availableBytes = stats.bsize * stats.bavail;
			const usedBytes = totalBytes - availableBytes;
			const percentage =
				totalBytes > 0 ? Math.round((Number(usedBytes) / Number(totalBytes)) * 100) : 0;
			disk = {
				totalBytes: String(totalBytes),
				usedBytes: String(usedBytes),
				percentage,
			};
		} catch (e) {
			if (!(e instanceof Error && e.message === 'totals hidden')) {
				console.warn('Failed to read disk stats:', e instanceof Error ? e.message : e);
			}
		}

		const queueStats = queueService.getStats();

		return json({
			connection: {
				sseClients: sseEmitter.getClientCount(),
			},
			downloads: {
				active:
					(statusMap['DOWNLOADING'] || 0) +
					(statusMap['PROCESSING'] || 0) +
					(statusMap['FETCHING_INFO'] || 0),
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
				totalCache: totalCacheUsage,
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
	},
) satisfies RequestHandler;
