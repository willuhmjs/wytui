import { json } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/guards';
import { youtubeService } from '$lib/server/services/youtube.service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	const userId = requireAuth(locals);
	const result = await youtubeService.fetchWatchLater(userId);
	if ('needsRelink' in result) return json({ needsRelink: true });
	return json({ entries: result });
};
