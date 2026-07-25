import { prisma } from '../db';
import { Prisma } from '@prisma/client';

class SearchService {
	/**
	 * Sanitize search query for PostgreSQL tsquery format.
	 * Removes special FTS characters and converts to & (AND) operator format.
	 */
	private sanitizeQuery(query: string): string {
		return query
			.trim()
			.replace(/[&|!():*]/g, ' ')
			.split(/\s+/)
			.filter((word) => word.length > 0)
			.join(' & ');
	}
	async search(
		query: string,
		userId: string,
		options: {
			limit?: number;
			offset?: number;
			videoType?: string;
			storagePool?: string;
			uploader?: string;
			watchState?: 'watched' | 'unwatched' | 'in_progress';
			minHeight?: number;
			maxHeight?: number;
			dateFrom?: Date;
			dateTo?: Date;
		} = {},
	) {
		// Try full-text search first, fall back to LIKE on error
		try {
			return await this.fullTextSearch(query, userId, options);
		} catch (error) {
			console.error('[Search] Full-text search failed, falling back to LIKE:', error);
			return await this.likeSearch(query, userId, options);
		}
	}

	/**
	 * PostgreSQL full-text search with ts_rank ranking.
	 */
	private async fullTextSearch(
		query: string,
		userId: string,
		options: {
			limit?: number;
			offset?: number;
			videoType?: string;
			storagePool?: string;
			uploader?: string;
			watchState?: 'watched' | 'unwatched' | 'in_progress';
			minHeight?: number;
			maxHeight?: number;
			dateFrom?: Date;
			dateTo?: Date;
		} = {},
	) {
		const {
			limit = 20,
			offset = 0,
			videoType,
			storagePool,
			uploader,
			watchState,
			minHeight,
			maxHeight,
			dateFrom,
			dateTo,
		} = options;

		const sanitized = this.sanitizeQuery(query);

		// Build WHERE conditions as parameterized Prisma.Sql fragments
		const conditions: Prisma.Sql[] = [
			Prisma.sql`d."userId" = ${userId}`,
			Prisma.sql`d.status = 'COMPLETED'`,
			Prisma.sql`d.search_vector @@ to_tsquery('english', ${sanitized})`,
		];

		if (videoType) {
			conditions.push(Prisma.sql`d."videoType" = ${videoType}`);
		}
		if (storagePool) {
			conditions.push(Prisma.sql`d."storagePool" = ${storagePool}`);
		}
		if (uploader) {
			conditions.push(Prisma.sql`d.uploader ILIKE ${'%' + uploader + '%'}`);
		}
		if (minHeight !== undefined) {
			conditions.push(Prisma.sql`d.height >= ${minHeight}`);
		}
		if (maxHeight !== undefined) {
			conditions.push(Prisma.sql`d.height <= ${maxHeight}`);
		}
		if (dateFrom) {
			conditions.push(Prisma.sql`d."createdAt" >= ${dateFrom}`);
		}
		if (dateTo) {
			const endOfDay = new Date(dateTo);
			endOfDay.setHours(23, 59, 59, 999);
			conditions.push(Prisma.sql`d."createdAt" <= ${endOfDay}`);
		}

		// Handle watchState with subquery
		if (watchState === 'watched') {
			conditions.push(Prisma.sql`EXISTS (
				SELECT 1 FROM watch_progress wp
				WHERE wp."downloadId" = d.id
				AND wp."userId" = ${userId}
				AND wp.watched = true
			)`);
		} else if (watchState === 'unwatched') {
			conditions.push(Prisma.sql`NOT EXISTS (
				SELECT 1 FROM watch_progress wp
				WHERE wp."downloadId" = d.id
				AND wp."userId" = ${userId}
				AND (wp.watched = true OR wp.position > 0)
			)`);
		} else if (watchState === 'in_progress') {
			conditions.push(Prisma.sql`EXISTS (
				SELECT 1 FROM watch_progress wp
				WHERE wp."downloadId" = d.id
				AND wp."userId" = ${userId}
				AND wp.watched = false
				AND wp.position > 0
			)`);
		}

		const whereClause = Prisma.join(conditions, ' AND ');

		// Execute FTS query with ranking
		const results = await prisma.$queryRaw<any[]>`
			SELECT
				d.id,
				d.url,
				d.status,
				d.title,
				d.thumbnail,
				d.duration,
				d.uploader,
				d."channelUrl",
				d."uploadDate",
				d.format,
				d.filesize,
				d.height,
				d."videoType",
				d.description,
				d.category,
				d.tags,
				d."dislikeCount",
				d."videoId",
				d.artist,
				d.album,
				d."trackNumber",
				d."releaseYear",
				d."musicBrainzId",
				d.progress,
				d.speed,
				d.eta,
				d."downloadedBytes",
				d."totalBytes",
				d.filename,
				d.filepath,
				d."customFlags",
				d.error,
				d."retryCount",
				d."profileId",
				d."userId",
				d."storagePool",
				d."subscriptionId",
				d."createdAt",
				d."updatedAt",
				d."startedAt",
				d."completedAt",
				d."allWatchedAt",
				ts_rank(d.search_vector, to_tsquery('english', ${sanitized})) as rank
			FROM downloads d
			WHERE ${whereClause}
			ORDER BY rank DESC, d."completedAt" DESC
			LIMIT ${limit}
			OFFSET ${offset}
		`;

		// Get total count
		const countResult = await prisma.$queryRaw<[{ count: bigint }]>`
			SELECT COUNT(*)::int as count
			FROM downloads d
			WHERE ${whereClause}
		`;
		const total = Number(countResult[0]?.count ?? 0);

		// Search subtitles in parallel
		const subtitleData = await this.searchSubtitlesFTS(query, userId, { storagePool, uploader });

		return {
			results: results.map((r) => ({
				...r,
				filesize: r.filesize?.toString() ?? null,
				downloadedBytes: r.downloadedBytes?.toString() ?? null,
				totalBytes: r.totalBytes?.toString() ?? null,
				uploadDate: r.uploadDate ? new Date(r.uploadDate) : null,
				createdAt: new Date(r.createdAt),
				updatedAt: new Date(r.updatedAt),
				startedAt: r.startedAt ? new Date(r.startedAt) : null,
				completedAt: r.completedAt ? new Date(r.completedAt) : null,
				allWatchedAt: r.allWatchedAt ? new Date(r.allWatchedAt) : null,
			})),
			total,
			subtitleMatches: subtitleData.results,
			subtitleTotal: subtitleData.total,
		};
	}

