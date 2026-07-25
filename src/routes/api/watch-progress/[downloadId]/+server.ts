import { json, error } from '@sveltejs/kit';
import { watchProgressService } from '$lib/server/services/watch-progress.service';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const PUT = apiRoute(
	'/api/watch-progress/[downloadId]',
	'PUT',
	{
		summary: 'Save watch progress for a download',
		tags: ['Watch Progress'],
		auth: true,
		params: {
			downloadId: { type: 'string', description: 'Download ID' },
		},
		body: {
			position: {
				type: 'number',
				required: true,
				description: 'Current playback position in seconds',
			},
			duration: { type: 'number', description: 'Total duration in seconds' },
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

		const { position, duration } = await request.json();

		if (typeof position !== 'number' || position < 0) {
			throw error(400, 'position must be a non-negative number');
		}

		const progress = await watchProgressService.saveProgress(
			locals.session.user.id,
			params.downloadId,
			position,
			duration,
		);

		return json(progress);
	},
) satisfies RequestHandler;
