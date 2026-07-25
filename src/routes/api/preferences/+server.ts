import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

const VALID_MODES = new Set(['video_library', 'video_cache', 'audio_library', 'audio_cache']);

export const GET = apiRoute(
	'/api/preferences',
	'GET',
	{
		summary: 'Get download preferences for the current user',
		description:
			'Returns all saved preference sets keyed by mode (video_library, video_cache, audio_library, audio_cache)',
		tags: ['Preferences'],
		auth: true,
		responses: {
			200: {
				description: 'Preferences object keyed by mode',
				schema: { type: 'object' },
			},
		},
	},
	async ({ locals }) => {
		const userId = locals.session?.user?.id;
		if (!userId) throw error(401, 'Authentication required');

		const rows = await prisma.userPreference.findMany({ where: { userId } });
		const result: Record<string, any> = {};
		for (const row of rows) {
			result[row.mode] = row.prefs;
		}
		return json(result);
	},
) satisfies RequestHandler;

export const PUT = apiRoute(
	'/api/preferences',
	'PUT',
	{
		summary: 'Save download preferences for a mode',
		description:
			'Upserts preferences for a specific mode (video_library, video_cache, audio_library, audio_cache)',
		tags: ['Preferences'],
		auth: true,
		body: {
			mode: { type: 'string', description: 'Preference mode', required: true },
			prefs: { type: 'object', description: 'Preference values', required: true },
		},
		responses: {
			200: {
				description: 'Saved preferences',
				schema: { type: 'object' },
			},
		},
	},
	async ({ request, locals }) => {
		const userId = locals.session?.user?.id;
		if (!userId) throw error(401, 'Authentication required');

		const { mode, prefs } = await request.json();

		if (!mode || !VALID_MODES.has(mode)) {
			throw error(400, `Invalid mode. Must be one of: ${[...VALID_MODES].join(', ')}`);
		}

		if (!prefs || typeof prefs !== 'object') {
			throw error(400, 'prefs must be an object');
		}

		const row = await prisma.userPreference.upsert({
			where: { userId_mode: { userId, mode } },
			create: { userId, mode, prefs },
			update: { prefs },
		});

		return json({ mode: row.mode, prefs: row.prefs });
	},
) satisfies RequestHandler;