	/**
	 * LIKE-based search fallback (original implementation).
	 */
	private async likeSearch(
		query: string,
		userId: string,
		options: {
			limit?: number;
			offset?: number;
			videoType?: string;
			storagePool?: string;
			uploader?: string;
			watchState?: 'watched' | 'unwatched' | 'in_progress';
			minHeight?: number;
			maxHeight?: number;
			dateFrom?: Date;
			dateTo?: Date;
		} = {},
	) {
		const {
			limit = 20,
			offset = 0,
			videoType,
			storagePool,
			uploader,
			watchState,
			minHeight,
			maxHeight,
			dateFrom,
			dateTo,
		} = options;

		const where: any = {
			userId,
			status: 'COMPLETED',
			OR: [
				{ title: { contains: query, mode: 'insensitive' } },
				{ description: { contains: query, mode: 'insensitive' } },
				{ uploader: { contains: query, mode: 'insensitive' } },
			],
		};

		if (videoType) {
			where.videoType = videoType;
		}
		if (storagePool) {
			where.storagePool = storagePool;
		}
		if (uploader) {
			where.AND = [{ OR: where.OR }, { uploader: { contains: uploader, mode: 'insensitive' } }];
			delete where.OR;
		}

		if (watchState) {
			switch (watchState) {
				case 'watched':
					where.watchProgress = {
						some: { userId, watched: true },
					};
					break;
				case 'unwatched':
					where.NOT = {
						...(where.NOT || {}),
						watchProgress: {
							some: {
								userId,
								OR: [{ watched: true }, { position: { gt: 0 } }],
							},
						},
					};
					break;
				case 'in_progress':
					where.watchProgress = {
						some: { userId, watched: false, position: { gt: 0 } },
					};
					break;
			}
		}

		// Resolution (height) filters
		if (minHeight || maxHeight) {
			where.height = {};
			if (minHeight) where.height.gte = minHeight;
			if (maxHeight) where.height.lte = maxHeight;
		}

		// Date range filters
		if (dateFrom || dateTo) {
			where.createdAt = {};
			if (dateFrom) where.createdAt.gte = dateFrom;
			if (dateTo) {
				const endOfDay = new Date(dateTo);
				endOfDay.setHours(23, 59, 59, 999);
				where.createdAt.lte = endOfDay;
			}
		}

		// Run download search and subtitle search in parallel
		const [results, total, subtitleData] = await Promise.all([
			prisma.download.findMany({
				where,
				take: limit,
				skip: offset,
				orderBy: { completedAt: 'desc' },
			}),
			prisma.download.count({ where }),
			this.searchSubtitles(query, userId, { storagePool, uploader }),
		]);

		return {
			results: results.map((r) => ({
				...r,
				filesize: r.filesize?.toString() ?? null,
				downloadedBytes: r.downloadedBytes?.toString() ?? null,
				totalBytes: r.totalBytes?.toString() ?? null,
			})),
			total,
			subtitleMatches: subtitleData.results,
			subtitleTotal: subtitleData.total,
		};
	}

