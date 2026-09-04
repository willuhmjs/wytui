import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { subscriptionService } from '$lib/server/services/subscription.service';
import { ytdlpService } from '$lib/server/services/ytdlp.service';
import { normalizeMaxDuration } from '$lib/server/utils/max-duration';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/subscriptions/[id]',
	'GET',
	{
		summary: 'Get subscription by ID',
		tags: ['Subscriptions'],
		auth: true,
		params: { id: { type: 'string', description: 'Subscription ID' } },
		responses: {
			200: {
				description: 'Subscription with profile and recent downloads',
				schema: {
					type: 'object',
					properties: {
						id: { type: 'string' },
						url: { type: 'string' },
						name: { type: 'string' },
						type: { type: 'string', enum: ['CHANNEL', 'PLAYLIST', 'USER'] },
						enabled: { type: 'boolean' },
						checkInterval: { type: 'integer' },
						autoDownload: { type: 'boolean' },
						saveToLibrary: { type: 'boolean' },
						profileId: { type: 'string' },
						customFlags: { type: 'array', items: { type: 'string' } },
						userId: { type: 'string', nullable: true },
						createdAt: { type: 'string', format: 'date-time' },
					},
				},
			},
			404: { description: 'Subscription not found' },
		},
	},
	async ({ params, locals }) => {
		try {
			if (!locals.session?.user?.id) {
				throw error(401, 'Authentication required');
			}

			const subscription = await prisma.subscription.findUnique({
				where: { id: params.id },
				include: { profile: true, downloads: { take: 10, orderBy: { createdAt: 'desc' } } },
			});

			if (!subscription) {
				throw error(404, 'Subscription not found');
			}

			if (subscription.userId !== locals.session.user.id && !locals.session.user.isAdmin) {
				throw error(403, 'Access denied');
			}

			return json(subscription);
		} catch (e: any) {
			console.error('Failed to get subscription:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;

export const PATCH = apiRoute(
	'/api/subscriptions/[id]',
	'PATCH',
	{
		summary: 'Update a subscription',
		tags: ['Subscriptions'],
		auth: true,
		params: { id: { type: 'string', description: 'Subscription ID' } },
		body: {
			name: { type: 'string', description: 'Subscription name' },
			url: { type: 'string', description: 'Channel/playlist URL' },
			type: {
				type: 'string',
				description: 'Subscription type',
				enum: ['CHANNEL', 'PLAYLIST', 'USER'],
			},
			enabled: { type: 'boolean', description: 'Enable/disable subscription' },
			checkInterval: {
				type: 'integer',
				description: 'Check interval (60-86400s)',
				minimum: 60,
				maximum: 86400,
			},
			autoDownload: { type: 'boolean', description: 'Auto-download new videos' },
			saveToLibrary: { type: 'boolean', description: 'Save to library' },
			excludeShorts: { type: 'boolean', description: 'Skip shorts/vertical videos' },
			maxDurationSeconds: {
				type: 'integer',
				nullable: true,
				minimum: 1,
				maximum: 2592000,
				description: 'Skip videos longer than this many seconds (null = no limit)',
			},
			profileId: { type: 'string', description: 'Download profile ID' },
			customFlags: { type: 'array', description: 'Custom yt-dlp flags' },
		},
		responses: {
			200: {
				description: 'Updated subscription',
				schema: {
					type: 'object',
					properties: {
						id: { type: 'string' },
						url: { type: 'string' },
						name: { type: 'string' },
						type: { type: 'string', enum: ['CHANNEL', 'PLAYLIST', 'USER'] },
						enabled: { type: 'boolean' },
						checkInterval: { type: 'integer' },
						autoDownload: { type: 'boolean' },
						saveToLibrary: { type: 'boolean' },
						profileId: { type: 'string' },
						customFlags: { type: 'array', items: { type: 'string' } },
						userId: { type: 'string', nullable: true },
						createdAt: { type: 'string', format: 'date-time' },
					},
				},
			},
			404: { description: 'Subscription not found' },
		},
	},
	async ({ params, request, locals }) => {
		try {
			if (!locals.session?.user?.id) {
				throw error(401, 'Authentication required');
			}

			const existing = await prisma.subscription.findUnique({
				where: { id: params.id },
			});

			if (!existing) {
				throw error(404, 'Subscription not found');
			}

			if (existing.userId !== locals.session.user.id && !locals.session.user.isAdmin) {
				throw error(403, 'Access denied');
			}

			const body = await request.json();

			const allowedFields = [
				'name',
				'url',
				'type',
				'enabled',
				'checkInterval',
				'autoDownload',
				'saveToLibrary',
				'excludeShorts',
				'maxDurationSeconds',
				'profileId',
				'customFlags',
			];
			const updates: Record<string, any> = {};
			for (const key of allowedFields) {
				if (key in body) updates[key] = body[key];
			}

			if (updates.maxDurationSeconds !== undefined) {
				updates.maxDurationSeconds = normalizeMaxDuration(updates.maxDurationSeconds);
			}

			// A new URL may point at a different channel — drop the cached channel
			// ID so the RSS check re-resolves it.
			if (updates.url !== undefined && updates.url !== existing.url) {
				updates.channelId = null;
			}

			if (updates.type !== undefined) {
				const validTypes = ['CHANNEL', 'PLAYLIST', 'USER'];
				if (!validTypes.includes(updates.type)) {
					throw error(400, 'Invalid subscription type');
				}
			}

			if (updates.checkInterval !== undefined) {
				const val = parseInt(updates.checkInterval);
				if (isNaN(val) || val < 60 || val > 86400) {
					throw error(400, 'Check interval must be between 60 and 86400 seconds');
				}
				updates.checkInterval = val;
			}

			if (updates.profileId !== undefined) {
				const profile = await prisma.downloadProfile.findUnique({
					where: { id: updates.profileId },
				});
				if (!profile) {
					throw error(400, 'Invalid profile ID');
				}
				if (!profile.isSystem && profile.userId !== locals.session.user.id) {
					throw error(403, "Cannot use another user's profile");
				}
			}

			if (updates.customFlags !== undefined) {
				if (!Array.isArray(updates.customFlags)) {
					throw error(400, 'customFlags must be an array');
				}
				const badFlag = ytdlpService.findDangerousFlag(updates.customFlags);
				if (badFlag) {
					throw error(400, `Forbidden flag: ${badFlag}`);
				}
			}

			const subscription = await prisma.subscription.update({
				where: { id: params.id },
				data: updates,
				include: { profile: true },
			});

			if (body.enabled !== undefined || body.checkInterval !== undefined) {
				if (subscription.enabled) {
					await subscriptionService.scheduleSubscription(subscription);
				} else {
					subscriptionService.unscheduleSubscription(params.id);
				}
			}

			return json(subscription);
		} catch (e: any) {
			console.error('Failed to update subscription:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;

export const DELETE = apiRoute(
	'/api/subscriptions/[id]',
	'DELETE',
	{
		summary: 'Delete a subscription',
		tags: ['Subscriptions'],
		auth: true,
		params: { id: { type: 'string', description: 'Subscription ID' } },
		responses: {
			200: {
				description: 'Subscription deleted',
				schema: {
					type: 'object',
					properties: {
						success: { type: 'boolean' },
					},
				},
			},
			404: { description: 'Subscription not found' },
		},
	},
	async ({ params, locals }) => {
		try {
			if (!locals.session?.user?.id) {
				throw error(401, 'Authentication required');
			}

			const existing = await prisma.subscription.findUnique({
				where: { id: params.id },
			});

			if (!existing) {
				throw error(404, 'Subscription not found');
			}

			if (existing.userId !== locals.session.user.id && !locals.session.user.isAdmin) {
				throw error(403, 'Access denied');
			}

			subscriptionService.unscheduleSubscription(params.id);

			await prisma.subscription.delete({
				where: { id: params.id },
			});

			return json({ success: true });
		} catch (e: any) {
			console.error('Failed to delete subscription:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
