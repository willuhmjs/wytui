import { fail, redirect } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import bcrypt from 'bcrypt';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	// If already signed in, redirect to home
	if (locals.session?.user) {
		throw redirect(303, '/');
	}

	return {
		setupComplete: url.searchParams.get('setup') === 'complete',
	};
};

export const actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const email = data.get('email')?.toString();
		const password = data.get('password')?.toString();

		if (!email || !password) {
			return fail(400, { error: 'Email and password are required', email });
		}

		// Find user by email
		const user = await prisma.user.findUnique({
			where: { email },
		});

		if (!user || !user.password) {
			return fail(400, { error: 'Invalid email or password', email });
		}

		// Verify password with bcrypt
		const isValidPassword = await bcrypt.compare(password, user.password);

		if (!isValidPassword) {
			return fail(400, { error: 'Invalid email or password', email });
		}

		// Create session token (simple JWT-like approach)
		const sessionToken = Buffer.from(
			JSON.stringify({
				userId: user.id,
				email: user.email,
				isAdmin: user.isAdmin,
				exp: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
			})
		).toString('base64');

		// Set cookie
		cookies.set('wytui.session-token', sessionToken, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: process.env.NODE_ENV === 'production',
			maxAge: 30 * 24 * 60 * 60, // 30 days
		});

		// Redirect to home
		throw redirect(303, '/');
	},
} satisfies Actions;
