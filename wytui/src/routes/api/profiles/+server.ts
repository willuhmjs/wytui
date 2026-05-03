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
 * Create custom profile
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

		const profile = await prisma.downloadProfile.create({
			data: {
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
			},
		});

		return json(profile, { status: 201 });
	} catch (e: any) {
		console.error('Failed to create profile:', e);
		throw error(500, e.message || 'Failed to create profile');
	}
};
