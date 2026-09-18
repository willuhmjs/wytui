import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/guards';
import { youtubeLinkService } from '$lib/server/services/youtube-link.service';
import { eventLogService, EventTypes } from '$lib/server/services/event-log.service';
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

	const channelName = (body.identity as { channelName?: string } | undefined)?.channelName;
	eventLogService
		.record(
			EventTypes.YOUTUBE_LINKED,
			`Linked YouTube account${channelName ? ` "${channelName}"` : ''}`,
		)
		.catch(() => {});

	return json(await youtubeLinkService.getLinkStatus(userId));
};

export const PATCH: RequestHandler = async ({ locals, request }) => {
	const userId = requireAuth(locals);
	const body = await request.json().catch(() => ({}));

	// Per-account yt-dlp settings ride alongside the sync toggles. Both are
	// optional; updateToggles ignores keys it doesn't know.
	const {
		proxyUrl,
		extraFlags,
		appriseUrl,
		notifyOnComplete,
		notifyOnFail,
		jellyfinUserId,
		...toggles
	} = body ?? {};
	const accountSettings = {
		proxyUrl,
		extraFlags,
		appriseUrl,
		notifyOnComplete,
		notifyOnFail,
		jellyfinUserId,
	};
	const hasAccountSettings = Object.values(accountSettings).some((v) => v !== undefined);
	if (hasAccountSettings) {
		try {
			await youtubeLinkService.updateAccountSettings(userId, accountSettings);
		} catch (e) {
			throw error(400, e instanceof Error ? e.message : 'Invalid account settings');
		}
	}
	await youtubeLinkService.updateToggles(userId, toggles);
	return json(await youtubeLinkService.getLinkStatus(userId));
};

export const DELETE: RequestHandler = async ({ locals }) => {
	const userId = requireAuth(locals);
	await youtubeLinkService.unlink(userId);

	eventLogService.record(EventTypes.YOUTUBE_UNLINKED, 'Unlinked YouTube account').catch(() => {});

	return json({ linked: false });
};
