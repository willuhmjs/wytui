import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { ytdlpService } from '$lib/server/services/ytdlp.service';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/profiles',
	'GET',
	{
		summary: 'List download profiles',
		tags: ['Profiles'],
		auth: true,
		responses: {
			200: {
				description: 'Array of system and user profiles',
				schema: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							id: { type: 'string' },
							name: { type: 'string' },
							description: { type: 'string', nullable: true },
							format: { type: 'string', nullable: true },
							quality: { type: 'string', nullable: true },
							codec: { type: 'string', nullable: true },
							audioOnly: { type: 'boolean' },
							audioFormat: { type: 'string', nullable: true },
							audioBitrate: { type: 'string', nullable: true },
							customFlags: { type: 'array', items: { type: 'string' } },
							isSystem: { type: 'boolean' },
							isDefault: { type: 'boolean' },
							userId: { type: 'string', nullable: true },
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
			const userId = locals.session.user.id;

			const profiles = await prisma.downloadProfile.findMany({
				where: {
					OR: [{ isSystem: true }, { userId }],
				},
				orderBy: [{ isSystem: 'desc' }, { isDefault: 'desc' }, { name: 'asc' }],
			});

			return json(profiles);
		} catch (e: any) {
			console.error('Failed to list profiles:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;

export const POST = apiRoute(
	'/api/profiles',
	'POST',
	{
		summary: 'Create or update a custom profile',
		tags: ['Profiles'],
		auth: true,
		body: {
			name: { type: 'string', required: true, description: 'Profile name' },
			description: { type: 'string', description: 'Profile description' },
			format: { type: 'string', description: 'Output format' },
			quality: { type: 'string', description: 'Quality preset' },
			codec: { type: 'string', description: 'Video codec' },
			audioOnly: { type: 'boolean', description: 'Audio-only download' },
			audioFormat: { type: 'string', description: 'Audio format' },
			audioBitrate: { type: 'string', description: 'Audio bitrate' },
			customFlags: { type: 'array', description: 'Custom yt-dlp flags' },
		},
		responses: {
			201: {
				description: 'Created profile',
				schema: {
					type: 'object',
					properties: {
						id: { type: 'string' },
						name: { type: 'string' },
						description: { type: 'string', nullable: true },
						format: { type: 'string', nullable: true },
						quality: { type: 'string', nullable: true },
						codec: { type: 'string', nullable: true },
						audioOnly: { type: 'boolean' },
						audioFormat: { type: 'string', nullable: true },
						audioBitrate: { type: 'string', nullable: true },
						customFlags: { type: 'array', items: { type: 'string' } },
						isSystem: { type: 'boolean' },
						isDefault: { type: 'boolean' },
						userId: { type: 'string', nullable: true },
					},
				},
			},
			200: {
				description: 'Updated existing profile',
				schema: {
					type: 'object',
					properties: {
						id: { type: 'string' },
						name: { type: 'string' },
						description: { type: 'string', nullable: true },
						format: { type: 'string', nullable: true },
						quality: { type: 'string', nullable: true },
						codec: { type: 'string', nullable: true },
						audioOnly: { type: 'boolean' },
						audioFormat: { type: 'string', nullable: true },
						audioBitrate: { type: 'string', nullable: true },
						customFlags: { type: 'array', items: { type: 'string' } },
						isSystem: { type: 'boolean' },
						isDefault: { type: 'boolean' },
						userId: { type: 'string', nullable: true },
					},
				},
			},
		},
	},
	async ({ request, locals }) => {
		try {
			const userId = locals.session?.user?.id;
			if (!userId) {
				throw error(401, 'Unauthorized');
			}

			const body = await request.json();

			if (!body.name || typeof body.name !== 'string') {
				throw error(400, 'Profile name is required');
			}

			const customFlags = Array.isArray(body.customFlags) ? body.customFlags : [];
			if (customFlags.length > 0) {
				const badFlag = ytdlpService.findDangerousFlag(customFlags);
				if (badFlag) {
					throw error(400, `Forbidden flag: ${badFlag}`);
				}
			}

			const existing = await prisma.downloadProfile.findFirst({
				where: { userId, name: body.name },
			});

			if (existing && existing.userId !== userId) {
				throw error(403, "Cannot modify another user's profile");
			}

			const data = {
				name: body.name,
				description: body.description || null,
				format: body.format || null,
				quality: body.quality || null,
				codec: body.codec || null,
				audioOnly: body.audioOnly === true,
				audioFormat: body.audioFormat || null,
				audioBitrate: body.audioBitrate || null,
				customFlags,
				userId,
				isSystem: false,
				isDefault: false,
			};

			const profile = existing
				? await prisma.downloadProfile.update({
						where: { id: existing.id },
						data,
					})
				: await prisma.downloadProfile.create({ data });

			return json(profile, { status: existing ? 200 : 201 });
		} catch (e: any) {
			console.error('Failed to create profile:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
