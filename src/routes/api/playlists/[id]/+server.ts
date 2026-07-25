import { json, error } from '@sveltejs/kit';
import { playlistService } from '$lib/server/services/playlist.service';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/playlists/[id]',
	'GET',
	{
		summary: 'Get playlist details',
		tags: ['Playlists'],
		auth: true,
		params: { id: { type: 'string', description: 'Playlist ID' } },
		responses: {
			200: {
				description: 'Playlist with items',
				schema: {
					type: 'object',
					properties: {
						id: { type: 'string' },
						name: { type: 'string' },
						description: { type: 'string', nullable: true },
						items: { type: 'array' },
						createdAt: { type: 'string', format: 'date-time' },
						updatedAt: { type: 'string', format: 'date-time' },
					},
				},
			},
			404: { description: 'Playlist not found' },
		},
	},
	async ({ params, locals }) => {
		try {
			if (!locals.session?.user?.id) {
				throw error(401, 'Authentication required');
			}

			const playlist = await playlistService.get(params.id, locals.session.user.id);
			if (!playlist) {
				throw error(404, 'Playlist not found');
			}

			return json(playlist);
		} catch (e: any) {
			if (e.status) throw e;
			console.error('Failed to get playlist:', e);
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;

export const PATCH = apiRoute(
	'/api/playlists/[id]',
	'PATCH',
	{
		summary: 'Update a playlist',
		tags: ['Playlists'],
		auth: true,
		params: { id: { type: 'string', description: 'Playlist ID' } },
		body: {
			name: { type: 'string', description: 'New playlist name' },
			description: { type: 'string', description: 'New playlist description' },
		},
		responses: {
			200: {
				description: 'Updated playlist',
				schema: {
					type: 'object',
					properties: {
						id: { type: 'string' },
						name: { type: 'string' },
						description: { type: 'string', nullable: true },
					},
				},
			},
			404: { description: 'Playlist not found' },
		},
	},
	async ({ params, request, locals }) => {
		try {
			if (!locals.session?.user?.id) {
				throw error(401, 'Authentication required');
			}

			const body = await request.json();
			const data: { name?: string; description?: string } = {};
			if (body.name !== undefined) data.name = body.name.trim();
			if (body.description !== undefined) data.description = body.description?.trim() || null;

			const playlist = await playlistService.update(params.id, locals.session.user.id, data);
			return json(playlist);
		} catch (e: any) {
			if (e.status) throw e;
			if (e.message === 'Playlist not found') throw error(404, e.message);
			if (e.message === 'Access denied') throw error(403, e.message);
			if (e.code === 'P2002') throw error(409, 'A playlist with that name already exists');
			console.error('Failed to update playlist:', e);
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;

export const DELETE = apiRoute(
	'/api/playlists/[id]',
	'DELETE',
	{
		summary: 'Delete a playlist',
		tags: ['Playlists'],
		auth: true,
		params: { id: { type: 'string', description: 'Playlist ID' } },
		responses: {
			200: {
				description: 'Playlist deleted',
				schema: {
					type: 'object',
					properties: {
						success: { type: 'boolean' },
					},
				},
			},
			404: { description: 'Playlist not found' },
		},
	},
	async ({ params, locals }) => {
		try {
			if (!locals.session?.user?.id) {
				throw error(401, 'Authentication required');
			}

			await playlistService.delete(params.id, locals.session.user.id);
			return json({ success: true });
		} catch (e: any) {
			if (e.status) throw e;
			if (e.message === 'Playlist not found') throw error(404, e.message);
			if (e.message === 'Access denied') throw error(403, e.message);
			console.error('Failed to delete playlist:', e);
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
