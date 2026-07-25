import { json, error } from '@sveltejs/kit';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/auth/me',
	'GET',
	{
		summary: 'Current authenticated user + how the request authenticated',
		description:
			'Returns the authenticated user and the method used (apikey | session | proxy). Clients (e.g. the browser extension) use authMethod to show the real auth state — an API key that fails resolves to a different method or 401.',
		tags: ['Auth'],
		auth: true,
		responses: {
			200: {
				description: 'Authenticated user and auth method',
				schema: {
					type: 'object',
					properties: {
						user: {
							type: 'object',
							properties: {
								id: { type: 'string' },
								email: { type: 'string', nullable: true },
								isAdmin: { type: 'boolean' },
							},
						},
						authMethod: { type: 'string', enum: ['apikey', 'session', 'proxy'] },
					},
				},
			},
		},
	},
	async ({ locals }) => {
		if (!locals.session?.user?.id) {
			throw error(401, 'Authentication required');
		}

		return json({
			user: {
				id: locals.session.user.id,
				email: locals.session.user.email ?? null,
				isAdmin: !!locals.session.user.isAdmin,
			},
			authMethod: locals.authMethod ?? null,
		});
	},
) satisfies RequestHandler;
