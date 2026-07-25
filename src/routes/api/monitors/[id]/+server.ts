import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { monitorService } from '$lib/server/services/monitor.service';
import { ytdlpService } from '$lib/server/services/ytdlp.service';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/monitors/[id]',
	'GET',
	{
		summary: 'Get monitor by ID',
		tags: ['Monitors'],
		auth: true,
		params: { id: { type: 'string', description: 'Monitor ID' } },
		responses: {
			200: {
				description: 'Monitor object with profile',
				schema: {
					type: 'object',
					properties: {
						id: { type: 'string' },
						url: { type: 'string' },
						name: { type: 'string' },
						type: { type: 'string', enum: ['YOUTUBE_LIVE', 'TWITCH'] },
						enabled: { type: 'boolean' },
						isLive: { type: 'boolean' },
						autoDownload: { type: 'boolean' },
						profileId: { type: 'string' },
						customFlags: { type: 'array', items: { type: 'string' } },
						createdAt: { type: 'string', format: 'date-time' },
					},
				},
			},
			404: { description: 'Monitor not found' },
		},
	},
	async ({ params, locals }) => {
		try {
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
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;

export const PATCH = apiRoute(
	'/api/monitors/[id]',
	'PATCH',
	{
		summary: 'Update a monitor',
		tags: ['Monitors'],
		auth: 'admin',
		params: { id: { type: 'string', description: 'Monitor ID' } },
		body: {
			name: { type: 'string', description: 'Monitor name' },
			url: { type: 'string', description: 'Stream URL' },
			type: { type: 'string', description: 'Monitor type', enum: ['YOUTUBE_LIVE', 'TWITCH'] },
			enabled: { type: 'boolean', description: 'Enable/disable monitor' },
			autoDownload: { type: 'boolean', description: 'Auto-download when live' },
			profileId: { type: 'string', description: 'Download profile ID' },
			customFlags: { type: 'array', description: 'Custom yt-dlp flags' },
		},
		responses: {
			200: {
				description: 'Updated monitor object',
				schema: {
					type: 'object',
					properties: {
						id: { type: 'string' },
						url: { type: 'string' },
						name: { type: 'string' },
						type: { type: 'string', enum: ['YOUTUBE_LIVE', 'TWITCH'] },
						enabled: { type: 'boolean' },
						isLive: { type: 'boolean' },
						autoDownload: { type: 'boolean' },
						profileId: { type: 'string' },
						customFlags: { type: 'array', items: { type: 'string' } },
						createdAt: { type: 'string', format: 'date-time' },
					},
				},
			},
			404: { description: 'Monitor not found' },
		},
	},
	async ({ params, request, locals }) => {
		try {
			if (!locals.session?.user?.id) {
				throw error(401, 'Authentication required');
			}

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

			const allowedFields = [
				'name',
				'url',
				'type',
				'enabled',
				'autoDownload',
				'profileId',
				'customFlags',
			];
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
					throw error(403, "Cannot use another user's profile");
				}
			}

			if (updates.customFlags !== undefined) {
				if (!Array.isArray(updates.customFlags)) {
					throw error(400, 'customFlags must be an array');
				}
				const badFlag = ytdlpService.findDangerousFlag(updates.customFlags);
				if (badFlag) {
					throw error(400, `Forbidden flag: ${badFlag}`);
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
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;

export const DELETE = apiRoute(
	'/api/monitors/[id]',
	'DELETE',
	{
		summary: 'Delete a monitor',
		tags: ['Monitors'],
		auth: 'admin',
		params: { id: { type: 'string', description: 'Monitor ID' } },
		responses: {
			200: {
				description: 'Monitor deleted',
				schema: {
					type: 'object',
					properties: {
						success: { type: 'boolean' },
					},
				},
			},
			404: { description: 'Monitor not found' },
		},
	},
	async ({ params, locals }) => {
		try {
			if (!locals.session?.user?.id) {
				throw error(401, 'Authentication required');
			}

			const existing = await prisma.monitor.findUnique({
				where: { id: params.id },
			});

			if (!existing) {
				throw error(404, 'Monitor not found');
			}

			if (!locals.session.user.isAdmin) {
				throw error(403, 'Admin access required');
			}

			monitorService.stopMonitor(params.id);

			await prisma.monitor.delete({
				where: { id: params.id },
			});

			return json({ success: true });
		} catch (e: any) {
			console.error('Failed to delete monitor:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
