import { json, error } from '@sveltejs/kit';
import { libraryService } from '$lib/server/services/library.service';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/library/usage',
	'GET',
	{
		summary: 'Get storage usage',
		tags: ['Library'],
		auth: true,
		responses: {
			200: {
				description: 'Cache and library storage usage',
				schema: {
					type: 'object',
					properties: {
						cache: { type: 'object' },
						library: { type: 'object' },
					},
				},
			},
		},
	},
	async ({ locals }) => {
		try {
			if (!locals.session?.user?.id) {
				throw error(401, 'Authentication required');
			}

			const [cache, library] = await Promise.all([
				libraryService.getCacheUsage(),
				libraryService.getLibraryUsage(),
			]);
			return json({ cache, library });
		} catch (e: any) {
			console.error('Failed to get cache usage:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
