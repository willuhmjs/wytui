import { json, error } from '@sveltejs/kit';
import { subscriptionService } from '$lib/server/services/subscription.service';
import type { RequestHandler } from './$types';

/**
 * POST /api/subscriptions/[id]/check
 * Manually trigger subscription check
 */
export const POST: RequestHandler = async ({ params }) => {
	try {
		await subscriptionService.checkSubscription(params.id);
		return json({ success: true });
	} catch (e: any) {
		console.error('Failed to check subscription:', e);
		throw error(500, e.message || 'Failed to check subscription');
	}
};
