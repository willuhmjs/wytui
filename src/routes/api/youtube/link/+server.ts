import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/guards';
import { youtubeLinkService } from '$lib/server/services/youtube-link.service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const userId = requireAuth(locals);
	return json(await youtubeLinkService.getLinkStatus(userId));
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = requireAuth(locals);
	const body = await request.json().catch(() => null);
	if (!body || !Array.isArray(body.cookies)) throw error(400, 'cookies[] required');
	try {
		await youtubeLinkService.storeCookies(userId, body.cookies, body.identity);
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Failed to store cookies');
	}
	return json(await youtubeLinkService.getLinkStatus(userId));
};

export const PATCH: RequestHandler = async ({ locals, request }) => {
	const userId = requireAuth(locals);
	const toggles = await request.json().catch(() => ({}));
	await youtubeLinkService.updateToggles(userId, toggles);
	return json(await youtubeLinkService.getLinkStatus(userId));
};

export const DELETE: RequestHandler = async ({ locals }) => {
	const userId = requireAuth(locals);
	await youtubeLinkService.unlink(userId);
	return json({ linked: false });
};
