import { fail, redirect } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { issueSessionCookie } from '$lib/server/auth';
import { isOidcConfigured, getOidcDisplayName } from '$lib/server/oidc';
import { isLdapEnabled, authenticateLdap } from '$lib/server/ldap';
import bcrypt from 'bcrypt';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.session?.user) {
		throw redirect(303, '/');
	}

	const oidcConfigured = await isOidcConfigured();
	const ldapEnabled = await isLdapEnabled();
	let authMode = 'password';
	if (oidcConfigured) {
		const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
		authMode = settings?.authMode || 'password';
	}

	return {
		setupComplete: url.searchParams.get('setup') === 'complete',
		error: url.searchParams.get('error') || null,
		oidcConfigured,
		oidcDisplayName: oidcConfigured ? await getOidcDisplayName() : null,
		authMode,
		ldapEnabled,
		fallback: url.searchParams.get('fallback') === 'password',
	};
};

export const actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		// The identifier field may hold either an email address or a username.
		const identifier = data.get('email')?.toString()?.trim();
		const password = data.get('password')?.toString();

		if (!identifier || !password) {
			return fail(400, { error: 'Username/email and password are required', email: identifier });
		}

		// Try LDAP authentication first if enabled
		const ldapEnabled = await isLdapEnabled();
		if (ldapEnabled) {
			try {
				const ldapUser = await authenticateLdap(identifier, password);
				if (ldapUser) {
					let user = await prisma.user.findUnique({ where: { email: ldapUser.email } });
					if (!user) {
						user = await prisma.user.create({
							data: {
								email: ldapUser.email,
								name: ldapUser.name,
								emailVerified: new Date(),
							},
						});
					}

					issueSessionCookie(cookies, {
						id: user.id,
						email: user.email,
						isAdmin: user.isAdmin,
					});

					throw redirect(303, '/');
				}
			} catch (e) {
				if (
					e instanceof Response ||
					(e && typeof e === 'object' && 'status' in e && (e as any).status === 303)
				)
					throw e;
				// LDAP failed, fall through to password auth
			}
		}

		// Local password authentication — match by email OR username (case-insensitive).
		const user = await prisma.user.findFirst({
			where: {
				OR: [
					{ email: { equals: identifier, mode: 'insensitive' } },
					{ username: { equals: identifier, mode: 'insensitive' } },
				],
			},
		});

		if (!user || !user.password) {
			return fail(400, { error: 'Invalid username/email or password', email: identifier });
		}

		const isValidPassword = await bcrypt.compare(password, user.password);

		if (!isValidPassword) {
			return fail(400, { error: 'Invalid username/email or password', email: identifier });
		}

		issueSessionCookie(cookies, {
			id: user.id,
			email: user.email,
			isAdmin: user.isAdmin,
		});

		throw redirect(303, '/');
	},
} satisfies Actions;
