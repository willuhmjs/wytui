import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { hashPassword, validatePassword, invalidateUsersCache } from '$lib/server/auth';
import type { RequestHandler } from './$types';

/**
 * GET /api/users
 * List all users (admin only)
 */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		// Check if user is admin
		if (!locals.session?.user?.isAdmin) {
			throw error(403, 'Admin access required');
		}

		const users = await prisma.user.findMany({
			select: {
				id: true,
				email: true,
				name: true,
				isAdmin: true,
				createdAt: true,
				_count: {
					select: {
						downloads: true,
						subscriptions: true,
					},
				},
			},
			orderBy: { createdAt: 'desc' },
		});

		return json(users);
	} catch (e: any) {
		console.error('Failed to list users:', e);
		if (e.status) throw e;
		throw error(500, e.message || 'Failed to list users');
	}
};

/**
 * POST /api/users
 * Create a new user (admin only)
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		// Check if user is admin
		if (!locals.session?.user?.isAdmin) {
			throw error(403, 'Admin access required');
		}

		const { email, password, name, isAdmin } = await request.json();

		// Validation
		if (!email || !password || !name) {
			throw error(400, 'Email, password, and name are required');
		}

		// Validate password strength
		const passwordValidation = validatePassword(password);
		if (!passwordValidation.valid) {
			throw error(400, passwordValidation.error!);
		}

		// Check if user already exists
		const existing = await prisma.user.findUnique({
			where: { email },
		});

		if (existing) {
			throw error(400, 'User with this email already exists');
		}

		// Hash password
		const hashedPassword = await hashPassword(password);

		// Create user
		const user = await prisma.user.create({
			data: {
				email,
				password: hashedPassword,
				name,
				isAdmin: isAdmin || false,
			},
			select: {
				id: true,
				email: true,
				name: true,
				isAdmin: true,
				createdAt: true,
			},
		});

		invalidateUsersCache();
		return json(user, { status: 201 });
	} catch (e: any) {
		console.error('Failed to create user:', e);
		if (e.status) throw e;
		throw error(500, e.message || 'Failed to create user');
	}
};
