import { json, error } from '@sveltejs/kit';
import { downloadService } from '$lib/server/services/download.service';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const POST = apiRoute(
	'/api/downloads/[id]/refresh',
	'POST',
	{
		summary: 'Refresh metadata for a download',
		tags: ['Downloads'],
		auth: true,
		params: { id: { type: 'string', description: 'Download ID' } },
		responses: {
			200: {
				description: 'Updated download object with refreshed metadata',
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
			404: { description: 'Download not found' },
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

			const updated = await downloadService.refreshMetadata(params.id);
			return json(updated);
		} catch (e: any) {
			console.error('Failed to refresh metadata:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
