import { json, error } from '@sveltejs/kit';
import { playlistService } from '$lib/server/services/playlist.service';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const POST = apiRoute(
	'/api/playlists/[id]/items',
	'POST',
	{
		summary: 'Add item to playlist',
		tags: ['Playlists'],
		auth: true,
		params: { id: { type: 'string', description: 'Playlist ID' } },
		body: {
			downloadId: { type: 'string', required: true, description: 'Download ID to add' },
		},
		responses: {
			201: {
				description: 'Item added',
				schema: {
					type: 'object',
					properties: {
						id: { type: 'string' },
						playlistId: { type: 'string' },
						downloadId: { type: 'string' },
						position: { type: 'integer' },
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

			const { downloadId } = await request.json();
			if (!downloadId) {
				throw error(400, 'downloadId is required');
			}

			const item = await playlistService.addItem(params.id, locals.session.user.id, downloadId);
			return json(item, { status: 201 });
		} catch (e: any) {
			if (e.status) throw e;
			if (e.message === 'Playlist not found') throw error(404, e.message);
			if (e.message === 'Download not found') throw error(404, e.message);
			if (e.message === 'Not in library')
				throw error(400, 'Only library items can be added to playlists');
			if (e.message === 'Access denied') throw error(403, e.message);
			if (e.code === 'P2002') throw error(409, 'Item already in playlist');
			console.error('Failed to add playlist item:', e);
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;

export const DELETE = apiRoute(
	'/api/playlists/[id]/items',
	'DELETE',
	{
		summary: 'Remove item from playlist',
		tags: ['Playlists'],
		auth: true,
		params: { id: { type: 'string', description: 'Playlist ID' } },
		body: {
			downloadId: { type: 'string', description: 'Download ID to remove (downloaded items)' },
			itemId: { type: 'string', description: 'Playlist item ID to remove (pending items)' },
		},
		responses: {
			200: {
				description: 'Item removed',
				schema: {
					type: 'object',
					properties: {
						success: { type: 'boolean' },
					},
				},
			},
			404: { description: 'Playlist or item not found' },
		},
	},
	async ({ params, request, locals }) => {
		try {
			if (!locals.session?.user?.id) {
				throw error(401, 'Authentication required');
			}

			const { downloadId, itemId } = await request.json();
			if (itemId) {
				// Pending items have no downloadId — remove by their own id.
				await playlistService.removeItemById(params.id, locals.session.user.id, itemId);
			} else if (downloadId) {
				await playlistService.removeItem(params.id, locals.session.user.id, downloadId);
			} else {
				throw error(400, 'downloadId or itemId is required');
			}
			return json({ success: true });
		} catch (e: any) {
			if (e.status) throw e;
			if (e.message === 'Playlist not found') throw error(404, e.message);
			if (e.message === 'Item not found') throw error(404, e.message);
			if (e.message === 'Access denied') throw error(403, e.message);
			console.error('Failed to remove playlist item:', e);
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;

export const PATCH = apiRoute(
	'/api/playlists/[id]/items',
	'PATCH',
	{
		summary: 'Reorder playlist items',
		tags: ['Playlists'],
		auth: true,
		params: { id: { type: 'string', description: 'Playlist ID' } },
		body: {
			itemIds: { type: 'array', required: true, description: 'Ordered array of item IDs' },
		},
		responses: {
			200: {
				description: 'Items reordered',
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
	async ({ params, request, locals }) => {
		try {
			if (!locals.session?.user?.id) {
				throw error(401, 'Authentication required');
			}

			const { itemIds } = await request.json();
			if (!Array.isArray(itemIds) || itemIds.length === 0) {
				throw error(400, 'itemIds must be a non-empty array');
			}

			await playlistService.reorderItems(params.id, locals.session.user.id, itemIds);
			return json({ success: true });
		} catch (e: any) {
			if (e.status) throw e;
			if (e.message === 'Playlist not found') throw error(404, e.message);
			if (e.message === 'Access denied') throw error(403, e.message);
			console.error('Failed to reorder playlist items:', e);
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
