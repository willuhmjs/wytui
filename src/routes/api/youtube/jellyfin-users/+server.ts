import { json } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/guards';
import { prisma } from '$lib/server/db';
import { jellyfinService } from '$lib/server/services/jellyfin.service';
import type { RequestHandler } from './$types';

// The server's Jellyfin users, so a linked account can pick which Jellyfin
// user its watch history is marked played for.
export const GET: RequestHandler = async ({ locals }) => {
	const userId = requireAuth(locals);
	const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
	if (!settings?.jellyfinUrl || !settings.jellyfinApiKey) {
		return json({ configured: false, users: [] });
	}
	try {
		const users = await jellyfinService.listUsers(
			settings.jellyfinUrl.replace(/\/$/, ''),
			settings.jellyfinApiKey,
		);
		return json({ configured: true, users });
	} catch (e) {
		return json(
			{
				configured: true,
				users: [],
				error: e instanceof Error ? e.message : 'Failed to list Jellyfin users',
			},
			{ status: 502 },
		);
	}
};
