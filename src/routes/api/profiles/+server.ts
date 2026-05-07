import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { ytdlpService } from '$lib/server/services/ytdlp.service';
import type { RequestHandler } from './$types';

/**
 * GET /api/profiles
 * List all download profiles
 */
export const GET: RequestHandler = async ({ locals }) => {
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
		throw error(500, e.message || 'Failed to list profiles');
	}
};

/**
 * POST /api/profiles
 * Create or update custom profile (upserts by name per user)
 */
export const POST: RequestHandler = async ({ request, locals }) => {
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
			throw error(403, 'Cannot modify another user\'s profile');
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
		throw error(500, e.message || 'Failed to create profile');
	}
};
