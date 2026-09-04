import { json, error } from '@sveltejs/kit';
import { libraryService } from '$lib/server/services/library.service';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const POST = apiRoute(
	'/api/settings/cleanup',
	'POST',
	{
		summary: 'Force-clean the download directory and library husks',
		tags: ['Settings'],
		auth: 'admin',
		responses: {
			200: {
				description: 'Cleanup report',
				schema: {
					type: 'object',
					properties: {
						success: { type: 'boolean' },
						deletedFiles: { type: 'integer' },
						freedBytes: { type: 'string' },
						husksRemoved: { type: 'integer' },
					},
				},
			},
			500: { description: 'Cleanup failed' },
		},
	},
	async ({ locals }) => {
		if (!locals.session?.user?.isAdmin) {
			throw error(403, 'Admin access required');
		}

		try {
			// One hour of freshness protection: an in-flight download that hasn't
			// reported its destination yet keeps its fragments, while every stale
			// orphan goes immediately.
			const { deletedCount, freedBytes } = await libraryService.sweepOrphanedDownloads({
				maxAgeHours: 1,
			});
			const husksRemoved = await libraryService.sweepLibraryHusks();

			return json({
				success: true,
				deletedFiles: deletedCount,
				freedBytes: freedBytes.toString(),
				husksRemoved,
			});
		} catch (e) {
			console.error('Failed to clean download directory:', e);
			throw error(500, 'Cleanup failed');
		}
	},
) satisfies RequestHandler;
