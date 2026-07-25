import { json, error } from '@sveltejs/kit';
import { apiRoute } from '$lib/server/openapi';
import { notificationService } from '$lib/server/services/notification.service';
import type { RequestHandler } from './$types';

export const POST = apiRoute(
	'/api/notifications/test',
	'POST',
	{
		summary: 'Send a test notification',
		tags: ['Settings'],
		auth: 'admin',
		responses: {
			200: {
				description: 'Test notification sent successfully',
				schema: {
					type: 'object',
					properties: {
						success: { type: 'boolean' },
					},
				},
			},
		},
	},
	async ({ locals }) => {
		if (!locals.session?.user?.isAdmin) {
			throw error(403, 'Admin access required');
		}

		await notificationService.test();
		return json({ success: true });
	},
) satisfies RequestHandler;
