import { json } from '@sveltejs/kit';
import { apiRoute } from '$lib/server/openapi';
import { libraryService } from '$lib/server/services/library.service';
import type { RequestHandler } from './$types';

export const POST = apiRoute(
	'/api/settings/jellyfin-metadata',
	'POST',
	{
		summary: 'Write NFO metadata for the existing library',
		description:
			'Backfills Jellyfin-compatible NFO files (movie NFOs + channel collection.xml) for every channel folder in the video library.',
		tags: ['Settings'],
		auth: 'admin',
		responses: {
			200: {
				description: 'Backfill counts',
				schema: { type: 'object' },
			},
		},
	},
	async ({ locals }) => {
		if (!locals.session?.user?.isAdmin) {
			return json({ success: false, error: 'Admin access required' }, { status: 403 });
		}
		try {
			const result = await libraryService.syncJellyfinMetadata();
			return json({ success: true, ...result });
		} catch (e: any) {
			return json({ success: false, error: e?.message ?? 'Failed to write metadata' });
		}
	},
) satisfies RequestHandler;
