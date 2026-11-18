import { json, error } from '@sveltejs/kit';
import { downloadService } from '$lib/server/services/download.service';
import type { DownloadListFilters, DownloadListSort } from '$lib/server/services/download.service';
import { prisma } from '$lib/server/db';
import { apiRoute } from '$lib/server/openapi';
import { checkUrlHost, describeUrlHostCheck } from '$lib/server/utils/ssrf-guard';
import type { RequestHandler } from './$types';

const LIST_SORTS: readonly DownloadListSort[] = [
	'newest',
	'oldest',
	'largest',
	'smallest',
	'longest',
	'shortest',
	'uploader',
];

export const POST = apiRoute(
	'/api/downloads',
	'POST',
	{
		summary: 'Create a new download',
		tags: ['Downloads'],
		auth: true,
		body: {
			url: { type: 'string', required: true, description: 'URL to download' },
			profileId: { type: 'string', required: true, description: 'Download profile ID' },
			saveToLibrary: { type: 'boolean', description: 'Save to library instead of cache' },
			customFlags: { type: 'array', description: 'Custom yt-dlp flags' },
		},
		responses: {
			201: {
				description: 'Created download object',
				schema: {
					type: 'object',
					properties: {
						id: { type: 'string' },
						url: { type: 'string' },
						status: {
							type: 'string',
							enum: [
								'PENDING',
								'FETCHING_INFO',
								'DOWNLOADING',
								'PROCESSING',
								'COMPLETED',
								'FAILED',
								'CANCELLED',
								'DELETED',
							],
						},
						title: { type: 'string', nullable: true },
						thumbnail: { type: 'string', nullable: true },
						duration: { type: 'integer', nullable: true },
						uploader: { type: 'string', nullable: true },
						progress: { type: 'number' },
						speed: { type: 'string', nullable: true },
						eta: { type: 'string', nullable: true },
						filename: { type: 'string', nullable: true },
						filepath: { type: 'string', nullable: true },
						filesize: { type: 'string', nullable: true },
						profileId: { type: 'string' },
						userId: { type: 'string', nullable: true },
						storagePool: { type: 'string', enum: ['cache', 'library'] },
						createdAt: { type: 'string', format: 'date-time' },
						completedAt: { type: 'string', format: 'date-time', nullable: true },
					},
				},
			},
		},
	},
	async ({ request, locals }) => {
		try {
			const { url, profileId, saveToLibrary, customFlags } = await request.json();

			if (!url || !profileId) {
				throw error(400, 'Missing required fields: url, profileId');
			}

			// Validate URL format
			try {
				const urlObj = new URL(url);
				if (!['http:', 'https:'].includes(urlObj.protocol)) {
					throw error(400, 'Only HTTP(S) URLs are allowed');
				}
			} catch {
				throw error(400, 'Invalid URL format');
			}

			// Best-effort SSRF guard — yt-dlp re-resolves the URL itself; see utils/ssrf-guard.ts.
			const hostCheck = await checkUrlHost(url);
			if (!hostCheck.ok) throw error(400, describeUrlHostCheck(hostCheck));

			const flags: string[] = Array.isArray(customFlags) ? customFlags : [];

			const userId = locals.session?.user?.id;

			// Verify profile exists and user has access
			const profile = await prisma.downloadProfile.findUnique({
				where: { id: profileId },
			});
			if (!profile) {
				throw error(400, 'Invalid profile ID');
			}
			if (!profile.isSystem && profile.userId !== userId) {
				throw error(403, "Cannot use another user's profile");
			}
			const download = await downloadService.createDownload(
				url,
				profileId,
				userId,
				undefined,
				!!saveToLibrary,
				flags,
			);

			return json(download, { status: 201 });
		} catch (e: any) {
			console.error('Failed to create download:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;

export const GET = apiRoute(
	'/api/downloads',
	'GET',
	{
		summary: 'List downloads',
		tags: ['Downloads'],
		auth: true,
		query: {
			status: {
				type: 'string',
				description: 'Filter by status',
				enum: [
					'PENDING',
					'FETCHING_INFO',
					'DOWNLOADING',
					'PROCESSING',
					'COMPLETED',
					'FAILED',
					'CANCELLED',
					'DELETED',
				],
			},
			watchState: {
				type: 'string',
				description: 'Filter by watch state',
				enum: ['watched', 'unwatched', 'in_progress'],
			},
			limit: { type: 'integer', description: 'Max results', minimum: 1, maximum: 100, default: 50 },
			offset: { type: 'integer', description: 'Pagination offset', minimum: 0, default: 0 },
			minHeight: { type: 'integer', description: 'Minimum video height (e.g. 720)' },
			maxHeight: { type: 'integer', description: 'Maximum video height (e.g. 1080)' },
			storagePool: {
				type: 'string',
				description: 'Filter by storage pool',
				enum: ['cache', 'library'],
			},
			uploader: { type: 'string', description: 'Filter by exact uploader/channel name' },
			sort: {
				type: 'string',
				description: 'Sort order applied by the database, stable across pages',
				enum: ['newest', 'oldest', 'largest', 'smallest', 'longest', 'shortest', 'uploader'],
				default: 'newest',
			},
			dateFrom: {
				type: 'string',
				format: 'date',
				description: 'Filter downloads from this date (YYYY-MM-DD)',
			},
			dateTo: {
				type: 'string',
				format: 'date',
				description: 'Filter downloads up to this date (YYYY-MM-DD)',
			},
		},
		responses: {
			200: {
				description:
					'List of downloads. X-Total-Count reports how many downloads the filters match in total, not just this page.',
				schema: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							id: { type: 'string' },
							url: { type: 'string' },
							status: {
								type: 'string',
								enum: [
									'PENDING',
									'FETCHING_INFO',
									'DOWNLOADING',
									'PROCESSING',
									'COMPLETED',
									'FAILED',
									'CANCELLED',
									'DELETED',
								],
							},
							title: { type: 'string', nullable: true },
							thumbnail: { type: 'string', nullable: true },
							duration: { type: 'integer', nullable: true },
							uploader: { type: 'string', nullable: true },
							progress: { type: 'number' },
							speed: { type: 'string', nullable: true },
							eta: { type: 'string', nullable: true },
							filename: { type: 'string', nullable: true },
							filepath: { type: 'string', nullable: true },
							filesize: { type: 'string', nullable: true },
							profileId: { type: 'string' },
							userId: { type: 'string', nullable: true },
							storagePool: { type: 'string', enum: ['cache', 'library'] },
							createdAt: { type: 'string', format: 'date-time' },
							completedAt: { type: 'string', format: 'date-time', nullable: true },
						},
					},
				},
			},
		},
	},
	async ({ url, locals }) => {
		try {
			if (!locals.session?.user?.id) {
				throw error(401, 'Authentication required');
			}

			const userId = locals.session.user.id;
			const statusParam = url.searchParams.get('status');
			const watchStateParam = url.searchParams.get('watchState') as
				'watched' | 'unwatched' | 'in_progress' | null;

			let limit = parseInt(url.searchParams.get('limit') || '50');
			let offset = parseInt(url.searchParams.get('offset') || '0');

			if (isNaN(limit) || limit < 1) limit = 50;
			if (limit > 100) limit = 100;

			if (isNaN(offset) || offset < 0) offset = 0;

			const minHeightParam = url.searchParams.get('minHeight');
			const maxHeightParam = url.searchParams.get('maxHeight');
			const dateFromParam = url.searchParams.get('dateFrom');
			const dateToParam = url.searchParams.get('dateTo');
			const storagePoolParam = url.searchParams.get('storagePool');
			const uploaderParam = url.searchParams.get('uploader')?.trim();
			const sortParam = url.searchParams.get('sort') as DownloadListSort | null;

			const filters: DownloadListFilters = {};

			if (minHeightParam) {
				const v = parseInt(minHeightParam);
				if (!isNaN(v)) filters.minHeight = v;
			}
			if (maxHeightParam) {
				const v = parseInt(maxHeightParam);
				if (!isNaN(v)) filters.maxHeight = v;
			}
			if (dateFromParam) {
				const d = new Date(dateFromParam);
				if (!isNaN(d.getTime())) filters.dateFrom = d;
			}
			if (dateToParam) {
				const d = new Date(dateToParam);
				if (!isNaN(d.getTime())) filters.dateTo = d;
			}
			if (storagePoolParam === 'cache' || storagePoolParam === 'library') {
				filters.storagePool = storagePoolParam;
			}
			if (uploaderParam) filters.uploader = uploaderParam;

			const sort = sortParam && LIST_SORTS.includes(sortParam) ? sortParam : undefined;

			// Rows and total come from the same filters: the Completed header reports
			// the library size rather than the loaded page, and pagination knows when
			// nothing is left to fetch.
			const [downloads, total] = await Promise.all([
				downloadService.listDownloads(
					userId,
					statusParam as any,
					limit,
					offset,
					watchStateParam || undefined,
					filters,
					sort,
				),
				downloadService.countDownloads(
					userId,
					statusParam as any,
					watchStateParam || undefined,
					filters,
				),
			]);

			return json(downloads, { headers: { 'X-Total-Count': String(total) } });
		} catch (e: any) {
			console.error('Failed to list downloads:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
