import { fail, redirect } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { issueSessionCookie } from '$lib/server/auth';
import { isOidcConfigured, getOidcDisplayName } from '$lib/server/oidc';
import bcrypt from 'bcrypt';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.session?.user) {
		throw redirect(303, '/');
	}

	const oidcConfigured = isOidcConfigured();
	let authMode = 'password';
	if (oidcConfigured) {
		const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
		authMode = settings?.authMode || 'password';
	}

	return {
		setupComplete: url.searchParams.get('setup') === 'complete',
		error: url.searchParams.get('error') || null,
		oidcConfigured,
		oidcDisplayName: oidcConfigured ? getOidcDisplayName() : null,
		authMode,
		fallback: url.searchParams.get('fallback') === 'password',
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

		issueSessionCookie(cookies, {
			id: user.id,
			email: user.email,
			isAdmin: user.isAdmin,
		});

		// Redirect to home
		throw redirect(303, '/');
	},
} satisfies Actions;
