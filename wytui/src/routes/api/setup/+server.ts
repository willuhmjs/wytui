import { json, error } from '@sveltejs/kit';
import { createFirstAdmin, hasUsers, issueSessionCookie } from '$lib/server/auth';
import type { RequestHandler } from './$types';

/**
 * POST /api/setup
 * Create first admin user
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	try {
		// Check if users already exist
		const usersExist = await hasUsers();
		if (usersExist) {
			throw error(400, 'Setup already completed. Users exist.');
		}

		const { email, password, name } = await request.json();

		// Validation
		if (!email || !password || !name) {
			throw error(400, 'Email, password, and name are required');
		}

		if (typeof password !== 'string' || password.length < 8) {
			throw error(400, 'Password must be at least 8 characters long');
		}

		// Validate email format
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(email)) {
			throw error(400, 'Invalid email format');
		}

		// Create first admin and sign them in
		const user = await createFirstAdmin(email, password, name);
		issueSessionCookie(cookies, user);

		return json({ success: true, message: 'Admin account created successfully' });
	} catch (e: any) {
		console.error('Setup failed:', e);
		if (e.status) throw e;
		throw error(500, e.message || 'Failed to create admin account');
	}
};

/**
 * GET /api/setup
 * Check if setup is required
 */
export const GET: RequestHandler = async () => {
	const usersExist = await hasUsers();
	return json({
		setupRequired: !usersExist,
		usersExist,
	});
};
