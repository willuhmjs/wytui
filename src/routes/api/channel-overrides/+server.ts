import { error } from '@sveltejs/kit';
import { channelOverrideService } from '$lib/server/services/channel-override.service';
import { apiRoute } from '$lib/server/openapi';
import { requireAdmin } from '$lib/server/guards';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/channel-overrides',
	'GET',
	{
		summary: 'List all channel overrides',
		tags: ['Channel Overrides'],
		auth: 'admin',
		responses: {
			200: {
				description: 'Array of channel override objects with profile info',
				schema: {
					type: 'array',
					items: {
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
			},
		},
	},
	async ({ locals }) => {
		try {
			requireAdmin(locals);

			const overrides = await channelOverrideService.list();

			return new Response(JSON.stringify(overrides), {
				headers: { 'Content-Type': 'application/json' },
			});
		} catch (e: any) {
			console.error('Failed to list channel overrides:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;

export const POST = apiRoute(
	'/api/channel-overrides',
	'POST',
	{
		summary: 'Create a channel override',
		tags: ['Channel Overrides'],
		auth: 'admin',
		body: {
			channelUrl: { type: 'string', required: true, description: 'Channel URL' },
			channelName: { type: 'string', description: 'Channel display name' },
			profileId: { type: 'string', description: 'Download profile ID to use for this channel' },
			autoDeleteDays: { type: 'integer', description: 'Auto-delete after N days' },
			sponsorblock: { type: 'boolean', description: 'Enable SponsorBlock for this channel' },
			customFlags: { type: 'array', description: 'Custom yt-dlp flags for this channel' },
		},
		responses: {
			201: {
				description: 'Created channel override object',
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
		},
	},
	async ({ request, locals }) => {
		try {
			requireAdmin(locals);

			const data = await request.json();

			if (!data.channelUrl) {
				throw error(400, 'Missing required field: channelUrl');
			}

			const override = await channelOverrideService.create({
				channelUrl: data.channelUrl,
				channelName: data.channelName,
				profileId: data.profileId,
				autoDeleteDays: data.autoDeleteDays,
				sponsorblock: data.sponsorblock,
				customFlags: data.customFlags,
			});

			return new Response(JSON.stringify(override), {
				status: 201,
				headers: { 'Content-Type': 'application/json' },
			});
		} catch (e: any) {
			console.error('Failed to create channel override:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
