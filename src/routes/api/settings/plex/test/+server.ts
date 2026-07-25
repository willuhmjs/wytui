import { json, error } from '@sveltejs/kit';
import { plexService } from '$lib/server/services/plex.service';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const POST = apiRoute(
	'/api/settings/plex/test',
	'POST',
	{
		summary: 'Test Plex connection',
		tags: ['Settings'],
		auth: 'admin',
		body: {
			url: { type: 'string', required: true, description: 'Plex server URL' },
			token: { type: 'string', required: true, description: 'Plex authentication token' },
		},
		responses: {
			200: {
				description: 'Connection test result with server name',
				schema: {
					type: 'object',
					properties: {
						success: { type: 'boolean' },
						serverName: { type: 'string' },
						error: { type: 'string' },
					},
				},
			},
		},
	},
	async ({ request, locals }) => {
		if (!locals.session?.user?.isAdmin) {
			throw error(403, 'Admin access required');
		}

		const { url, token } = await request.json();

		if (!url || !token) {
			return json({ success: false, error: 'URL and token are required' });
		}

		const result = await plexService.testConnection(url, token);
		return json(result);
	},
) satisfies RequestHandler;
