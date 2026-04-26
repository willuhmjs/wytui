import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { subscriptionService } from '$lib/server/services/subscription.service';
import type { RequestHandler } from './$types';

/**
 * GET /api/subscriptions
 * List subscriptions
 */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		// Require authentication
		if (!locals.session?.user?.id) {
			throw error(401, 'Authentication required');
		}

		const userId = locals.session.user.id;

		const subscriptions = await prisma.subscription.findMany({
			where: { userId },
			include: { profile: true },
			orderBy: { createdAt: 'desc' },
		});

		return json(subscriptions);
	} catch (e: any) {
		console.error('Failed to list subscriptions:', e);
		if (e.status) throw e;
		throw error(500, e.message || 'Failed to list subscriptions');
	}
};

/**
 * POST /api/subscriptions
 * Create subscription
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		// Require authentication
		if (!locals.session?.user?.id) {
			throw error(401, 'Authentication required');
		}

		const data = await request.json();
		const userId = locals.session.user.id;

		// Validate required fields
		if (!data.url || !data.name || !data.profileId) {
			throw error(400, 'Missing required fields: url, name, profileId');
		}

		// Validate URL format
		try {
			new URL(data.url);
		} catch {
			throw error(400, 'Invalid URL format');
		}

		// Validate types and ranges
		const checkInterval = parseInt(data.checkInterval) || 1800;
		if (checkInterval < 60 || checkInterval > 86400) {
			throw error(400, 'Check interval must be between 60 and 86400 seconds');
		}

		const maxVideos = data.maxVideos ? parseInt(data.maxVideos) : null;
		if (maxVideos !== null && (maxVideos < 1 || maxVideos > 100)) {
			throw error(400, 'Max videos must be between 1 and 100');
		}

		// Create subscription with validated data only
		const subscription = await prisma.subscription.create({
			data: {
				url: data.url,
				name: data.name,
				type: data.type || 'CHANNEL',
				profileId: data.profileId,
				checkInterval,
				maxVideos,
				autoDownload: data.autoDownload ?? true,
				enabled: true,
				userId,
			},
			include: { profile: true },
		});

		// Schedule the subscription
		await subscriptionService.scheduleSubscription(subscription);

		return json(subscription, { status: 201 });
	} catch (e: any) {
		console.error('Failed to create subscription:', e);
		if (e.status) throw e;
		throw error(500, e.message || 'Failed to create subscription');
	}
};
