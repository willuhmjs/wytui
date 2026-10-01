import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/guards';
import { youtubeLinkService } from '$lib/server/services/youtube-link.service';
import { downloadService } from '$lib/server/services/download.service';
import { eventLogService, EventTypes } from '$lib/server/services/event-log.service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const userId = requireAuth(locals);
	return json(await youtubeLinkService.getLinkStatus(userId));
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = requireAuth(locals);
	// API key only: a cross-site POST carries the victim's cookie jar, so a session proves nothing.
	if (locals.authMethod !== 'apikey') {
		throw error(
			401,
			'Linking a YouTube account requires an API key (Authorization: Bearer). Add one in Settings → API keys, then set it in the extension.',
		);
	}
	const body = await request.json().catch(() => null);
	if (!body || !Array.isArray(body.cookies)) throw error(400, 'cookies[] required');
	let changed = false;
	try {
		changed = (await youtubeLinkService.storeCookies(userId, body.cookies, body.identity)).changed;
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Failed to store cookies');
	}

	const channelName = (body.identity as { channelName?: string } | undefined)?.channelName;
	if (changed) {
		eventLogService
			.record(
				EventTypes.YOUTUBE_LINKED,
				`Linked YouTube account${channelName ? ` "${channelName}"` : ''}`,
			)
			.catch(() => {});
	}

	let armedForRetry = 0;
	if (changed) {
		armedForRetry = await downloadService.armCookieGatedFailures(userId).catch((e) => {
			console.error('Failed to arm cookie-blocked downloads:', e);
			return 0;
		});
	}

	return json({
		...(await youtubeLinkService.getLinkStatus(userId)),
		cookiesChanged: changed,
		armedForRetry,
	});
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
