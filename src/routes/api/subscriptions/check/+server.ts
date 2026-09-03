import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/guards';
import { prisma } from '$lib/server/db';
import { subscriptionService } from '$lib/server/services/subscription.service';
import type { RequestHandler } from './$types';

const CHECK_DELAY_MS = 3000; // 3 s between checks to avoid rate-limiting

/**
 * POST /api/subscriptions/check
 *
 * Triggers a check for all of the caller's enabled subscriptions in the
 * background, one at a time with a small delay between each call.  Returns
 * immediately with the count of subscriptions that will be checked.
 */
export const POST: RequestHandler = async ({ locals }) => {
	const userId = requireAuth(locals);

	const subscriptions = await prisma.subscription.findMany({
		where: { userId, enabled: true },
		select: { id: true },
		orderBy: { lastChecked: 'asc' }, // oldest-checked first
	});

	if (subscriptions.length === 0) {
		return json({ subscriptions: 0 });
	}

	void (async () => {
		for (let i = 0; i < subscriptions.length; i++) {
			if (i > 0) await new Promise((r) => setTimeout(r, CHECK_DELAY_MS));
			try {
				// Manual trigger: bypass the post-rate-limit cooldown so the user
				// can always probe their channels directly.
				await subscriptionService.checkSubscription(subscriptions[i].id, { force: true });
			} catch (err) {
				console.error(`[Subscriptions] Batch check failed for ${subscriptions[i].id}:`, err);
			}
		}
	})();

	return json({ subscriptions: subscriptions.length });
};
