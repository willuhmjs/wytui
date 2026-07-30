import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { DownloadStatus } from '@prisma/client';
import { apiRoute } from '$lib/server/openapi';
import { requireAdmin } from '$lib/server/guards';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/analytics',
	'GET',
	{
		summary: 'Get analytics data',
		tags: ['System'],
		auth: 'admin',
		responses: {
			200: {
				description: 'Analytics overview with download stats, storage, and trends',
				schema: {
					type: 'object',
					properties: {
						overview: {
							type: 'object',
							properties: {
								totalDownloads: { type: 'integer' },
								completedDownloads: { type: 'integer' },
								failedDownloads: { type: 'integer' },
								activeDownloads: { type: 'integer' },
								successRate: { type: 'number' },
							},
						},
						storage: {
							type: 'object',
							properties: {
								cacheBytes: { type: 'string' },
								libraryBytes: { type: 'string' },
								totalBytes: { type: 'string' },
								cacheQuotaBytes: { type: 'string' },
							},
						},
						downloadsPerDay: {
							type: 'array',
							items: {
								type: 'object',
								properties: { date: { type: 'string' }, count: { type: 'integer' } },
							},
						},
						topUploaders: {
							type: 'array',
							items: {
								type: 'object',
								properties: { uploader: { type: 'string' }, count: { type: 'integer' } },
							},
						},
						activeSubscriptions: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									id: { type: 'string' },
									name: { type: 'string' },
									downloadCount: { type: 'integer' },
								},
							},
						},
						avgFilesize: { type: 'number' },
						downloadsByFormat: {
							type: 'array',
							items: {
								type: 'object',
								properties: { format: { type: 'string' }, count: { type: 'integer' } },
							},
						},
					},
				},
			},
		},
	},
	async ({ locals }) => {
		try {
			requireAdmin(locals);

			// Total downloads by status
			const totalDownloads = await prisma.download.count();
			const completedDownloads = await prisma.download.count({
				where: { status: DownloadStatus.COMPLETED },
			});
			const failedDownloads = await prisma.download.count({
				where: { status: DownloadStatus.FAILED },
			});
			const activeDownloads = await prisma.download.count({
				where: {
					status: {
						in: [
							DownloadStatus.PENDING,
							DownloadStatus.FETCHING_INFO,
							DownloadStatus.DOWNLOADING,
							DownloadStatus.PROCESSING,
						],
					},
				},
			});

			// Storage usage
			const cacheDownloads = await prisma.download.findMany({
				where: {
					storagePool: 'cache',
					status: DownloadStatus.COMPLETED,
					filesize: { not: null },
				},
				select: { filesize: true },
			});

			const libraryDownloads = await prisma.download.findMany({
				where: {
					storagePool: 'library',
					status: DownloadStatus.COMPLETED,
					filesize: { not: null },
				},
				select: { filesize: true },
			});

			const cacheBytes = cacheDownloads.reduce(
				(sum, d) => sum + (d.filesize ? BigInt(d.filesize) : BigInt(0)),
				BigInt(0),
			);

			const libraryBytes = libraryDownloads.reduce(
				(sum, d) => sum + (d.filesize ? BigInt(d.filesize) : BigInt(0)),
				BigInt(0),
			);

			// Downloads per day (last 30 days)
			const thirtyDaysAgo = new Date();
			thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

			// Fetch completed downloads and group by date in application code
			const completedRecentDownloads = await prisma.download.findMany({
				where: {
					status: DownloadStatus.COMPLETED,
					OR: [
						{ completedAt: { gte: thirtyDaysAgo } },
						{
							completedAt: null,
							createdAt: { gte: thirtyDaysAgo },
						},
					],
				},
				select: {
					completedAt: true,
					createdAt: true,
				},
			});

			// Group by date
			const downloadsByDate = new Map<string, number>();
			for (const download of completedRecentDownloads) {
				const date = (download.completedAt || download.createdAt).toISOString().split('T')[0];
				downloadsByDate.set(date, (downloadsByDate.get(date) || 0) + 1);
			}

			// Oldest first, so the chart reads left-to-right chronologically.
			const downloadsPerDay = Array.from(downloadsByDate.entries())
				.map(([date, count]) => ({ date, count }))
				.sort((a, b) => a.date.localeCompare(b.date));

			// Top uploaders
			const topUploaders = await prisma.download.groupBy({
				by: ['uploader'],
				where: {
					status: DownloadStatus.COMPLETED,
					uploader: { not: null },
				},
				_count: { uploader: true },
				orderBy: { _count: { uploader: 'desc' } },
				take: 10,
			});

			// Most active subscriptions
			const activeSubscriptions = await prisma.subscription.findMany({
				where: { enabled: true },
				select: {
					id: true,
					name: true,
					_count: {
						select: { downloads: true },
					},
				},
				orderBy: {
					downloads: { _count: 'desc' },
				},
				take: 10,
			});

			// Average file size
			const completedWithSize = await prisma.download.findMany({
				where: {
					status: DownloadStatus.COMPLETED,
					filesize: { not: null },
				},
				select: { filesize: true },
			});

			const avgFilesize =
				completedWithSize.length > 0
					? completedWithSize.reduce((sum, d) => sum + (d.filesize ? Number(d.filesize) : 0), 0) /
						completedWithSize.length
					: 0;

			// Downloads by format
			const completedWithFilename = await prisma.download.findMany({
				where: {
					status: DownloadStatus.COMPLETED,
					filename: { not: null },
				},
				select: { filename: true },
			});

			// Extract file extensions and count
			const formatCounts = new Map<string, number>();
			for (const download of completedWithFilename) {
				if (!download.filename) continue;
				const match = download.filename.match(/\.([^.]+)$/);
				if (match) {
					const format = match[1].toLowerCase();
					formatCounts.set(format, (formatCounts.get(format) || 0) + 1);
				}
			}

			const downloadsByFormat = Array.from(formatCounts.entries())
				.map(([format, count]) => ({ format, count }))
				.sort((a, b) => b.count - a.count)
				.slice(0, 10);

			// Success rate
			const totalCompleteOrFailed = completedDownloads + failedDownloads;
			const successRate =
				totalCompleteOrFailed > 0 ? (completedDownloads / totalCompleteOrFailed) * 100 : 100;

			// Get settings for quota info
			const settings = await prisma.settings.findUnique({
				where: { id: 'singleton' },
			});

			return json({
				overview: {
					totalDownloads,
					completedDownloads,
					failedDownloads,
					activeDownloads,
					successRate: Math.round(successRate * 10) / 10,
				},
				storage: {
					cacheBytes: cacheBytes.toString(),
					libraryBytes: libraryBytes.toString(),
					totalBytes: (cacheBytes + libraryBytes).toString(),
					cacheQuotaBytes: settings?.cacheQuotaBytes.toString() || '0',
				},
				downloadsPerDay: downloadsPerDay.map((d) => ({
					date: d.date,
					count: d.count,
				})),
				topUploaders: topUploaders.map((u) => ({
					uploader: u.uploader || 'Unknown',
					count: u._count.uploader,
				})),
				activeSubscriptions: activeSubscriptions.map((s) => ({
					id: s.id,
					name: s.name,
					downloadCount: s._count.downloads,
				})),
				avgFilesize,
				downloadsByFormat: downloadsByFormat.map((f) => ({
					format: f.format || 'unknown',
					count: f.count,
				})),
			});
		} catch (e: any) {
			console.error('Failed to get analytics:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
