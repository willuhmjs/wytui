import { describe, it, expect, vi, beforeEach } from 'vitest';

const links: any = {};
const watch: any[] = [];
let settings: any = null;
let history: any[] = [];
let watchLater: any[] = [];
const watchUpserts: any[] = [];
let playlistSyncCalls: { title: string; entries: any[] }[] = [];
let playlistSyncResult = { playlists: 1, createdPlaylists: 0, addedItems: 0 };

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
		fetchWatchLater: vi.fn(async () => watchLater),
	},
}));
vi.mock('./youtube-link.service', () => ({
	youtubeLinkService: { getCookiesTxt: vi.fn(async () => 'cookie-text') },
}));
vi.mock('./playlist.service', () => ({
	playlistService: {
		syncYouTubePlaylists: vi.fn(async (_userId: string, playlists: any[]) => {
			playlistSyncCalls.push(...playlists);
			return playlistSyncResult;
		}),
	},
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
import { youtubeService } from './youtube.service';
import { youtubeLinkService } from './youtube-link.service';
import { RateLimitError } from '../utils/ytdlp-json';

function resetState() {
	for (const k of Object.keys(links)) delete links[k];
	watch.length = 0;
	watchUpserts.length = 0;
	history = [];
	watchLater = [];
	playlistSyncCalls = [];
	playlistSyncResult = { playlists: 1, createdPlaylists: 0, addedItems: 0 };
	settings = null;
	jellyfinUsers = [];
	// Restore the default mock implementations — individual tests override
	// them (sometimes persistently via mockRejectedValue) and would otherwise
	// leak into later describes.
	(youtubeService.fetchHistory as any).mockReset().mockImplementation(async () => history);
	(youtubeService.fetchWatchLater as any).mockReset().mockImplementation(async () => watchLater);
	(youtubeService.markWatchedOnYouTube as any).mockReset().mockImplementation(async () => true);
	(youtubeLinkService.getCookiesTxt as any).mockReset().mockImplementation(async () => 'cookie-text');
}

describe('pushWatchedToYouTube', () => {
	beforeEach(() => resetState());

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
		resetState();
		history = [{ id: 'abc123', title: 'V', url: 'https://youtube.com/watch?v=abc123' }];
		settings = {
			jellyfinUrl: 'http://jf:8096',
			jellyfinApiKey: 'key',
			jellyfinLocalPath: null,
			jellyfinRemotePath: null,
		};
		const { jellyfinService } = await import('./jellyfin.service');
		(jellyfinService.listUsers as any).mockReset().mockResolvedValue(jellyfinUsers);
		(jellyfinService.findItemIdByPath as any).mockReset().mockResolvedValue('item-1');
		(jellyfinService.markItemPlayed as any).mockReset().mockResolvedValue(true);
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

	it('skips entries already marked watched (incremental reconcile)', async () => {
		const { jellyfinService } = await import('./jellyfin.service');
		history = [
			{ id: 'abc123', title: 'Old', url: 'https://youtube.com/watch?v=abc123' },
			{ id: 'def456', title: 'New', url: 'https://youtube.com/watch?v=def456' },
		];
		// abc123 was already marked watched by a previous pass.
		watch.push({ downloadId: 'd-abc123', watched: true, watchedAt: new Date(0) });
		links['u1'] = { userId: 'u1', syncHistoryToWytui: true, jellyfinUserId: 'ju1' };

		const res = await youtubeSyncService.reconcileHistory('u1');
		expect(res).toMatchObject({ marked: 1 });
		expect(watchUpserts).toHaveLength(1);
		expect(watchUpserts[0].create.downloadId).toBe('d-def456');
		// Only the newly marked item is pushed to Jellyfin.
		expect(jellyfinService.markItemPlayed).toHaveBeenCalledTimes(1);
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

	it('retries a transient fetch failure and succeeds on the second attempt', async () => {
		const { youtubeService } = await import('./youtube.service');
		youtubeSyncService.transientRetryDelayMs = 0;
		(youtubeService.fetchHistory as any)
			.mockRejectedValueOnce(new Error('proxy connection reset'))
			.mockResolvedValueOnce(history);
		links['u1'] = { userId: 'u1', syncHistoryToWytui: true, jellyfinUserId: 'ju1' };

		const res = await youtubeSyncService.reconcileHistory('u1');
		expect(res).toMatchObject({ marked: 1 });
		expect((youtubeService.fetchHistory as any)).toHaveBeenCalledTimes(2);
	});

	it('does not retry rate limits', async () => {
		const { youtubeService } = await import('./youtube.service');
		youtubeSyncService.transientRetryDelayMs = 0;
		(youtubeService.fetchHistory as any).mockRejectedValueOnce(
			new RateLimitError('YouTube rate limit reached'),
		);
		links['u1'] = { userId: 'u1', syncHistoryToWytui: true, lastHistorySync: new Date(0) };

		const res: any = await youtubeSyncService.reconcileHistory('u1');
		expect(res.marked).toBe(0);
		expect(res.error).toContain('History sync failed');
		expect((youtubeService.fetchHistory as any)).toHaveBeenCalledTimes(1);
		// Watermark not advanced on failure.
		expect(links['u1'].lastHistorySync).toEqual(new Date(0));
	});

	it('reports an error (not needsRelink) when the fetch keeps failing', async () => {
		const { youtubeService } = await import('./youtube.service');
		youtubeSyncService.transientRetryDelayMs = 0;
		(youtubeService.fetchHistory as any).mockRejectedValue(new Error('yt-dlp timed out'));
		links['u1'] = { userId: 'u1', syncHistoryToWytui: true, lastHistorySync: new Date(0) };

		const res: any = await youtubeSyncService.reconcileHistory('u1');
		expect(res.marked).toBe(0);
		expect(res.error).toContain('yt-dlp timed out');
		expect(res.needsRelink).toBeUndefined();
		expect(watchUpserts).toHaveLength(0);
	});

	it('propagates needsRelink when the session is dead', async () => {
		const { youtubeService } = await import('./youtube.service');
		(youtubeService.fetchHistory as any).mockResolvedValueOnce({ needsRelink: true });
		links['u1'] = { userId: 'u1', syncHistoryToWytui: true };

		const res: any = await youtubeSyncService.reconcileHistory('u1');
		expect(res.needsRelink).toBe(true);
	});
});

describe('syncWatchLaterList', () => {
	beforeEach(() => resetState());

	it('records watch-later entries as pending playlist items', async () => {
		watchLater = [
			{ id: 'wl1', title: 'A', url: 'https://youtube.com/watch?v=wl1' },
			{ id: 'wl2', title: 'B', url: 'https://youtube.com/watch?v=wl2' },
		];
		playlistSyncResult = { playlists: 1, createdPlaylists: 1, addedItems: 2 };
		links['u1'] = { userId: 'u1', syncWatchLater: true };

		const res = await youtubeSyncService.syncWatchLaterList('u1');
		expect(res).toEqual({ added: 2 });
		expect(playlistSyncCalls).toHaveLength(1);
		expect(playlistSyncCalls[0].title).toBe('Watch Later');
		expect(playlistSyncCalls[0].entries).toEqual(watchLater);
	});

	it('returns {added: 0} for unlinked users', async () => {
		expect(await youtubeSyncService.syncWatchLaterList('nobody')).toEqual({ added: 0 });
	});

	it('returns needsRelink when the session is dead', async () => {
		const { youtubeService } = await import('./youtube.service');
		(youtubeService.fetchWatchLater as any).mockResolvedValueOnce({ needsRelink: true });
		links['u1'] = { userId: 'u1' };

		expect(await youtubeSyncService.syncWatchLaterList('u1')).toEqual({ needsRelink: true });
	});

	it('returns an error message on transient failure', async () => {
		const { youtubeService } = await import('./youtube.service');
		(youtubeService.fetchWatchLater as any).mockRejectedValueOnce(new Error('proxy refused'));
		links['u1'] = { userId: 'u1' };

		const res: any = await youtubeSyncService.syncWatchLaterList('u1');
		expect(res.error).toContain('proxy refused');
	});
});

describe('syncForUser', () => {
	beforeEach(() => resetState());

	it('runs all directions honoring toggles and reports counts', async () => {
		history = [{ id: 'abc123', title: 'V', url: 'https://youtube.com/watch?v=abc123' }];
		watchLater = [{ id: 'wl1', title: 'A', url: 'https://youtube.com/watch?v=wl1' }];
		playlistSyncResult = { playlists: 1, createdPlaylists: 0, addedItems: 1 };
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
			syncWatchLater: true,
			jellyfinUserId: 'ju1',
			lastHistorySync: new Date(0),
		};
		watch.push({ downloadId: 'd-old', watched: true, watchedAt: new Date() });

		const res = await youtubeSyncService.syncForUser('u1');
		expect(res).toMatchObject({
			pushed: 1,
			marked: 1,
			watchLaterAdded: 1,
			jellyfin: { user: 'ju1', marked: 1 },
		});
	});

	it('returns an empty result for unlinked users', async () => {
		expect(await youtubeSyncService.syncForUser('nobody')).toEqual({});
	});

	it('collects errors and needsRelink instead of aborting other directions', async () => {
		const { youtubeService } = await import('./youtube.service');
		youtubeSyncService.transientRetryDelayMs = 0;
		(youtubeService.fetchHistory as any).mockRejectedValue(new Error('yt-dlp timed out'));
		(youtubeService.fetchWatchLater as any).mockRejectedValue(new Error('proxy refused'));
		links['u1'] = {
			userId: 'u1',
			syncHistoryToWytui: true,
			syncWatchLater: true,
			syncWatchedToYouTube: true,
			lastHistorySync: new Date(0),
		};

		const res = await youtubeSyncService.syncForUser('u1');
		expect(res.errors).toHaveLength(2);
		expect(res.errors![0]).toContain('yt-dlp timed out');
		expect(res.errors![1]).toContain('proxy refused');
		expect(res.needsRelink).toBeUndefined();
	});
});

describe('runOnce', () => {
	beforeEach(() => resetState());

	it('throws with recorded lastError when a user fails, and clears it on success', async () => {
		const { youtubeService } = await import('./youtube.service');
		youtubeSyncService.transientRetryDelayMs = 0;
		(youtubeService.fetchHistory as any).mockRejectedValue(new Error('yt-dlp timed out'));
		links['u1'] = { userId: 'u1', syncHistoryToWytui: true, lastHistorySync: new Date(0) };

		await expect(youtubeSyncService.runOnce()).rejects.toThrow('yt-dlp timed out');
		expect(links['u1'].lastError).toContain('yt-dlp timed out');

		// Next pass is rate-limited — still a failure, the error stays recorded.
		(youtubeService.fetchHistory as any).mockReset().mockRejectedValue(new RateLimitError());
		await expect(youtubeSyncService.runOnce()).rejects.toThrow('rate limit');
		expect(links['u1'].lastError).toBeTruthy();

		// A clean pass clears the error.
		(youtubeService.fetchHistory as any).mockReset().mockResolvedValue([]);
		await youtubeSyncService.runOnce();
		expect(links['u1'].lastError).toBeNull();
	});
});
