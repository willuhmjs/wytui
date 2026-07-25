import { json, error } from '@sveltejs/kit';
import { playlistService } from '$lib/server/services/playlist.service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.session?.user?.id) throw error(401, 'Authentication required');

	const playlists = await playlistService.getPlaylistsForDownload(
		locals.session.user.id,
		params.id,
	);
	return json(playlists);
};
