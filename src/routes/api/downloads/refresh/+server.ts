import { json, error } from '@sveltejs/kit';
import { downloadService } from '$lib/server/services/download.service';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const POST = apiRoute(
	'/api/downloads/refresh',
	'POST',
	{
		summary: 'Refresh metadata for multiple downloads',
		tags: ['Downloads'],
		auth: true,
		body: {
			ids: { type: 'array', required: true, description: 'Array of download IDs' },
		},
		responses: {
			200: {
				description: 'Batch refresh result',
				schema: {
					type: 'object',
					properties: {
						refreshed: { type: 'integer' },
						errors: { type: 'array', items: { type: 'string' } },
					},
				},
			},
		},
	},
	async ({ request, locals }) => {
		try {
			if (!locals.session?.user?.id) {
				throw error(401, 'Authentication required');
			}

			const { ids } = await request.json();

			if (!ids || !Array.isArray(ids) || ids.length === 0) {
				throw error(400, 'Missing required field: ids (must be a non-empty array)');
			}

			const userId = locals.session.user.id;
			const isAdmin = locals.session.user.isAdmin;
			let refreshed = 0;
			const errors: string[] = [];

			for (const id of ids) {
				try {
					const download = await downloadService.getDownload(id);
					if (!download) {
						errors.push(`Download ${id} not found`);
						continue;
					}

					if (download.userId !== userId && !isAdmin) {
						errors.push(`Access denied for download ${id}`);
						continue;
					}

					await downloadService.refreshMetadata(id);
					refreshed++;
				} catch (e: any) {
					errors.push(`Failed to refresh ${id}: ${e.message}`);
				}
			}

			return json({ refreshed, errors });
		} catch (e: any) {
			console.error('Failed to batch refresh metadata:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
