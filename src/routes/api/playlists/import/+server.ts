import { json, error } from '@sveltejs/kit';
import { downloadService } from '$lib/server/services/download.service';
import { ytdlpService } from '$lib/server/services/ytdlp.service';
import { youtubeService } from '$lib/server/services/youtube.service';
import { prisma } from '$lib/server/db';
import { apiRoute } from '$lib/server/openapi';
import { sseEmitter } from '$lib/server/sse/emitter';
import type { RequestHandler } from './$types';

export const POST = apiRoute(
	'/api/playlists/import',
	'POST',
	{
		summary: 'Import a YouTube playlist as individual downloads',
		tags: ['Downloads'],
		auth: true,
		body: {
			url: { type: 'string', required: true, description: 'YouTube playlist URL' },
			profileId: { type: 'string', required: true, description: 'Download profile ID' },
			saveToLibrary: { type: 'boolean', description: 'Save to library instead of cache' },
			customFlags: { type: 'array', description: 'Custom yt-dlp flags' },
		},
		responses: {
			200: {
				description: 'Playlist import result',
				schema: {
					type: 'object',
					properties: {
						playlistTitle: { type: 'string' },
						totalVideos: { type: 'integer' },
						createdIds: { type: 'array', items: { type: 'string' } },
						skipped: { type: 'integer' },
						errors: { type: 'array', items: { type: 'string' } },
					},
				},
			},
		},
	},
	async ({ request, locals }) => {
		try {
			const userId = locals.session?.user?.id;
			if (!userId) {
				throw error(401, 'Authentication required');
			}

			const { url, profileId, saveToLibrary, customFlags } = await request.json();

			if (!url || !profileId) {
				throw error(400, 'Missing required fields: url, profileId');
			}

			// Validate URL
			ytdlpService.validateUrl(url);

			// Verify profile exists and user has access
			const profile = await prisma.downloadProfile.findUnique({
				where: { id: profileId },
			});
			if (!profile) {
				throw error(400, 'Invalid profile ID');
			}
			if (!profile.isSystem && profile.userId !== userId) {
				throw error(403, "Cannot use another user's profile");
			}

			const flags: string[] = Array.isArray(customFlags) ? customFlags : [];

			// Send initial SSE event
			sseEmitter.broadcastToUser('playlist:import:start', { url }, userId);

			// Extract playlist entries via the shared, timeout-guarded yt-dlp runner
			// (cookie-less flat fetch). This replaces a duplicate local spawn that
			// had no timeout/settled guard.
			let title: string | null;
			let entries;
			try {
				({ title, entries } = await youtubeService.fetchPlaylistFlat(url));
			} catch (e: any) {
				throw error(400, e.message || 'Failed to extract playlist information');
			}

			// Preserve the real playlist title, falling back only when absent.
			const playlistTitle = title || 'Unknown Playlist';

			if (entries.length === 0) {
				throw error(400, 'Playlist contains no videos');
			}

			// Send progress with total count
			sseEmitter.broadcastToUser(
				'playlist:import:progress',
				{
					playlistTitle,
					total: entries.length,
					created: 0,
					skipped: 0,
				},
				userId,
			);

			const createdIds: string[] = [];
			const errors: string[] = [];
			let skipped = 0;

			// Create downloads for each entry
			for (let i = 0; i < entries.length; i++) {
				const entry = entries[i];

				try {
					const download = await downloadService.createDownload(
						entry.url,
						profileId,
						userId,
						undefined,
						!!saveToLibrary,
						flags,
					);
					createdIds.push(download.id);
				} catch (e: any) {
					if (e.message?.includes('already being downloaded')) {
						skipped++;
					} else {
						errors.push(`${entry.title || entry.url}: ${e.message}`);
					}
				}

				// Send progress update every 5 items or on the last item
				if ((i + 1) % 5 === 0 || i === entries.length - 1) {
					sseEmitter.broadcastToUser(
						'playlist:import:progress',
						{
							playlistTitle,
							total: entries.length,
							created: createdIds.length,
							skipped,
							errors: errors.length,
							current: i + 1,
						},
						userId,
					);
				}
			}

			// Send completion event
			sseEmitter.broadcastToUser(
				'playlist:import:complete',
				{
					playlistTitle,
					totalVideos: entries.length,
					created: createdIds.length,
					skipped,
					errors: errors.length,
				},
				userId,
			);

			return json({
				playlistTitle,
				totalVideos: entries.length,
				createdIds,
				skipped,
				errors,
			});
		} catch (e: any) {
			console.error('Failed to import playlist:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
