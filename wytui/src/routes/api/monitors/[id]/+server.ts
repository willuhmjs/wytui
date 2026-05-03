import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { monitorService } from '$lib/server/services/monitor.service';
import type { RequestHandler } from './$types';

/**
 * GET /api/monitors/[id]
 * Get monitor
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	try {
		// Require authentication
		if (!locals.session?.user?.id) {
			throw error(401, 'Authentication required');
		}

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
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	try {
		// Require authentication
		if (!locals.session?.user?.id) {
			throw error(401, 'Authentication required');
		}

		// Check ownership first
		const existing = await prisma.monitor.findUnique({
			where: { id: params.id },
		});

		if (!existing) {
			throw error(404, 'Monitor not found');
		}

		if (!locals.session.user.isAdmin) {
			throw error(403, 'Admin access required');
		}

		const body = await request.json();

		const allowedFields = ['name', 'url', 'type', 'enabled', 'autoDownload', 'profileId'];
		const updates: Record<string, any> = {};
		for (const key of allowedFields) {
			if (key in body) updates[key] = body[key];
		}

		if (updates.type !== undefined) {
			const validTypes = ['YOUTUBE_LIVE', 'TWITCH'];
			if (!validTypes.includes(updates.type)) {
				throw error(400, 'Invalid monitor type');
			}
		}

		if (updates.profileId !== undefined) {
			const profile = await prisma.downloadProfile.findUnique({
				where: { id: updates.profileId },
			});
			if (!profile) {
				throw error(400, 'Invalid profile ID');
			}
			if (!profile.isSystem && profile.userId !== locals.session.user.id) {
				throw error(403, 'Cannot use another user\'s profile');
			}
		}

		const monitor = await prisma.monitor.update({
			where: { id: params.id },
			data: updates,
			include: { profile: true },
		});

		if (body.enabled !== undefined) {
			if (monitor.enabled) {
				await monitorService.startMonitor(monitor);
			} else {
				monitorService.stopMonitor(params.id);
			}
		}

		return json(monitor);
	} catch (e: any) {
		console.error('Failed to update monitor:', e);
		if (e.status) throw e;
		throw error(500, e.message || 'Failed to update monitor');
	}
};

/**
 * DELETE /api/monitors/[id]
 * Delete monitor
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	try {
		// Require authentication
		if (!locals.session?.user?.id) {
			throw error(401, 'Authentication required');
		}

		// Check ownership first
		const existing = await prisma.monitor.findUnique({
			where: { id: params.id },
		});

		if (!existing) {
			throw error(404, 'Monitor not found');
		}

		if (!locals.session.user.isAdmin) {
			throw error(403, 'Admin access required');
		}

		// Stop monitoring first
		monitorService.stopMonitor(params.id);

		await prisma.monitor.delete({
			where: { id: params.id },
		});

		return json({ success: true });
	} catch (e: any) {
		console.error('Failed to delete monitor:', e);
		if (e.status) throw e;
		throw error(500, e.message || 'Failed to delete monitor');
	}
};
