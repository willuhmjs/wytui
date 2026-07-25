import { error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { channelOverrideService } from '$lib/server/services/channel-override.service';
import { apiRoute } from '$lib/server/openapi';
import { requireAdmin } from '$lib/server/guards';
import type { RequestHandler } from './$types';

export const PATCH = apiRoute(
	'/api/channel-overrides/[id]',
	'PATCH',
	{
		summary: 'Update a channel override',
		tags: ['Channel Overrides'],
		auth: 'admin',
		params: { id: { type: 'string', description: 'Channel override ID' } },
		body: {
			channelUrl: { type: 'string', description: 'Channel URL' },
			channelName: { type: 'string', description: 'Channel display name' },
			profileId: { type: 'string', description: 'Download profile ID', nullable: true },
			autoDeleteDays: { type: 'integer', description: 'Auto-delete after N days', nullable: true },
			sponsorblock: { type: 'boolean', description: 'Enable SponsorBlock for this channel' },
			customFlags: { type: 'array', description: 'Custom yt-dlp flags for this channel' },
		},
		responses: {
			200: {
				description: 'Updated channel override object',
				schema: {
					type: 'object',
					properties: {
						id: { type: 'string' },
						channelUrl: { type: 'string' },
						channelName: { type: 'string', nullable: true },
						profileId: { type: 'string', nullable: true },
						autoDeleteDays: { type: 'integer', nullable: true },
						sponsorblock: { type: 'boolean' },
						customFlags: { type: 'array', items: { type: 'string' } },
						createdAt: { type: 'string', format: 'date-time' },
						updatedAt: { type: 'string', format: 'date-time' },
					},
				},
			},
			404: { description: 'Channel override not found' },
		},
	},
	async ({ params, request, locals }) => {
		try {
			requireAdmin(locals);

			const existing = await prisma.channelOverride.findUnique({
				where: { id: params.id },
			});

			if (!existing) {
				throw error(404, 'Channel override not found');
			}

			const body = await request.json();

			const allowedFields = [
				'channelUrl',
				'channelName',
				'profileId',
				'autoDeleteDays',
				'sponsorblock',
				'customFlags',
			];
			const updates: Record<string, any> = {};
			for (const key of allowedFields) {
				if (key in body) updates[key] = body[key];
			}

			const override = await channelOverrideService.update(params.id, updates);

			return new Response(JSON.stringify(override), {
				headers: { 'Content-Type': 'application/json' },
			});
		} catch (e: any) {
			console.error('Failed to update channel override:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;

export const DELETE = apiRoute(
	'/api/channel-overrides/[id]',
	'DELETE',
	{
		summary: 'Delete a channel override',
		tags: ['Channel Overrides'],
		auth: 'admin',
		params: { id: { type: 'string', description: 'Channel override ID' } },
		responses: {
			200: {
				description: 'Channel override deleted',
				schema: {
					type: 'object',
					properties: {
						success: { type: 'boolean' },
					},
				},
			},
			404: { description: 'Channel override not found' },
		},
	},
	async ({ params, locals }) => {
		try {
			requireAdmin(locals);

			const existing = await prisma.channelOverride.findUnique({
				where: { id: params.id },
			});

			if (!existing) {
				throw error(404, 'Channel override not found');
			}

			await channelOverrideService.delete(params.id);

			return new Response(JSON.stringify({ success: true }), {
				headers: { 'Content-Type': 'application/json' },
			});
		} catch (e: any) {
			console.error('Failed to delete channel override:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
