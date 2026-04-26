import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { subscriptionService } from '$lib/server/services/subscription.service';
import type { RequestHandler } from './$types';

/**
 * GET /api/subscriptions/[id]
 * Get subscription
 */
export const GET: RequestHandler = async ({ params }) => {
	try {
		const subscription = await prisma.subscription.findUnique({
			where: { id: params.id },
			include: { profile: true, downloads: { take: 10, orderBy: { createdAt: 'desc' } } },
		});

		if (!subscription) {
			throw error(404, 'Subscription not found');
		}

		return json(subscription);
	} catch (e: any) {
		console.error('Failed to get subscription:', e);
		if (e.status) throw e;
		throw error(500, e.message || 'Failed to get subscription');
	}
};

/**
 * PATCH /api/subscriptions/[id]
 * Update subscription
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
	try {
		const updates = await request.json();

		const subscription = await prisma.subscription.update({
			where: { id: params.id },
			data: updates,
			include: { profile: true },
		});

		// Reschedule if enabled or check interval changed
		if (updates.enabled !== undefined || updates.checkInterval !== undefined) {
			if (subscription.enabled) {
				await subscriptionService.scheduleSubscription(subscription);
			} else {
				subscriptionService.unscheduleSubscription(params.id);
			}
		}

		return json(subscription);
	} catch (e: any) {
		console.error('Failed to update subscription:', e);
		throw error(500, e.message || 'Failed to update subscription');
	}
};

/**
 * DELETE /api/subscriptions/[id]
 * Delete subscription
 */
export const DELETE: RequestHandler = async ({ params }) => {
	try {
		// Unschedule first
		subscriptionService.unscheduleSubscription(params.id);

		await prisma.subscription.delete({
			where: { id: params.id },
		});

		return json({ success: true });
	} catch (e: any) {
		console.error('Failed to delete subscription:', e);
		throw error(500, e.message || 'Failed to delete subscription');
	}
};
