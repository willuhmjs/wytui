import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { queueService } from '$lib/server/services/queue.service';
import type { RequestHandler } from './$types';

/**
 * GET /api/settings
 * Get application settings
 */
export const GET: RequestHandler = async () => {
	try {
		let settings = await prisma.settings.findUnique({
			where: { id: 'singleton' },
		});

		if (!settings) {
			settings = await prisma.settings.create({
				data: { id: 'singleton' },
			});
		}

		return json(settings);
	} catch (e: any) {
		console.error('Failed to get settings:', e);
		throw error(500, e.message || 'Failed to get settings');
	}
};

/**
 * PATCH /api/settings
 * Update settings
 */
export const PATCH: RequestHandler = async ({ request }) => {
	try {
		const updates = await request.json();

		// Handle special case: maxConcurrentDownloads
		if (updates.maxConcurrentDownloads) {
			queueService.setMaxConcurrent(updates.maxConcurrentDownloads);
		}

		const settings = await prisma.settings.update({
			where: { id: 'singleton' },
			data: updates,
		});

		return json(settings);
	} catch (e: any) {
		console.error('Failed to update settings:', e);
		throw error(500, e.message || 'Failed to update settings');
	}
};
