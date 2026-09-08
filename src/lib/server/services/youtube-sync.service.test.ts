import { describe, it, expect, vi, beforeEach } from 'vitest';

const links: any = {};
const watch: any[] = [];
let settings: any = null;
let history: any[] = [];
const watchUpserts: any[] = [];

vi.mock('../db', () => ({
	prisma: {
		settings: {
			findUnique: vi.fn(async () => settings),
		},
		youTubeLink: {
			findUnique: vi.fn(async ({ where }) => links[where.userId] ?? null),
			findMany: vi.fn(async () => Object.values(links)),
			update: vi.fn(async ({ where, data }) => {
				links[where.userId] = { ...links[where.userId], ...data };
			}),
		},
		watchProgress: {
			findMany: vi.fn(async ({ where }) =>
				where?.watched ? watch.filter((w) => w.watched) : watch,
			),
			upsert: vi.fn(async (args: any) => {
				watchUpserts.push(args);
				return {};
			}),
		},
		download: {
			findUnique: vi.fn(async ({ where }) => ({ id: where.id, videoId: 'vid-' + where.id })),
			findMany: vi.fn(async ({ where }: any) => {
				if (where?.videoId?.in) {
					// Library rows: id d-<videoId>, one per known videoId.
					return where.videoId.in.map((videoId: string) => ({
						id: 'd-' + videoId,
						videoId,
						filepath: `/media/Chan/${videoId}/${videoId}.mp4`,
					}));
				}
				const ids: string[] = where?.id?.in ?? [];
				return ids.map((id) => {
					const vid = id.startsWith('d-') ? id.slice(2) : id;
					return { id, videoId: 'vid-' + id, filepath: `/media/Chan/${vid}/${vid}.mp4` };
				});
			}),
		},
	},
}));
vi.mock('./youtube.service', () => ({
	youtubeService: {
		markWatchedOnYouTube: vi.fn(async () => true),
		fetchHistory: vi.fn(async () => history),
	},
}));
vi.mock('./youtube-link.service', () => ({
	youtubeLinkService: { getCookiesTxt: vi.fn(async () => 'cookie-text') },
}));
vi.mock('./jellyfin.service', () => ({
	jellyfinService: {
		listUsers: vi.fn(async () => jellyfinUsers),
		findItemIdByPath: vi.fn(async () => 'item-1'),
		markItemPlayed: vi.fn(async () => true),
	},
	mapToJellyfinPath: (p: string, l?: string | null, r?: string | null) => {
		if (!l || !r) return p;
		if (p !== l && !p.startsWith(l + '/')) return p;
		return r + p.slice(l.length);
	},
}));

let jellyfinUsers: { id: string; name: string }[] = [];

process.env.AUTH_SECRET = 'x';
import { youtubeSyncService } from './youtube-sync.service';

