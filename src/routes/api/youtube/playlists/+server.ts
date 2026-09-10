import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/guards';
import { youtubeService, isYouTubeUrl } from '$lib/server/services/youtube.service';
import type { RequestHandler } from './$types';

// List the user's YouTube playlists (created/saved + Liked + Watch Later) for
// the sync picker.
export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = requireAuth(locals);
	const refresh = url.searchParams.get('refresh') === '1';
	try {
		const result = await youtubeService.enumeratePlaylists(userId, { refresh });
		if (!Array.isArray(result)) return json({ needsRelink: true });
		return json({ playlists: result });
	} catch (err: any) {
		console.error('[YouTube Playlists] Failed to enumerate playlists:', err?.message ?? err);
		return json({ error: err?.message ?? 'Failed to load playlists' }, { status: 502 });
	}
};

// Fetch the entries of a single playlist URL (SSRF-guarded — the URL is handed
// to yt-dlp).
export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = requireAuth(locals);
	const { url } = await request.json().catch(() => ({}));
	if (!url) throw error(400, 'url required');
	if (!isYouTubeUrl(url)) throw error(400, 'Invalid YouTube URL');
	try {
		const result = await youtubeService.fetchPlaylist(userId, url);
		if ('needsRelink' in result) return json({ needsRelink: true });
		return json({ entries: result });
	} catch (err: any) {
		console.error('[YouTube Playlists] Failed to fetch playlist:', err?.message ?? err);
		return json({ error: err?.message ?? 'Failed to fetch playlist' }, { status: 502 });
	}
};
