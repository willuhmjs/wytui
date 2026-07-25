import { error } from '@sveltejs/kit';
import { searchService } from '$lib/server/services/search.service';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/search',
	'GET',
	{
		summary: 'Full-text search downloads',
		tags: ['Downloads'],
		auth: true,
		query: {
			q: { type: 'string', description: 'Search query' },
			limit: { type: 'integer', default: 20 },
			offset: { type: 'integer', default: 0 },
			videoType: { type: 'string', description: 'Filter by video type' },
			storagePool: { type: 'string', description: 'Filter by storage pool' },
			uploader: { type: 'string', description: 'Filter by uploader name' },
			watchState: {
				type: 'string',
				description: 'Filter by watch state',
				enum: ['watched', 'unwatched', 'in_progress'],
			},
			minHeight: { type: 'integer', description: 'Minimum video height' },
			maxHeight: { type: 'integer', description: 'Maximum video height' },
			dateFrom: { type: 'string', format: 'date', description: 'Filter from date (YYYY-MM-DD)' },
			dateTo: { type: 'string', format: 'date', description: 'Filter to date (YYYY-MM-DD)' },
		},
		responses: { 200: { description: 'Search results' } },
	},
	async ({ locals, url }) => {
		if (!locals.session?.user?.id) throw error(401, 'Authentication required');

		const q = url.searchParams.get('q');
		if (!q?.trim()) {
			return new Response(JSON.stringify({ results: [], total: 0 }), {
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const minHeightParam = url.searchParams.get('minHeight');
		const maxHeightParam = url.searchParams.get('maxHeight');
		const dateFromParam = url.searchParams.get('dateFrom');
		const dateToParam = url.searchParams.get('dateTo');

		const result = await searchService.search(q, locals.session.user.id, {
			limit: parseInt(url.searchParams.get('limit') || '20'),
			offset: parseInt(url.searchParams.get('offset') || '0'),
			videoType: url.searchParams.get('videoType') || undefined,
			storagePool: url.searchParams.get('storagePool') || undefined,
			uploader: url.searchParams.get('uploader') || undefined,
			watchState:
				(url.searchParams.get('watchState') as 'watched' | 'unwatched' | 'in_progress') ||
				undefined,
			minHeight: minHeightParam ? parseInt(minHeightParam) : undefined,
			maxHeight: maxHeightParam ? parseInt(maxHeightParam) : undefined,
			dateFrom: dateFromParam ? new Date(dateFromParam) : undefined,
			dateTo: dateToParam ? new Date(dateToParam) : undefined,
		});

		return new Response(JSON.stringify(result), {
			headers: { 'Content-Type': 'application/json' },
		});
	},
) satisfies RequestHandler;
