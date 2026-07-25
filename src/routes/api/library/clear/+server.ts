import { json, error } from '@sveltejs/kit';
import { libraryService } from '$lib/server/services/library.service';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const POST = apiRoute(
	'/api/library/clear',
	'POST',
	{
		summary: 'Clear download cache',
		tags: ['Library'],
		auth: true,
		responses: {
			200: {
				description: 'Cache cleared with deleted file count',
				schema: {
					type: 'object',
					properties: {
						success: { type: 'boolean' },
						deleted: { type: 'integer' },
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

			// Admins clear the whole cache; regular users only their own downloads.
			const scopeUserId = locals.session.user.isAdmin ? undefined : locals.session.user.id;
			const count = await libraryService.clearCache(scopeUserId);
			return json({ success: true, deleted: count });
		} catch (e: any) {
			console.error('Failed to clear cache:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