describe('pushWatchedToYouTube', () => {
	beforeEach(() => {
		for (const k of Object.keys(links)) delete links[k];
		watch.length = 0;
		watchUpserts.length = 0;
		history = [];
		settings = null;
		jellyfinUsers = [];
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

describe('reconcileHistory + Jellyfin playstate', () => {
	beforeEach(async () => {
		for (const k of Object.keys(links)) delete links[k];
		watch.length = 0;
		watchUpserts.length = 0;
		history = [{ id: 'abc123', title: 'V', url: 'https://youtube.com/watch?v=abc123' }];
		settings = {
			jellyfinUrl: 'http://jf:8096',
			jellyfinApiKey: 'key',
			jellyfinLocalPath: null,
			jellyfinRemotePath: null,
		};
		jellyfinUsers = [];
		const { jellyfinService, mapToJellyfinPath } = await import('./jellyfin.service');
		(jellyfinService.listUsers as any).mockReset().mockResolvedValue(jellyfinUsers);
		(jellyfinService.findItemIdByPath as any).mockReset().mockResolvedValue('item-1');
		(jellyfinService.markItemPlayed as any).mockReset().mockResolvedValue(true);
		vi.restoreAllMocks();
		void mapToJellyfinPath;
	});

	it('marks watched and pushes played state for the account Jellyfin user', async () => {
		const { jellyfinService } = await import('./jellyfin.service');
		links['u1'] = {
			userId: 'u1',
			syncHistoryToWytui: true,
			jellyfinUserId: 'ju-ryzen',
			lastHistorySync: null,
		};

		const res = await youtubeSyncService.reconcileHistory('u1');
		expect(res).toMatchObject({ marked: 1, jellyfin: { user: 'ju-ryzen', marked: 1 } });
		expect(watchUpserts).toHaveLength(1);
		expect(watchUpserts[0].create).toMatchObject({ watched: true });
		expect(jellyfinService.findItemIdByPath).toHaveBeenCalledWith(
			'http://jf:8096',
			'key',
			'/media/Chan/abc123/abc123.mp4',
		);
		expect(jellyfinService.markItemPlayed).toHaveBeenCalledWith(
			'http://jf:8096',
			'key',
			'ju-ryzen',
			'item-1',
		);
		// Watermark advanced so the stamped rows are not re-pushed next cycle.
		expect(links['u1'].lastHistorySync).toBeInstanceOf(Date);
	});

	it('maps the file path into Jellyfin path space before lookup', async () => {
		const { jellyfinService } = await import('./jellyfin.service');
		settings = {
			jellyfinUrl: 'http://jf:8096',
			jellyfinApiKey: 'key',
			jellyfinLocalPath: '/media',
			jellyfinRemotePath: '/media/youtube',
		};
		links['u1'] = { userId: 'u1', syncHistoryToWytui: true, jellyfinUserId: 'ju1' };

		await youtubeSyncService.reconcileHistory('u1');
		expect(jellyfinService.findItemIdByPath).toHaveBeenCalledWith(
			'http://jf:8096',
			'key',
			'/media/youtube/Chan/abc123/abc123.mp4',
		);
	});

	it('auto-selects the single Jellyfin user when none is configured', async () => {
		const { jellyfinService } = await import('./jellyfin.service');
		jellyfinUsers = [{ id: 'only-user', name: 'Only' }];
		(jellyfinService.listUsers as any).mockResolvedValue(jellyfinUsers);
		links['u1'] = { userId: 'u1', syncHistoryToWytui: true, jellyfinUserId: null };

		const res = await youtubeSyncService.reconcileHistory('u1');
		expect(res).toMatchObject({ jellyfin: { user: 'only-user', marked: 1 } });
	});

	it('skips Jellyfin when multiple users exist and none is configured', async () => {
		const { jellyfinService } = await import('./jellyfin.service');
		jellyfinUsers = [
			{ id: 'a', name: 'A' },
			{ id: 'b', name: 'B' },
		];
		(jellyfinService.listUsers as any).mockResolvedValue(jellyfinUsers);
		links['u1'] = { userId: 'u1', syncHistoryToWytui: true, jellyfinUserId: null };

		const res = await youtubeSyncService.reconcileHistory('u1');
		expect(res).toMatchObject({ marked: 1, jellyfin: { user: null, marked: 0 } });
		expect(jellyfinService.markItemPlayed).not.toHaveBeenCalled();
	});

	it('skips Jellyfin when the server is not configured', async () => {
		settings = { jellyfinUrl: null, jellyfinApiKey: null };
		links['u1'] = { userId: 'u1', syncHistoryToWytui: true, jellyfinUserId: 'ju1' };

		const res = await youtubeSyncService.reconcileHistory('u1');
		expect(res).toMatchObject({ marked: 1, jellyfin: { user: null, marked: 0 } });
	});

	it('marks 0 and skips everything when the toggle is off', async () => {
		const { jellyfinService } = await import('./jellyfin.service');
		links['u1'] = { userId: 'u1', syncHistoryToWytui: false };
		const res = await youtubeSyncService.reconcileHistory('u1');
		expect(res).toEqual({ marked: 0 });
		expect(jellyfinService.listUsers).not.toHaveBeenCalled();
	});
});

describe('syncForUser', () => {
	it('runs both directions honoring toggles and reports counts', async () => {
		for (const k of Object.keys(links)) delete links[k];
		watch.length = 0;
		watchUpserts.length = 0;
		history = [{ id: 'abc123', title: 'V', url: 'https://youtube.com/watch?v=abc123' }];
		settings = {
			jellyfinUrl: 'http://jf:8096',
			jellyfinApiKey: 'key',
			jellyfinLocalPath: null,
			jellyfinRemotePath: null,
		};
		const { jellyfinService } = await import('./jellyfin.service');
		(jellyfinService.listUsers as any).mockReset().mockResolvedValue([]);
		(jellyfinService.findItemIdByPath as any).mockReset().mockResolvedValue('item-1');
		(jellyfinService.markItemPlayed as any).mockReset().mockResolvedValue(true);
		links['u1'] = {
			userId: 'u1',
			syncWatchedToYouTube: true,
			syncHistoryToWytui: true,
			jellyfinUserId: 'ju1',
			lastHistorySync: new Date(0),
		};
		watch.push({ downloadId: 'd-old', watched: true, watchedAt: new Date() });

		const res = await youtubeSyncService.syncForUser('u1');
		expect(res).toMatchObject({ pushed: 1, marked: 1, jellyfin: { user: 'ju1', marked: 1 } });
	});

	it('returns an empty result for unlinked users', async () => {
		expect(await youtubeSyncService.syncForUser('nobody')).toEqual({});
	});
});
