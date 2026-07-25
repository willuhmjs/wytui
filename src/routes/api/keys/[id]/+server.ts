import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const DELETE = apiRoute(
	'/api/keys/[id]',
	'DELETE',
	{
		summary: 'Revoke an API key',
		tags: ['Auth'],
		auth: true,
		params: { id: { type: 'string', description: 'API key ID' } },
		responses: {
			200: {
				description: 'Key revoked',
				schema: {
					type: 'object',
					properties: {
						success: { type: 'boolean' },
					},
				},
			},
			404: { description: 'Key not found' },
		},
	},
	async ({ params, locals }) => {
		if (!locals.session?.user?.id) {
			throw error(401, 'Authentication required');
		}

		const key = await prisma.apiKey.findUnique({
			where: { id: params.id },
		});

		if (!key) {
			throw error(404, 'API key not found');
		}

		if (key.userId !== locals.session.user.id && !locals.session.user.isAdmin) {
			throw error(403, 'Access denied');
		}

		await prisma.apiKey.delete({ where: { id: params.id } });
		return json({ success: true });
	},
) satisfies RequestHandler;
