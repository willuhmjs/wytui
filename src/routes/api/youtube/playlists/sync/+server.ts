import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/guards';
import { youtubeService, isYouTubeUrl, type YtEntry } from '$lib/server/services/youtube.service';
import { playlistService } from '$lib/server/services/playlist.service';
import { sseEmitter } from '$lib/server/sse/emitter';
import type { RequestHandler } from './$types';

// Cap per request to bound the number of (slow) yt-dlp calls we make.
const MAX_PLAYLISTS = 50;
const SYNC_TIMEOUT_MS = 30000;
// Delay between consecutive yt-dlp calls to stay within YouTube's rate limits.
const INTER_CALL_DELAY_MS = 2000;
// Extra back-off after a rate-limit hit before moving to the next playlist.
const RATE_LIMIT_BACKOFF_MS = 15000;

/**
 * POST /api/youtube/playlists/sync
 *
 * Accepts a list of YouTube playlists and syncs them into wytui playlists.
 * The response is non-blocking (202): playlists are created in the DB immediately
 * and the video-list yt-dlp fetches run in the background.  Progress is reported
 * via SSE events (playlist:sync:progress / playlist:sync:complete) so the UI can
 * update without holding the HTTP connection open.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = requireAuth(locals);
	const body = await request.json().catch(() => null);
	const selected = Array.isArray(body?.playlists) ? body.playlists : null;
	if (!selected || selected.length === 0) throw error(400, 'playlists[] required');
	if (selected.length > MAX_PLAYLISTS)
		throw error(400, `Select at most ${MAX_PLAYLISTS} playlists`);
	for (const pl of selected) {
		if (!pl || !isYouTubeUrl(pl.url)) throw error(400, 'Invalid YouTube playlist URL');
	}

	// Immediately create / find the wytui playlists with no entries yet so the
	// user can see them straight away without waiting for yt-dlp to finish.
	const emptyMeta = selected.map((pl: { title?: string }) => ({
		title: typeof pl.title === 'string' && pl.title.trim() ? pl.title.trim() : 'YouTube Playlist',
		entries: [] as YtEntry[],
	}));
	const summary = await playlistService.syncYouTubePlaylists(userId, emptyMeta);

	// Fetch video entries for each playlist in the background, one at a time with
	// a delay between calls to respect YouTube's rate limits.
	void (async () => {
		let completed = 0;
		let totalAdded = 0;

		for (let i = 0; i < selected.length; i++) {
			const pl = selected[i] as { title?: string; url: string };
			const title =
				typeof pl.title === 'string' && pl.title.trim() ? pl.title.trim() : 'YouTube Playlist';

			if (i > 0) {
				await new Promise((r) => setTimeout(r, INTER_CALL_DELAY_MS));
			}

			try {
				const result = await youtubeService.fetchPlaylist(userId, pl.url, {
					timeoutMs: SYNC_TIMEOUT_MS,
				});

				if ('needsRelink' in result) {
					sseEmitter.broadcastToUser(
						'playlist:sync:complete',
						{ total: selected.length, completed, totalAdded, needsRelink: true },
						userId,
					);
					return;
				}

				// Add the fetched entries to the already-created playlist.
				const update = await playlistService.syncYouTubePlaylists(userId, [
					{ title, entries: result },
				]);
				totalAdded += update.addedItems;
				completed++;

				sseEmitter.broadcastToUser(
					'playlist:sync:progress',
					{
						title,
						current: completed,
						total: selected.length,
						addedItems: update.addedItems,
					},
					userId,
				);
			} catch (err: any) {
				const rateLimited = err?.isRateLimit === true;
				completed++;

				sseEmitter.broadcastToUser(
					'playlist:sync:progress',
					{
						title,
						current: completed,
						total: selected.length,
						error: true,
						rateLimited,
					},
					userId,
				);

				if (rateLimited) {
					console.warn(
						`[PlaylistSync] Rate limited on "${title}", backing off ${RATE_LIMIT_BACKOFF_MS}ms`,
					);
					await new Promise((r) => setTimeout(r, RATE_LIMIT_BACKOFF_MS));
				} else {
					console.error(`[PlaylistSync] Failed to fetch entries for "${title}":`, err);
				}
			}
		}

		sseEmitter.broadcastToUser(
			'playlist:sync:complete',
			{ total: selected.length, completed, totalAdded },
			userId,
		);
	})();

	// Return immediately with the shell of what was created.
	return json({ ...summary, async: true }, { status: 202 });
};
