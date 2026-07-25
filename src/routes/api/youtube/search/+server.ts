import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/guards';
import { prisma } from '$lib/server/db';
import { apiRoute } from '$lib/server/openapi';
import {
	youtubeSearchService,
	parseSearchParams,
	type SearchResult,
} from '$lib/server/services/youtube-search.service';
import type { RequestHandler } from './$types';

/**
 * Attach the caller's existing downloads to video results.
 *
 * Done here rather than in the service because the service's cache is shared
 * across all users — baking per-user state into it would leak one user's
 * library into another's results.
 */
async function attachExistingDownloads(
	results: SearchResult[],
	userId: string,
): Promise<SearchResult[]> {
	const ids = results.filter((r) => r.type === 'video').map((r) => r.id);
	if (ids.length === 0) return results;

	const existing = await prisma.download.findMany({
		where: { userId, videoId: { in: ids }, status: { notIn: ['DELETED'] } },
		select: { id: true, videoId: true, status: true },
		orderBy: { createdAt: 'desc' },
	});

	// Most recent wins — findMany is ordered desc, so only set the first hit.
	const byVideoId = new Map<string, { id: string; status: string }>();
	for (const d of existing) {
		if (d.videoId && !byVideoId.has(d.videoId)) {
			byVideoId.set(d.videoId, { id: d.id, status: d.status });
		}
	}

	return results.map((r) =>
		r.type === 'video' ? { ...r, existingDownload: byVideoId.get(r.id) ?? null } : r,
	);
}

export const GET = apiRoute(
	'/api/youtube/search',
	'GET',
	{
		summary: 'Search YouTube',
		description:
			'Search YouTube for videos, channels or playlists. Runs anonymously — the ' +
			"caller's linked YouTube cookies are never used. Results are cached server-side " +
			'for 15 minutes.',
		tags: ['YouTube'],
		auth: true,
		query: {
			q: { type: 'string', description: 'Search query (required, max 200 chars)' },
			type: {
				type: 'string',
				description: 'Result type',
				enum: ['video', 'channel', 'playlist'],
				default: 'video',
			},
			sort: {
				type: 'string',
				description: 'Sort order',
				enum: ['relevance', 'date', 'views', 'rating'],
				default: 'relevance',
			},
			uploadDate: {
				type: 'string',
				description: 'Upload recency filter (videos only)',
				enum: ['any', 'hour', 'today', 'week', 'month', 'year'],
				default: 'any',
			},
			duration: {
				type: 'string',
				description: 'Length filter (videos only)',
				enum: ['any', 'short', 'medium', 'long'],
				default: 'any',
			},
			offset: { type: 'integer', default: 0 },
			limit: { type: 'integer', default: 20, description: 'Max 50' },
		},
		responses: {
			200: {
				description: 'Search results',
				schema: {
					type: 'object',
					properties: {
						results: { type: 'array', items: { type: 'object' } },
						hasMore: { type: 'boolean' },
					},
				},
			},
		},
	},
	async ({ locals, url }) => {
		const userId = requireAuth(locals);

		let opts;
		try {
			opts = parseSearchParams(url.searchParams);
		} catch (e: any) {
			throw error(400, e.message);
		}

		let response;
		try {
			response = await youtubeSearchService.search(opts);
		} catch (e: any) {
			// stderr can carry URLs and internals — log it, never return it.
			console.error('YouTube search failed:', e?.message ?? e);
			throw error(502, 'YouTube search is unavailable right now. Please try again.');
		}

		return json({
			results: await attachExistingDownloads(response.results, userId),
			hasMore: response.hasMore,
		});
	},
) satisfies RequestHandler;
