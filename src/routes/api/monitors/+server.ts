import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { monitorService } from '$lib/server/services/monitor.service';
import { ytdlpService } from '$lib/server/services/ytdlp.service';
import { apiRoute } from '$lib/server/openapi';
import { requireAdmin } from '$lib/server/guards';
import { checkUrlHost, describeUrlHostCheck } from '$lib/server/utils/ssrf-guard';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/monitors',
	'GET',
	{
		summary: 'List monitors',
		tags: ['Monitors'],
		auth: 'admin',
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
			// Monitors run server-side probes on a schedule and record livestreams
			// with whoever's profile they point at, so listing/creating them is
			// admin-only — same gate PATCH and DELETE already use.
			requireAdmin(locals);

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
		auth: 'admin',
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
			requireAdmin(locals);

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

			// A monitor re-probes this URL on a schedule from the server, so this is
			// a standing SSRF surface, not a one-off fetch. Best-effort only — see
			// utils/ssrf-guard.ts (the probe resolves the name again at run time).
			const hostCheck = await checkUrlHost(data.url);
			if (!hostCheck.ok) throw error(400, describeUrlHostCheck(hostCheck));

			const validTypes = ['YOUTUBE_LIVE', 'TWITCH'];
			if (!validTypes.includes(data.type)) {
				throw error(400, 'Invalid monitor type');
			}

			// Same profile rule as PATCH /api/monitors/[id]: a monitor runs its
			// profile's settings (cookies, proxy, custom flags) unattended, so it may
			// only point at a system profile or the creator's own.
			const profile = await prisma.downloadProfile.findUnique({
				where: { id: data.profileId },
			});
			if (!profile) {
				throw error(400, 'Invalid profile ID');
			}
			if (!profile.isSystem && profile.userId !== userId) {
				throw error(403, "Cannot use another user's profile");
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
