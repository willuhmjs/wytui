import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { subscriptionService } from '$lib/server/services/subscription.service';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const POST = apiRoute(
	'/api/subscriptions/[id]/check',
	'POST',
	{
		summary: 'Manually trigger subscription check',
		tags: ['Subscriptions'],
		auth: true,
		params: { id: { type: 'string', description: 'Subscription ID' } },
		responses: {
			200: {
				description: 'Check triggered',
				schema: {
					type: 'object',
					properties: {
						success: { type: 'boolean' },
					},
				},
			},
			404: { description: 'Subscription not found' },
		},
	},
	async ({ params, locals }) => {
		try {
			if (!locals.session?.user?.id) {
				throw error(401, 'Authentication required');
			}

			const existing = await prisma.subscription.findUnique({
				where: { id: params.id },
			});

			if (!existing) {
				throw error(404, 'Subscription not found');
			}

			if (existing.userId !== locals.session.user.id && !locals.session.user.isAdmin) {
				throw error(403, 'Access denied');
			}

			// Manual trigger: bypass the post-rate-limit cooldown so the user
			// can always probe a channel directly.
			await subscriptionService.checkSubscription(params.id, { force: true });
			return json({ success: true });
		} catch (e: any) {
			console.error('Failed to check subscription:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
