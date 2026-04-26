import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { monitorService } from '$lib/server/services/monitor.service';
import type { RequestHandler } from './$types';

/**
 * GET /api/monitors
 * List monitors
 */
export const GET: RequestHandler = async () => {
	try {
		const monitors = await prisma.monitor.findMany({
			include: { profile: true },
			orderBy: { createdAt: 'desc' },
		});

		return json(monitors);
	} catch (e: any) {
		console.error('Failed to list monitors:', e);
		throw error(500, e.message || 'Failed to list monitors');
	}
};

/**
 * POST /api/monitors
 * Create monitor
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const data = await request.json();

		if (!data.url || !data.name || !data.profileId || !data.type) {
			throw error(400, 'Missing required fields: url, name, profileId, type');
		}

		const monitor = await prisma.monitor.create({
			data,
			include: { profile: true },
		});

		// Start monitoring
		await monitorService.startMonitor(monitor);

		return json(monitor, { status: 201 });
	} catch (e: any) {
		console.error('Failed to create monitor:', e);
		throw error(500, e.message || 'Failed to create monitor');
	}
};
