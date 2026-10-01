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
	// Posting here replaces the YouTube session that every download, sync and
	// monitor then runs as, so it is the highest-value credential swap in the
	// app. Session cookies are not sufficient: a cross-site POST arrives with the
	// victim's cookie jar, and a `chrome-extension://` Origin can be set by any
	// installed extension, so neither proves the caller intended this. An
	// `Authorization: Bearer` API key does — the browser will not attach it to a
	// request another page initiated. The web UI never POSTs to this endpoint (it
	// reads with GET and writes toggles with PATCH/DELETE), so requiring the key
	// costs it nothing; the extension sends the key whenever one is configured.
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
	// The extension's opt-in refresh posts on an alarm; logging every push as a
	// new link buries the one event that is actually worth reading.
	if (changed) {
		eventLogService
			.record(
				EventTypes.YOUTUBE_LINKED,
				`Linked YouTube account${channelName ? ` "${channelName}"` : ''}`,
			)
			.catch(() => {});
	}

	// Fresh credentials invalidate the failures they were blocking, so those rows
	// deserve another attempt. Only arm on a real change, only this user's rows —
	// the session being replaced never authenticated anyone else's traffic — and let
	// the paced heal job drain the queue instead of firing every blocked download
	// at once here.
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
