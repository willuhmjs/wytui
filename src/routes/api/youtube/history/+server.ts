import { json } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/guards';
import { prisma } from '$lib/server/db';
import { youtubeSyncService } from '$lib/server/services/youtube-sync.service';
import { youtubeLinkService } from '$lib/server/services/youtube-link.service';
import type { RequestHandler } from './$types';

// Manual sync: pull YT history (and push watched state the other way), marking
// matching library items watched and their Jellyfin play state — one pass of
// the same job the scheduler runs.
export const POST: RequestHandler = async ({ locals }) => {
	const userId = requireAuth(locals);
	const link = await prisma.youTubeLink.findUnique({ where: { userId } });
	if (!link) return json({ error: 'No linked YouTube account' }, { status: 400 });
	if (!(await youtubeLinkService.getCookiesTxt(userId))) {
		return json({ needsRelink: true });
	}
	const result = await youtubeSyncService.syncForUser(userId);
	return json({ success: !result.needsRelink && !result.errors?.length, ...result });
};
