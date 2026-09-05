import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/guards';
import { notificationService } from '$lib/server/services/notification.service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	const userId = requireAuth(locals);
	try {
		await notificationService.testAccount(userId);
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Failed to send test notification');
	}
	return json({ success: true });
};
