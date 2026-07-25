import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { apiRoute } from '$lib/server/openapi';
import { internalFetch } from '$lib/server/utils/fetch';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/settings/jellyfin-users',
	'GET',
	{
		summary: 'List Jellyfin users',
		description: 'Proxies GET /Users from the configured Jellyfin server',
		tags: ['Settings'],
		auth: 'admin',
		responses: {
			200: {
				description: 'Array of Jellyfin users',
				schema: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							id: { type: 'string' },
							name: { type: 'string' },
						},
					},
				},
			},
		},
	},
	async ({ locals }) => {
		if (!locals.session?.user?.isAdmin) {
			throw error(403, 'Admin access required');
		}

		const settings = await prisma.settings.findUnique({
			where: { id: 'singleton' },
		});

		if (!settings?.jellyfinUrl || !settings?.jellyfinApiKey) {
			throw error(400, 'Jellyfin is not configured');
		}

		try {
			const baseUrl = settings.jellyfinUrl.replace(/\/$/, '');
			const res = await internalFetch(`${baseUrl}/Users`, {
				headers: { 'X-Emby-Token': settings.jellyfinApiKey },
				signal: AbortSignal.timeout(10000),
			});

			if (!res.ok) {
				throw error(502, `Jellyfin returned ${res.status}`);
			}

			const users = await res.json();
			return json(users.map((u: any) => ({ id: u.Id, name: u.Name })));
		} catch (e: any) {
			if (e.status) throw e;
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
					message = cause.message || 'Failed to connect to Jellyfin';
				}
			} else {
				message = e.message || 'Failed to fetch users';
			}
			throw error(502, message);
		}
	},
) satisfies RequestHandler;
