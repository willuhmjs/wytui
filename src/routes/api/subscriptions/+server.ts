import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { subscriptionService } from '$lib/server/services/subscription.service';
import { ytdlpService } from '$lib/server/services/ytdlp.service';
import { normalizeMaxDuration } from '$lib/server/utils/max-duration';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/subscriptions',
	'GET',
	{
		summary: 'List subscriptions',
		tags: ['Subscriptions'],
		auth: true,
		responses: {
			200: {
				description: 'Array of user subscriptions with profile info',
				schema: {
					type: 'array',
					items: {
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
			},
		},
	},
	async ({ url, locals }) => {
		try {
			if (!locals.session?.user?.id) {
				throw error(401, 'Authentication required');
			}

			const userId = locals.session.user.id;

			// Optional pagination — callers without `limit` get the full list (back-compat);
			// the UI passes limit/offset and uses a "load more" model.
			const hasLimit = url.searchParams.has('limit');
			let limit = parseInt(url.searchParams.get('limit') || '50', 10);
			let offset = parseInt(url.searchParams.get('offset') || '0', 10);
			if (isNaN(limit) || limit < 1) limit = 50;
			if (limit > 100) limit = 100;
			if (isNaN(offset) || offset < 0) offset = 0;

			const subscriptions = await prisma.subscription.findMany({
				where: { userId },
				include: { profile: true },
				orderBy: { createdAt: 'desc' },
				...(hasLimit ? { take: limit, skip: offset } : {}),
			});

			return json(subscriptions);
		} catch (e: any) {
			console.error('Failed to list subscriptions:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;

export const POST = apiRoute(
	'/api/subscriptions',
	'POST',
	{
		summary: 'Create a subscription',
		tags: ['Subscriptions'],
		auth: true,
		body: {
			url: { type: 'string', required: true, description: 'Channel/playlist URL' },
			name: { type: 'string', required: true, description: 'Subscription name' },
			profileId: { type: 'string', required: true, description: 'Download profile ID' },
			type: {
				type: 'string',
				description: 'Subscription type',
				enum: ['CHANNEL', 'PLAYLIST', 'USER'],
			},
			checkInterval: {
				type: 'integer',
				description: 'Check interval in seconds (60-86400)',
				minimum: 60,
				maximum: 86400,
				default: 1800,
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
			customFlags: { type: 'array', description: 'Custom yt-dlp flags' },
		},
		responses: {
			201: {
				description: 'Created subscription',
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
		},
	},
	async ({ request, locals }) => {
		try {
			if (!locals.session?.user?.id) {
				throw error(401, 'Authentication required');
			}

			const data = await request.json();
			const userId = locals.session.user.id;

			if (!data.url || !data.name || !data.profileId) {
				throw error(400, 'Missing required fields: url, name, profileId');
			}

			try {
				const urlObj = new URL(data.url);
				if (!['http:', 'https:'].includes(urlObj.protocol)) {
					throw error(400, 'Only HTTP(S) URLs are allowed');
				}
			} catch (urlErr: any) {
				if (urlErr.status) throw urlErr;
				throw error(400, 'Invalid URL format');
			}

			const validTypes = ['CHANNEL', 'PLAYLIST', 'USER'];
			if (data.type && !validTypes.includes(data.type)) {
				throw error(400, 'Invalid subscription type');
			}

			const profile = await prisma.downloadProfile.findUnique({
				where: { id: data.profileId },
			});
			if (!profile) {
				throw error(400, 'Invalid profile ID');
			}
			if (!profile.isSystem && profile.userId !== userId) {
				throw error(403, "Cannot use another user's profile");
			}

			const checkInterval = parseInt(data.checkInterval) || 1800;
			if (checkInterval < 60 || checkInterval > 86400) {
				throw error(400, 'Check interval must be between 60 and 86400 seconds');
			}

			const existing = await prisma.subscription.findFirst({
				where: { url: data.url, userId },
			});
			if (existing) {
				throw error(409, 'A subscription for this URL already exists');
			}

			const customFlags = Array.isArray(data.customFlags) ? data.customFlags : [];
			if (customFlags.length > 0) {
				const badFlag = ytdlpService.findDangerousFlag(customFlags);
				if (badFlag) {
					throw error(400, `Forbidden flag: ${badFlag}`);
				}
			}

			const subscription = await prisma.subscription.create({
				data: {
					url: data.url,
					name: data.name,
					type: data.type || 'CHANNEL',
					profileId: data.profileId,
					checkInterval,
					autoDownload: data.autoDownload ?? true,
					saveToLibrary: data.saveToLibrary ?? false,
					excludeShorts: data.excludeShorts ?? false,
					maxDurationSeconds: normalizeMaxDuration(data.maxDurationSeconds),
					customFlags,
					enabled: true,
					userId,
				},
				include: { profile: true },
			});

			await subscriptionService.scheduleSubscription(subscription);

			// Resolve the channel name in the background so the response is immediate
			if (data.name === data.url) {
				ytdlpService
					.fetchChannelName(data.url)
					.then(async (channelName) => {
						if (channelName && channelName !== data.url) {
							await prisma.subscription
								.update({
									where: { id: subscription.id },
									data: { name: channelName },
								})
								.catch(() => {});
						}
					})
					.catch(() => {});
			}

			subscriptionService
				.seedArchive(subscription.id)
				.catch((err) =>
					console.error(`[Subscriptions] Failed to seed archive for ${subscription.name}:`, err),
				);

			return json(subscription, { status: 201 });
		} catch (e: any) {
			console.error('Failed to create subscription:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
