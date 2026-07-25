import { json, error } from '@sveltejs/kit';
import { downloadService } from '$lib/server/services/download.service';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const POST = apiRoute(
	'/api/downloads/[id]/cancel',
	'POST',
	{
		summary: 'Cancel a download',
		tags: ['Downloads'],
		auth: true,
		params: { id: { type: 'string', description: 'Download ID' } },
		responses: {
			200: {
				description: 'Download cancelled',
				schema: {
					type: 'object',
					properties: {
						success: { type: 'boolean' },
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

			await downloadService.cancelDownload(params.id);
			return json({ success: true });
		} catch (e: any) {
			console.error('Failed to cancel download:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
