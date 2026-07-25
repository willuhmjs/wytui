import { describe, it, expect, vi, beforeEach } from 'vitest';

const links: any = {};
const watch: any[] = [];
vi.mock('../db', () => ({
	prisma: {
		youTubeLink: {
			findUnique: vi.fn(async ({ where }) => links[where.userId] ?? null),
			update: vi.fn(async ({ where, data }) => {
				links[where.userId] = { ...links[where.userId], ...data };
			}),
		},
		watchProgress: {
			findMany: vi.fn(async () => watch.filter((w) => w.watched)),
		},
		download: {
			findUnique: vi.fn(async ({ where }) => ({ id: where.id, videoId: 'vid-' + where.id })),
			findMany: vi.fn(async ({ where }) => {
				const ids: string[] = where?.id?.in ?? [];
				return ids.map((id) => ({ id, videoId: 'vid-' + id }));
			}),
		},
	},
}));
vi.mock('./youtube.service', () => ({
	youtubeService: {
		markWatchedOnYouTube: vi.fn(async () => true),
	},
}));
vi.mock('./youtube-link.service', () => ({
	youtubeLinkService: { getCookiesTxt: vi.fn(async () => 'cookie-text') },
}));

process.env.AUTH_SECRET = 'x';
import { youtubeSyncService } from './youtube-sync.service';

describe('pushWatchedToYouTube', () => {
	beforeEach(() => {
		for (const k of Object.keys(links)) delete links[k];
		watch.length = 0;
	});

	it('needsRelink when no cookies', async () => {
		const { youtubeLinkService } = await import('./youtube-link.service');
		(youtubeLinkService.getCookiesTxt as any).mockResolvedValueOnce(null);
		links['u1'] = { userId: 'u1', syncWatchedToYouTube: true };
		expect(await youtubeSyncService.pushWatchedToYouTube('u1')).toEqual({ needsRelink: true });
	});

	it('pushes newly-watched items', async () => {
		links['u1'] = { userId: 'u1', syncWatchedToYouTube: true, lastHistorySync: null };
		watch.push({ downloadId: 'd1', watched: true, watchedAt: new Date() });
		const res = await youtubeSyncService.pushWatchedToYouTube('u1');
		expect(res).toEqual({ pushed: 1 });
	});
});
