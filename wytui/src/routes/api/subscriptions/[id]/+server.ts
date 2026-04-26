import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { subscriptionService } from '$lib/server/services/subscription.service';
import type { RequestHandler } from './$types';

/**
 * GET /api/subscriptions/[id]
 * Get subscription
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	try {
		// Require authentication
		if (!locals.session?.user?.id) {
			throw error(401, 'Authentication required');
		}

		const subscription = await prisma.subscription.findUnique({
			where: { id: params.id },
			include: { profile: true, downloads: { take: 10, orderBy: { createdAt: 'desc' } } },
		});

		if (!subscription) {
			throw error(404, 'Subscription not found');
		}

		// Check ownership or admin
		if (subscription.userId !== locals.session.user.id && !locals.session.user.isAdmin) {
			throw error(403, 'Access denied');
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
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
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
		if (e.status) throw e;
		throw error(500, e.message || 'Failed to update subscription');
	}
};

/**
 * DELETE /api/subscriptions/[id]
 * Delete subscription
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
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

		// Unschedule first
		subscriptionService.unscheduleSubscription(params.id);

		await prisma.subscription.delete({
			where: { id: params.id },
		});

		return json({ success: true });
	} catch (e: any) {
		console.error('Failed to delete subscription:', e);
		if (e.status) throw e;
		throw error(500, e.message || 'Failed to delete subscription');
	}
};
