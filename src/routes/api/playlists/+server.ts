import { json, error } from '@sveltejs/kit';
import { playlistService } from '$lib/server/services/playlist.service';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/playlists',
	'GET',
	{
		summary: 'List playlists',
		tags: ['Playlists'],
		auth: true,
		responses: {
			200: {
				description: 'List of playlists with item counts',
				schema: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							id: { type: 'string' },
							name: { type: 'string' },
							description: { type: 'string', nullable: true },
							itemCount: { type: 'integer' },
							createdAt: { type: 'string', format: 'date-time' },
							updatedAt: { type: 'string', format: 'date-time' },
						},
					},
				},
			},
		},
	},
	async ({ locals }) => {
		try {
			if (!locals.session?.user?.id) {
				throw error(401, 'Authentication required');
			}

			const playlists = await playlistService.list(locals.session.user.id);
			return json(playlists);
		} catch (e: any) {
			if (e.status) throw e;
			console.error('Failed to list playlists:', e);
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;

export const POST = apiRoute(
	'/api/playlists',
	'POST',
	{
		summary: 'Create a playlist',
		tags: ['Playlists'],
		auth: true,
		body: {
			name: { type: 'string', required: true, description: 'Playlist name' },
			description: { type: 'string', description: 'Playlist description' },
		},
		responses: {
			201: {
				description: 'Created playlist',
				schema: {
					type: 'object',
					properties: {
						id: { type: 'string' },
						name: { type: 'string' },
						description: { type: 'string', nullable: true },
						createdAt: { type: 'string', format: 'date-time' },
					},
				},
			},
		},
	},
	async ({ request, locals }) => {
		try {
			if (!locals.session?.user?.id) {
				throw error(401, 'Authentication required');
			}

			const { name, description } = await request.json();

			if (!name || typeof name !== 'string' || !name.trim()) {
				throw error(400, 'Name is required');
			}

			const playlist = await playlistService.create(
				locals.session.user.id,
				name.trim(),
				description?.trim(),
			);
			return json(playlist, { status: 201 });
		} catch (e: any) {
			if (e.status) throw e;
			if (e.code === 'P2002') {
				throw error(409, 'A playlist with that name already exists');
			}
			console.error('Failed to create playlist:', e);
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
