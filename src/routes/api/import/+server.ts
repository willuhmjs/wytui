import { json, error } from '@sveltejs/kit';
import { importService } from '$lib/server/services/import.service';
import { apiRoute } from '$lib/server/openapi';
import { requireAdmin } from '$lib/server/guards';
import type { RequestHandler } from './$types';

export const POST = apiRoute(
	'/api/import',
	'POST',
	{
		summary: 'Import files into library',
		tags: ['Library'],
		auth: 'admin',
		body: {
			files: {
				type: 'array',
				required: true,
				description: 'Array of files to import with filepath and optional videoId',
			},
			profileId: {
				type: 'string',
				required: true,
				description: 'Download profile ID to associate with imported files',
			},
		},
		responses: {
			200: {
				description: 'Import results',
				schema: {
					type: 'object',
					properties: {
						imported: { type: 'integer' },
						errors: { type: 'array' },
					},
				},
			},
		},
	},
	async ({ request, locals }) => {
		try {
			requireAdmin(locals);

			const { files, profileId } = await request.json();

			if (!Array.isArray(files) || files.length === 0) {
				throw error(400, 'Missing required field: files (non-empty array)');
			}

			if (!profileId || typeof profileId !== 'string') {
				throw error(400, 'Missing required field: profileId');
			}

			const userId = locals.session.user.id;
			const result = await importService.importFiles(files, userId, profileId);
			return json(result);
		} catch (e: any) {
			console.error('Failed to import files:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
