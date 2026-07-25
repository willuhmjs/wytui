import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

interface VersionCache {
	currentSha: string;
	latestSha: string;
	updateAvailable: boolean;
	checkedAt: number;
}

let cache: VersionCache | null = null;
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour
const COMMITS_URL = 'https://github.com/willuhmjs/wytui/commits/main';

function getCurrentSha(): string {
	return (process.env.GIT_SHA || 'unknown').slice(0, 7);
}

export const GET = apiRoute(
	'/api/version',
	'GET',
	{
		summary: 'Check for app updates',
		description:
			'Compares the running commit SHA with the latest commit on main. Results are cached for 1 hour.',
		tags: ['Settings'],
		auth: true,
		responses: {
			200: {
				description: 'Version check result',
				schema: {
					type: 'object',
					properties: {
						currentSha: { type: 'string' },
						latestSha: { type: 'string' },
						updateAvailable: { type: 'boolean' },
						commitsUrl: { type: 'string' },
					},
				},
			},
		},
	},
	async ({ locals }) => {
		if (!locals.session?.user?.id) {
			throw error(401, 'Authentication required');
		}

		const settings = await prisma.settings.findUnique({
			where: { id: 'singleton' },
			select: { versionCheckEnabled: true },
		});

		const currentSha = getCurrentSha();

		if (!settings?.versionCheckEnabled) {
			return json({
				currentSha,
				latestSha: currentSha,
				updateAvailable: false,
				commitsUrl: COMMITS_URL,
			});
		}

		if (cache && Date.now() - cache.checkedAt < CACHE_DURATION_MS) {
			return json({
				currentSha: cache.currentSha,
				latestSha: cache.latestSha,
				updateAvailable: cache.updateAvailable,
				commitsUrl: COMMITS_URL,
			});
		}

		try {
			const res = await fetch('https://api.github.com/repos/willuhmjs/wytui/commits/main', {
				headers: {
					Accept: 'application/vnd.github.v3+json',
					'User-Agent': `wytui/${currentSha}`,
				},
			});

			if (!res.ok) {
				return json({
					currentSha,
					latestSha: currentSha,
					updateAvailable: false,
					commitsUrl: COMMITS_URL,
				});
			}

			const commit = await res.json();
			const latestSha = (commit.sha || '').slice(0, 7);
			const updateAvailable = !!latestSha && currentSha !== 'unknown' && latestSha !== currentSha;

			cache = { currentSha, latestSha, updateAvailable, checkedAt: Date.now() };

			return json({ currentSha, latestSha, updateAvailable, commitsUrl: COMMITS_URL });
		} catch {
			return json({
				currentSha,
				latestSha: currentSha,
				updateAvailable: false,
				commitsUrl: COMMITS_URL,
			});
		}
	},
) satisfies RequestHandler;
