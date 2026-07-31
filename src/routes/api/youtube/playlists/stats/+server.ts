import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/guards';
import { youtubeService, isYouTubeUrl } from '$lib/server/services/youtube.service';
import { RateLimitError } from '$lib/server/utils/ytdlp-json';
import type { RequestHandler } from './$types';

// Lightweight stats (video count + total duration) for a single playlist URL,
// used by the sync picker to progressively populate each card while the user
// browses. SSRF-guarded — the URL is handed to yt-dlp.
export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = requireAuth(locals);
	const { url, refresh } = await request.json().catch(() => ({}));
	if (!url) throw error(400, 'url required');
	if (!isYouTubeUrl(url)) throw error(400, 'Invalid YouTube URL');
	try {
		const result = await youtubeService.fetchPlaylistStats(userId, url, {
			refresh: refresh === true,
		});
		if ('needsRelink' in result) return json({ needsRelink: true });
		return json(result);
	} catch (err) {
		if (err instanceof RateLimitError) {
			return json({ rateLimited: true }, { status: 429 });
		}
		throw error(500, 'Failed to fetch playlist stats');
	}
};
