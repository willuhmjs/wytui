import { json, error } from '@sveltejs/kit';
import { watchProgressService } from '$lib/server/services/watch-progress.service';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/watch-progress/continue',
	'GET',
	{
		summary: 'Get continue watching list',
		tags: ['Watch Progress'],
		auth: true,
		query: {
			limit: { type: 'integer', description: 'Max results', minimum: 1, maximum: 50, default: 10 },
		},
		responses: {
			200: {
				description: 'List of partially watched downloads',
				schema: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							id: { type: 'string' },
							userId: { type: 'string' },
							downloadId: { type: 'string' },
							position: { type: 'number' },
							duration: { type: 'number', nullable: true },
							watched: { type: 'boolean' },
							updatedAt: { type: 'string', format: 'date-time' },
						},
					},
				},
			},
		},
	},
	async ({ url, locals }) => {
		if (!locals.session?.user?.id) {
			throw error(401, 'Authentication required');
		}

		let limit = parseInt(url.searchParams.get('limit') || '10');
		if (isNaN(limit) || limit < 1) limit = 10;
		if (limit > 50) limit = 50;

		const records = await watchProgressService.getContinueWatching(locals.session.user.id, limit);

		return json(records);
	},
) satisfies RequestHandler;
