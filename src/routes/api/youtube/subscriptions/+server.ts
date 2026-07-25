import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/guards';
import { prisma } from '$lib/server/db';
import { youtubeService } from '$lib/server/services/youtube.service';
import { subscriptionService } from '$lib/server/services/subscription.service';
import type { RequestHandler } from './$types';

// GET: scraped YouTube subscriptions as a selectable list. Cached per user;
// `?refresh=1` forces a re-scrape (the picker's refresh button).
export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = requireAuth(locals);
	const refresh = url.searchParams.get('refresh') === '1';
	const result = await youtubeService.fetchSubscriptions(userId, { refresh });
	if ('needsRelink' in result) return json({ needsRelink: true });
	return json({ channels: result });
};

// POST: create wytui subscriptions for the chosen channels. Each one is scheduled
// for polling immediately and has its archive seeded in the background so it is
// future-only (no back-catalog re-download) — matching single-subscription add.
export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = requireAuth(locals);
	const body = await request.json().catch(() => null);
	if (!body || !Array.isArray(body.channels)) throw error(400, 'channels[] required');
	const profileId: string = body.profileId;
	if (!profileId) throw error(400, 'profileId required');

	// Validate profile ownership up front (mirrors the single-add route).
	const profile = await prisma.downloadProfile.findUnique({ where: { id: profileId } });
	if (!profile) throw error(400, 'Invalid profile ID');
	if (!profile.isSystem && profile.userId !== userId)
		throw error(403, "Cannot use another user's profile");

	const createdIds: string[] = [];
	let skipped = 0;
	for (const ch of body.channels) {
		if (!ch?.url || !ch?.name) continue;
		// Skip channels the user is already subscribed to.
		const existing = await prisma.subscription.findFirst({ where: { url: ch.url, userId } });
		if (existing) {
			skipped++;
			continue;
		}
		const sub = await prisma.subscription.create({
			data: {
				url: ch.url,
				name: ch.name,
				type: 'CHANNEL',
				enabled: body.enabled ?? true,
				autoDownload: body.autoDownload ?? true,
				saveToLibrary: body.saveToLibrary ?? false,
				profileId,
				userId,
			},
			include: { profile: true },
		});
		createdIds.push(sub.id);
		// Lightweight — just registers the cron task.
		await subscriptionService.scheduleSubscription(sub);
	}

	// Seed archives in the background, one at a time, so a large import doesn't
	// spawn a yt-dlp process per channel all at once.
	if (createdIds.length > 0) {
		void (async () => {
			for (const id of createdIds) {
				try {
					await subscriptionService.seedArchive(id);
				} catch (err) {
					console.error(`[YouTube Import] Failed to seed archive for ${id}:`, err);
				}
			}
		})();
	}

	return json({ created: createdIds.length, skipped });
};
