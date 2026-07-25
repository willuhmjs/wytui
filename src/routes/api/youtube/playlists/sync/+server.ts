import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/guards';
import { youtubeService, isYouTubeUrl, type YtEntry } from '$lib/server/services/youtube.service';
import { playlistService } from '$lib/server/services/playlist.service';
import type { RequestHandler } from './$types';

// Cap per request to bound the number of (slow) yt-dlp calls we make.
const MAX_PLAYLISTS = 50;
// Each call gets its own short timeout, and calls run in bounded batches, so a
// full request can't approach MAX_PLAYLISTS * runYtdlpJson's 120s default —
// worst case here is (MAX_PLAYLISTS / SYNC_CONCURRENCY) * SYNC_TIMEOUT_MS.
const SYNC_TIMEOUT_MS = 30000;
const SYNC_CONCURRENCY = 4;

// Sync selected YouTube playlists into wytui as playlists of pending items
// (snapshots only — videos are downloaded later). Each URL is handed to yt-dlp,
// so it must pass the SSRF allowlist.
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

	const resolved: { title: string; entries: YtEntry[] }[] = [];
	for (let i = 0; i < selected.length; i += SYNC_CONCURRENCY) {
		const batch = selected.slice(i, i + SYNC_CONCURRENCY);
		const results = await Promise.all(
			batch.map((pl: { url: string; title?: string }) =>
				youtubeService.fetchPlaylist(userId, pl.url, { timeoutMs: SYNC_TIMEOUT_MS }),
			),
		);
		for (let j = 0; j < results.length; j++) {
			const result = results[j];
			if ('needsRelink' in result) return json({ needsRelink: true });
			resolved.push({
				title: typeof batch[j].title === 'string' ? batch[j].title : 'YouTube Playlist',
				entries: result,
			});
		}
	}

	const summary = await playlistService.syncYouTubePlaylists(userId, resolved);
	return json(summary);
};
