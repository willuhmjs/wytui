import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { monitorService } from '$lib/server/services/monitor.service';
import { ytdlpService } from '$lib/server/services/ytdlp.service';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/monitors',
	'GET',
	{
		summary: 'List monitors',
		tags: ['Monitors'],
		auth: true,
		responses: {
			200: {
				description: 'Array of monitor objects with profile info',
				schema: {
					type: 'array',
					items: {
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
			},
		},
	},
	async ({ locals }) => {
		try {
			if (!locals.session?.user?.id) {
				throw error(401, 'Authentication required');
			}

			const monitors = await prisma.monitor.findMany({
				where: {},
				include: { profile: true },
				orderBy: { createdAt: 'desc' },
			});

			return json(monitors);
		} catch (e: any) {
			console.error('Failed to list monitors:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;

export const POST = apiRoute(
	'/api/monitors',
	'POST',
	{
		summary: 'Create a monitor',
		tags: ['Monitors'],
		auth: true,
		body: {
			url: { type: 'string', required: true, description: 'Stream URL' },
			name: { type: 'string', required: true, description: 'Monitor name' },
			profileId: { type: 'string', required: true, description: 'Download profile ID' },
			type: {
				type: 'string',
				required: true,
				description: 'Monitor type',
				enum: ['YOUTUBE_LIVE', 'TWITCH'],
			},
			autoDownload: { type: 'boolean', description: 'Auto-download when live' },
			customFlags: { type: 'array', description: 'Custom yt-dlp flags' },
		},
		responses: {
			201: {
				description: 'Created monitor object',
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
		},
	},
	async ({ request, locals }) => {
		try {
			if (!locals.session?.user?.id) {
				throw error(401, 'Authentication required');
			}

			const userId = locals.session.user.id;
			const data = await request.json();

			if (!data.url || !data.name || !data.profileId || !data.type) {
				throw error(400, 'Missing required fields: url, name, profileId, type');
			}

			try {
				const urlObj = new URL(data.url);
				if (!['http:', 'https:'].includes(urlObj.protocol)) {
					throw error(400, 'Invalid URL: only HTTP(S) protocols allowed');
				}
			} catch (e: any) {
				if (e.status) throw e;
				throw error(400, 'Invalid URL format');
			}

			const validTypes = ['YOUTUBE_LIVE', 'TWITCH'];
			if (!validTypes.includes(data.type)) {
				throw error(400, 'Invalid monitor type');
			}

			const existing = await prisma.monitor.findFirst({
				where: { url: data.url },
			});
			if (existing) {
				throw error(409, 'A monitor for this URL already exists');
			}

			const customFlags = Array.isArray(data.customFlags) ? data.customFlags : [];
			if (customFlags.length > 0) {
				const badFlag = ytdlpService.findDangerousFlag(customFlags);
				if (badFlag) {
					throw error(400, `Forbidden flag: ${badFlag}`);
				}
			}

			const monitor = await prisma.monitor.create({
				data: {
					url: data.url,
					name: data.name,
					profileId: data.profileId,
					type: data.type,
					autoDownload: data.autoDownload ?? true,
					customFlags,
				},
				include: { profile: true },
			});

			await monitorService.startMonitor(monitor);

			return json(monitor, { status: 201 });
		} catch (e: any) {
			console.error('Failed to create monitor:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
