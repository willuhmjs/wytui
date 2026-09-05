import { json } from '@sveltejs/kit';
import { apiRoute } from '$lib/server/openapi';
import { jellyfinService } from '$lib/server/services/jellyfin.service';
import type { RequestHandler } from './$types';

export const POST = apiRoute(
	'/api/settings/jellyfin-setup',
	'POST',
	{
		summary: 'Set up Jellyfin libraries',
		description:
			'Creates or fixes the Jellyfin library for the configured video (and music) paths: TV Shows collection type, NFO-only metadata, no online matching.',
		tags: ['Settings'],
		auth: 'admin',
		responses: {
			200: {
				description: 'Setup result per library',
				schema: { type: 'object' },
			},
		},
	},
	async ({ locals }) => {
		if (!locals.session?.user?.isAdmin) {
			return json({ success: false, error: 'Admin access required' }, { status: 403 });
		}
		try {
			const result = await jellyfinService.setupLibrary();
			return json({ success: true, ...result });
		} catch (e: any) {
			return json({ success: false, error: e?.message ?? 'Jellyfin setup failed' });
		}
	},
) satisfies RequestHandler;
