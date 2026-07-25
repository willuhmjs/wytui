import { json, error } from '@sveltejs/kit';
import { createFirstAdmin, hasUsers, issueSessionCookie, validatePassword } from '$lib/server/auth';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const POST = apiRoute(
	'/api/setup',
	'POST',
	{
		summary: 'Create first admin user',
		tags: ['System'],
		auth: false,
		body: {
			email: { type: 'string', required: true, description: 'Admin email' },
			username: {
				type: 'string',
				description: 'Optional login handle (login accepts email or username)',
			},
			password: { type: 'string', required: true, description: 'Admin password' },
			name: { type: 'string', required: true, description: 'Admin display name' },
		},
		responses: {
			200: {
				description: 'Admin account created',
				schema: {
					type: 'object',
					properties: {
						success: { type: 'boolean' },
						message: { type: 'string' },
					},
				},
			},
			400: { description: 'Setup already completed or invalid input' },
		},
	},
	async ({ request, cookies }) => {
		try {
			const usersExist = await hasUsers();
			if (usersExist) {
				throw error(400, 'Setup already completed. Users exist.');
			}

			const { email, username, password, name } = await request.json();

			if (!email || !password || !name) {
				throw error(400, 'Email, password, and name are required');
			}

			if (typeof password !== 'string' || password.length === 0) {
				throw error(400, 'Password is required');
			}

			const passwordValidation = validatePassword(password);
			if (!passwordValidation.valid) {
				throw error(400, passwordValidation.error ?? 'Invalid password');
			}

			const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
			if (!emailRegex.test(email)) {
				throw error(400, 'Invalid email format');
			}

			const user = await createFirstAdmin(email, password, name, username);
			issueSessionCookie(cookies, user);

			return json({ success: true, message: 'Admin account created successfully' });
		} catch (e: any) {
			console.error('Setup failed:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;

export const GET = apiRoute(
	'/api/setup',
	'GET',
	{
		summary: 'Check if setup is required',
		tags: ['System'],
		auth: false,
		responses: {
			200: {
				description: 'Setup status',
				schema: {
					type: 'object',
					properties: {
						setupRequired: { type: 'boolean' },
						usersExist: { type: 'boolean' },
					},
				},
			},
		},
	},
	async () => {
		const usersExist = await hasUsers();
		return json({
			setupRequired: !usersExist,
			usersExist,
		});
	},
) satisfies RequestHandler;