	/**
	 * Full-text search within subtitle text using PostgreSQL tsvector.
	 * Returns matching lines grouped by download.
	 */
	private async searchSubtitlesFTS(
		query: string,
		userId: string,
		filters: {
			storagePool?: string;
			uploader?: string;
		} = {},
	) {
		const sanitized = this.sanitizeQuery(query);

		// Build WHERE conditions as parameterized Prisma.Sql fragments
		const conditions: Prisma.Sql[] = [
			Prisma.sql`d."userId" = ${userId}`,
			Prisma.sql`d.status = 'COMPLETED'`,
			Prisma.sql`sl.search_vector @@ to_tsquery('english', ${sanitized})`,
		];

		if (filters.storagePool) {
			conditions.push(Prisma.sql`d."storagePool" = ${filters.storagePool}`);
		}
		if (filters.uploader) {
			conditions.push(Prisma.sql`d.uploader ILIKE ${'%' + filters.uploader + '%'}`);
		}

		const whereClause = Prisma.join(conditions, ' AND ');

		// Execute FTS query with ranking
		const results = await prisma.$queryRaw<any[]>`
			SELECT
				sl.id,
				sl."downloadId",
				sl."startTime",
				sl."endTime",
				sl.text,
				sl.lang,
				d.id as "download_id",
				d.title as "download_title",
				d.thumbnail as "download_thumbnail",
				d.uploader as "download_uploader",
				d.duration as "download_duration",
				ts_rank(sl.search_vector, to_tsquery('english', ${sanitized})) as rank
			FROM subtitle_lines sl
			INNER JOIN downloads d ON sl."downloadId" = d.id
			WHERE ${whereClause}
			ORDER BY rank DESC, sl."startTime" ASC
			LIMIT 30
		`;

		// Get total count
		const countResult = await prisma.$queryRaw<[{ count: bigint }]>`
			SELECT COUNT(*)::int as count
			FROM subtitle_lines sl
			INNER JOIN downloads d ON sl."downloadId" = d.id
			WHERE ${whereClause}
		`;
		const total = Number(countResult[0]?.count ?? 0);

		return {
			results: results.map((r) => ({
				id: r.id,
				downloadId: r.downloadId,
				startTime: r.startTime,
				endTime: r.endTime,
				text: r.text,
				lang: r.lang,
				download: {
					id: r.download_id,
					title: r.download_title,
					thumbnail: r.download_thumbnail,
					uploader: r.download_uploader,
					duration: r.download_duration,
				},
			})),
			total,
		};
	}

	/**
	 * LIKE-based subtitle search fallback.
	 * Returns matching lines grouped by download.
	 */
	private async searchSubtitles(
		query: string,
		userId: string,
		filters: {
			storagePool?: string;
			uploader?: string;
		} = {},
	) {
		const downloadWhere: any = {
			userId,
			status: 'COMPLETED',
		};
		if (filters.storagePool) {
			downloadWhere.storagePool = filters.storagePool;
		}
		if (filters.uploader) {
			downloadWhere.uploader = { contains: filters.uploader, mode: 'insensitive' };
		}

		const [results, total] = await Promise.all([
			prisma.subtitleLine.findMany({
				where: {
					text: { contains: query, mode: 'insensitive' },
					download: downloadWhere,
				},
				include: {
					download: {
						select: {
							id: true,
							title: true,
							thumbnail: true,
							uploader: true,
							duration: true,
						},
					},
				},
				take: 30,
				orderBy: { startTime: 'asc' },
			}),
			prisma.subtitleLine.count({
				where: {
					text: { contains: query, mode: 'insensitive' },
					download: downloadWhere,
				},
			}),
		]);

		return {
			results: results.map((m) => ({
				id: m.id,
				downloadId: m.downloadId,
				startTime: m.startTime,
				endTime: m.endTime,
				text: m.text,
				lang: m.lang,
				download: m.download,
			})),
			total,
		};
	}
}

export const searchService = new SearchService();
