import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { subscriptionService } from '$lib/server/services/subscription.service';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const POST = apiRoute(
	'/api/subscriptions/[id]/backfill',
	'POST',
	{
		summary: 'Backfill subscription videos',
		tags: ['Subscriptions'],
		auth: true,
		params: { id: { type: 'string', description: 'Subscription ID' } },
		body: {
			dateAfter: { type: 'string', description: 'ISO date to backfill from' },
		},
		responses: {
			200: {
				description: 'Backfill started',
				schema: {
					type: 'object',
					properties: {
						started: { type: 'boolean' },
					},
				},
			},
			404: { description: 'Subscription not found' },
		},
	},
	async ({ params, request, locals }) => {
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

			const body = await request.json().catch(() => ({}));
			let dateAfter: string | undefined;

			if (body.dateAfter) {
				const parsed = new Date(body.dateAfter);
				if (isNaN(parsed.getTime())) {
					throw error(400, 'Invalid date format');
				}
				const y = parsed.getFullYear();
				const m = String(parsed.getMonth() + 1).padStart(2, '0');
				const d = String(parsed.getDate()).padStart(2, '0');
				dateAfter = `${y}${m}${d}`;
			}

			subscriptionService.backfillSubscription(params.id, { dateAfter }).catch((err) => {
				console.error(`[Subscriptions] Backfill failed for ${params.id}:`, err);
			});
			return json({ started: true });
		} catch (e: any) {
			console.error('Failed to backfill subscription:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
