import { json, error } from '@sveltejs/kit';
import { apiRoute } from '$lib/server/openapi';
import { internalFetch } from '$lib/server/utils/fetch';
import type { RequestHandler } from './$types';

export const POST = apiRoute(
	'/api/settings/jellyfin-test',
	'POST',
	{
		summary: 'Test Jellyfin connection',
		tags: ['Settings'],
		auth: 'admin',
		body: {
			url: { type: 'string', required: true, description: 'Jellyfin server URL' },
			apiKey: { type: 'string', required: true, description: 'Jellyfin API key' },
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

		const { url, apiKey } = await request.json();

		if (!url || !apiKey) {
			return json({ success: false, error: 'URL and API key are required' });
		}

		try {
			const baseUrl = url.replace(/\/$/, '');
			const res = await internalFetch(`${baseUrl}/System/Info`, {
				headers: { 'X-Emby-Token': apiKey },
				signal: AbortSignal.timeout(10000),
			});

			if (!res.ok) {
				return json({ success: false, error: `Server returned ${res.status}` });
			}

			const info = await res.json();
			return json({ success: true, serverName: info.ServerName || 'Jellyfin' });
		} catch (e: any) {
			let message: string;
			if (e.name === 'TimeoutError') {
				message = 'Connection timed out';
			} else if (e.cause) {
				const cause = e.cause as any;
				if (cause.code === 'ECONNREFUSED') {
					message = 'Connection refused — is Jellyfin running?';
				} else if (cause.code === 'ENOTFOUND') {
					message = `Could not resolve host — check the server URL`;
				} else {
					message = cause.message || 'Connection failed';
				}
			} else {
				message = e.message || 'Connection failed';
			}
			return json({ success: false, error: message });
		}
	},
) satisfies RequestHandler;
