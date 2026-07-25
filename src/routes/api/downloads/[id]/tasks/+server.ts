import { json, error } from '@sveltejs/kit';
import { downloadService } from '$lib/server/services/download.service';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/downloads/[id]/tasks',
	'GET',
	{
		summary: 'Get tasks for a download',
		tags: ['Downloads'],
		auth: true,
		params: { id: { type: 'string', description: 'Download ID' } },
		responses: {
			200: {
				description: 'Array of download tasks',
				schema: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							id: { type: 'string' },
							downloadId: { type: 'string' },
							type: { type: 'string' },
							status: { type: 'string' },
							progress: { type: 'number', nullable: true },
							message: { type: 'string', nullable: true },
							startedAt: { type: 'string', format: 'date-time', nullable: true },
							completedAt: { type: 'string', format: 'date-time', nullable: true },
						},
					},
				},
			},
			404: { description: 'Download not found' },
		},
	},
	async ({ params, locals }) => {
		if (!locals.session?.user?.id) {
			throw error(401, 'Authentication required');
		}

		const download = await downloadService.getDownload(params.id);
		if (!download) {
			throw error(404, 'Download not found');
		}

		if (download.userId !== locals.session.user.id && !locals.session.user.isAdmin) {
			throw error(403, 'Access denied');
		}

		const tasks = await downloadService.getTasksForDownload(params.id);
		return json(tasks);
	},
) satisfies RequestHandler;
