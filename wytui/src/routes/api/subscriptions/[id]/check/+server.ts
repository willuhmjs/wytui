import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { subscriptionService } from '$lib/server/services/subscription.service';
import type { RequestHandler } from './$types';

/**
 * POST /api/subscriptions/[id]/check
 * Manually trigger subscription check
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	try {
		// Require authentication
		if (!locals.session?.user?.id) {
			throw error(401, 'Authentication required');
		}

		// Check ownership first
		const existing = await prisma.subscription.findUnique({
			where: { id: params.id },
		});

		if (!existing) {
			throw error(404, 'Subscription not found');
		}

		if (existing.userId !== locals.session.user.id && !locals.session.user.isAdmin) {
			throw error(403, 'Access denied');
		}

		await subscriptionService.checkSubscription(params.id);
		return json({ success: true });
	} catch (e: any) {
		console.error('Failed to check subscription:', e);
		if (e.status) throw e;
		throw error(500, e.message || 'Failed to check subscription');
	}
};
