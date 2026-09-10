import { json } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/guards';
import { youtubeSyncService } from '$lib/server/services/youtube-sync.service';
import type { RequestHandler } from './$types';

// Manual "Sync playlists" action: pull the account's Watch Later list into a
// wytui "Watch Later" playlist (pending items, deduped by videoId). Runs
// regardless of the scheduled toggle — the user asked for it explicitly.
export const POST: RequestHandler = async ({ locals }) => {
	const userId = requireAuth(locals);
	const result = await youtubeSyncService.syncWatchLaterList(userId);
	if ('needsRelink' in result) return json({ needsRelink: true });
	if ('error' in result) return json({ error: result.error }, { status: 502 });
	return json({ added: result.added });
};
