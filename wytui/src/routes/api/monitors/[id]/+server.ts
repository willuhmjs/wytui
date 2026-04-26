import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { monitorService } from '$lib/server/services/monitor.service';
import type { RequestHandler } from './$types';

/**
 * GET /api/monitors/[id]
 * Get monitor
 */
export const GET: RequestHandler = async ({ params }) => {
	try {
		const monitor = await prisma.monitor.findUnique({
			where: { id: params.id },
			include: { profile: true },
		});

		if (!monitor) {
			throw error(404, 'Monitor not found');
		}

		return json(monitor);
	} catch (e: any) {
		console.error('Failed to get monitor:', e);
		if (e.status) throw e;
		throw error(500, e.message || 'Failed to get monitor');
	}
};

/**
 * PATCH /api/monitors/[id]
 * Update monitor
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
	try {
		const updates = await request.json();

		const monitor = await prisma.monitor.update({
			where: { id: params.id },
			data: updates,
			include: { profile: true },
		});

		// Restart monitor if enabled status changed
		if (updates.enabled !== undefined) {
			if (monitor.enabled) {
				await monitorService.startMonitor(monitor);
			} else {
				monitorService.stopMonitor(params.id);
			}
		}

		return json(monitor);
	} catch (e: any) {
		console.error('Failed to update monitor:', e);
		throw error(500, e.message || 'Failed to update monitor');
	}
};

/**
 * DELETE /api/monitors/[id]
 * Delete monitor
 */
export const DELETE: RequestHandler = async ({ params }) => {
	try {
		// Stop monitoring first
		monitorService.stopMonitor(params.id);

		await prisma.monitor.delete({
			where: { id: params.id },
		});

		return json({ success: true });
	} catch (e: any) {
		console.error('Failed to delete monitor:', e);
		throw error(500, e.message || 'Failed to delete monitor');
	}
};
