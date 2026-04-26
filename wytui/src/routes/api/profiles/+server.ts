import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import type { RequestHandler } from './$types';

/**
 * GET /api/profiles
 * List all download profiles
 */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		const userId = locals.session?.user?.id;

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

		const data = await request.json();

		const profile = await prisma.downloadProfile.create({
			data: {
				...data,
				userId,
				isSystem: false,
			},
		});

		return json(profile, { status: 201 });
	} catch (e: any) {
		console.error('Failed to create profile:', e);
		throw error(500, e.message || 'Failed to create profile');
	}
};
