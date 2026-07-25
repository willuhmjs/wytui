import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/guards';
import { playlistService } from '$lib/server/services/playlist.service';
import { prisma } from '$lib/server/db';
import type { RequestHandler } from './$types';

// Queue downloads for pending (not-yet-downloaded) items in a playlist. Pass
// itemIds to download a subset, or omit to download all pending items.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const userId = requireAuth(locals);
	const body = await request.json().catch(() => ({}));
	const { profileId, itemIds, saveToLibrary } = body ?? {};

	if (!profileId || typeof profileId !== 'string') throw error(400, 'profileId is required');

	// Verify the profile exists and the user may use it (mirrors playlist import).
	const profile = await prisma.downloadProfile.findUnique({ where: { id: profileId } });
	if (!profile) throw error(400, 'Invalid profile ID');
	if (!profile.isSystem && profile.userId !== userId) {
		throw error(403, "Cannot use another user's profile");
	}

	try {
		const result = await playlistService.downloadPendingItems(
			params.id,
			userId,
			profileId,
			Array.isArray(itemIds) ? itemIds : undefined,
			!!saveToLibrary,
		);
		return json(result);
	} catch (e: any) {
		if (e.message === 'Playlist not found') throw error(404, e.message);
		if (e.message === 'Access denied') throw error(403, e.message);
		console.error('Failed to download playlist items:', e);
		throw error(500, 'Internal server error');
	}
};
