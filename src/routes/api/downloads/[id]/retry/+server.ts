import { json, error } from '@sveltejs/kit';
import { downloadService } from '$lib/server/services/download.service';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const POST = apiRoute(
	'/api/downloads/[id]/retry',
	'POST',
	{
		summary: 'Retry a failed or cancelled download',
		tags: ['Downloads'],
		auth: true,
		params: { id: { type: 'string', description: 'Download ID' } },
		responses: {
			200: {
				description: 'Reset download object, re-queued for processing',
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
							],
						},
						error: { type: 'string', nullable: true },
						retryCount: { type: 'integer' },
						profileId: { type: 'string' },
						userId: { type: 'string', nullable: true },
						storagePool: { type: 'string', enum: ['cache', 'library'] },
						createdAt: { type: 'string', format: 'date-time' },
						completedAt: { type: 'string', format: 'date-time', nullable: true },
					},
				},
			},
			404: { description: 'Download not found' },
			409: { description: 'Download is not in a failed or cancelled state' },
		},
	},
	async ({ params, locals }) => {
		try {
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

			if (download.status !== 'FAILED' && download.status !== 'CANCELLED') {
				throw error(409, 'Only failed or cancelled downloads can be retried');
			}

			const updated = await downloadService.retryDownload(params.id, locals.session.user.id);
			return json(updated);
		} catch (e: any) {
			console.error('Failed to retry download:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
