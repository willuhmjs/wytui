import { json, error } from '@sveltejs/kit';
import { watchProgressService } from '$lib/server/services/watch-progress.service';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const POST = apiRoute(
	'/api/watch-progress/[downloadId]/watched',
	'POST',
	{
		summary: 'Mark a download as watched or unwatched',
		tags: ['Watch Progress'],
		auth: true,
		params: {
			downloadId: { type: 'string', description: 'Download ID' },
		},
		body: {
			watched: {
				type: 'boolean',
				required: true,
				description: 'Whether to mark as watched (true) or unwatched (false)',
			},
		},
		responses: {
			200: {
				description: 'Updated watch progress record',
				schema: {
					type: 'object',
					properties: {
						id: { type: 'string' },
						userId: { type: 'string' },
						downloadId: { type: 'string' },
						position: { type: 'number' },
						duration: { type: 'number', nullable: true },
						watched: { type: 'boolean' },
						watchedAt: { type: 'string', format: 'date-time', nullable: true },
						updatedAt: { type: 'string', format: 'date-time' },
					},
				},
			},
		},
	},
	async ({ params, locals, request }) => {
		if (!locals.session?.user?.id) {
			throw error(401, 'Authentication required');
		}

		const { watched } = await request.json();

		if (typeof watched !== 'boolean') {
			throw error(400, 'watched must be a boolean');
		}

		const userId = locals.session.user.id;
		const { downloadId } = params;

		const progress = watched
			? await watchProgressService.markWatched(userId, downloadId)
			: await watchProgressService.markUnwatched(userId, downloadId);

		return json(progress);
	},
) satisfies RequestHandler;
