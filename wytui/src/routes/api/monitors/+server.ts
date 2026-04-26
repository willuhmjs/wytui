import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { monitorService } from '$lib/server/services/monitor.service';
import type { RequestHandler } from './$types';

/**
 * GET /api/monitors
 * List monitors
 */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		// Require authentication
		if (!locals.session?.user?.id) {
			throw error(401, 'Authentication required');
		}

		const userId = locals.session.user.id;

		const monitors = await prisma.monitor.findMany({
			where: { userId },
			include: { profile: true },
			orderBy: { createdAt: 'desc' },
		});

		return json(monitors);
	} catch (e: any) {
		console.error('Failed to list monitors:', e);
		if (e.status) throw e;
		throw error(500, e.message || 'Failed to list monitors');
	}
};

/**
 * POST /api/monitors
 * Create monitor
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		// Require authentication
		if (!locals.session?.user?.id) {
			throw error(401, 'Authentication required');
		}

		const userId = locals.session.user.id;
		const data = await request.json();

		if (!data.url || !data.name || !data.profileId || !data.type) {
			throw error(400, 'Missing required fields: url, name, profileId, type');
		}

		const monitor = await prisma.monitor.create({
			data: {
				...data,
				userId,
			},
			include: { profile: true },
		});

		// Start monitoring
		await monitorService.startMonitor(monitor);

		return json(monitor, { status: 201 });
	} catch (e: any) {
		console.error('Failed to create monitor:', e);
		if (e.status) throw e;
		throw error(500, e.message || 'Failed to create monitor');
	}
};
