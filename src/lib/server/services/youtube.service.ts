import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import { youtubeLinkService } from './youtube-link.service';
import { runYtdlpJson, RateLimitError } from '../utils/ytdlp-json';

export interface YtEntry {
	id: string;
	title: string;
	url: string;
	uploader?: string;
	channelId?: string;
	thumbnail?: string;
	duration?: number;
}

export type NeedsRelink = { needsRelink: true };

// Exact host allowlist — URLs here are handed to yt-dlp, so guard against SSRF /
// non-YouTube targets. `includes()` matching is intentionally avoided so hosts
// like `youtube.com.evil.com` cannot slip through.
const ALLOWED_YOUTUBE_HOSTS = new Set([
	'youtube.com',
	'www.youtube.com',
	'm.youtube.com',
	'music.youtube.com',
	'youtu.be',
]);

export function isYouTubeUrl(url: unknown): url is string {
	if (typeof url !== 'string') return false;
	try {
		const u = new URL(url);
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
		return ALLOWED_YOUTUBE_HOSTS.has(u.hostname.toLowerCase());
	} catch {
		return false;
	}
}

/** Pure parser for `yt-dlp --flat-playlist --dump-single-json` output. */
export function parseFlatEntries(json: string): YtEntry[] {
	let data: any;
	try {
		data = JSON.parse(json);
	} catch {
		return [];
	}
	const entries = Array.isArray(data?.entries) ? data.entries : [];
	const out: YtEntry[] = [];
	for (const e of entries) {
		if (!e || typeof e.id !== 'string') continue;
		const thumbnail =
			typeof e.thumbnail === 'string'
				? e.thumbnail
				: Array.isArray(e.thumbnails) && typeof e.thumbnails.at(-1)?.url === 'string'
					? e.thumbnails.at(-1).url
					: undefined;
		out.push({
			id: e.id,
			title: typeof e.title === 'string' ? e.title : e.id,
			url: typeof e.url === 'string' ? e.url : `https://www.youtube.com/watch?v=${e.id}`,
			uploader: e.uploader ?? e.channel ?? undefined,
			channelId: e.channel_id ?? undefined,
			thumbnail,
			duration: typeof e.duration === 'number' && e.duration > 0 ? e.duration : undefined,
		});
	}
	return out;
}

type PlaylistList = { id: string; title: string; url: string; thumbnail?: string }[];
type PlaylistStats = { count: number; durationSeconds: number };
type CacheEntry<T> = { data: T; expires: number };

// Playlist enumeration and per-playlist stats each cost a yt-dlp invocation, so
// cache both per user to avoid re-scraping every time the sync picker opens. The
// caller can force a refresh (the picker's refresh button), which re-fetches and
// overwrites the cached value.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function readCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
	const entry = cache.get(key);
	if (!entry) return undefined;
	if (entry.expires <= Date.now()) {
		cache.delete(key);
		return undefined;
	}
	return entry.data;
}

function writeCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
	cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}

class YouTubeService {
	private playlistCache = new Map<string, CacheEntry<PlaylistList>>();
	private statsCache = new Map<string, CacheEntry<PlaylistStats>>();
	private subscriptionCache = new Map<string, CacheEntry<YtEntry[]>>();

	/** Write decrypted cookies to a 0600 temp file, run fn(path), always clean up. */
	async withCookieFile<T>(
		userId: string,
		fn: (cookiePath: string) => Promise<T>,
	): Promise<T | NeedsRelink> {
		const txt = await youtubeLinkService.getCookiesTxt(userId);
		if (!txt) return { needsRelink: true };
		const path = join(tmpdir(), `wytui-yt-${Date.now()}-${Math.round(Math.random() * 1e9)}.txt`);
		await writeFile(path, txt, { mode: 0o600 });
		try {
			return await fn(path);
		} finally {
			await unlink(path).catch(() => {});
		}
	}

	private fetchList(userId: string, target: string, opts: { timeoutMs?: number } = {}) {
		return this.withCookieFile(userId, async (cookiePath) => {
			try {
				const json = await runYtdlpJson(target, { cookiePath, timeoutMs: opts.timeoutMs });
				return parseFlatEntries(json);
			} catch (err) {
				// Surface rate-limit errors to callers so they can back off rather than
				// silently treating them as an auth failure.
				if (err instanceof RateLimitError) throw err;
				return { needsRelink: true } as NeedsRelink;
			}
		});
	}

	/**
	 * Enumerate the channels the user is subscribed to on YouTube, for the import
	 * picker. Cached per user (the picker's refresh button forces a re-scrape),
	 * mirroring {@link enumeratePlaylists}, since each call spawns a yt-dlp process.
	 */
	async fetchSubscriptions(
		userId: string,
		opts: { refresh?: boolean } = {},
	): Promise<YtEntry[] | NeedsRelink> {
		if (!opts.refresh) {
			const cached = readCache(this.subscriptionCache, userId);
			if (cached) return cached;
		}
		const result = await this.fetchList(userId, 'https://www.youtube.com/feed/channels');
		if (Array.isArray(result)) writeCache(this.subscriptionCache, userId, result);
		return result;
	}
	fetchSubscriptionFeed(userId: string) {
		return this.fetchList(userId, 'https://www.youtube.com/feed/subscriptions');
	}
	fetchWatchLater(userId: string) {
		return this.fetchList(userId, ':ytwatchlater');
	}
	fetchHistory(userId: string) {
		return this.fetchList(userId, ':ythistory');
	}
	fetchPlaylist(userId: string, url: string, opts: { timeoutMs?: number } = {}) {
		return this.fetchList(userId, url, opts);
	}

	/**
	 * Enumerate the user's YouTube playlists: their created/saved playlists (from
	 * the library feed) plus the special Liked and Watch Later lists, which the
	 * feed does not always surface. Returns a deduped list; the special lists are
	 * pinned to the top. Best-effort — a failure to read the feed still returns
	 * the special lists.
	 */
	async enumeratePlaylists(
		userId: string,
		opts: { refresh?: boolean } = {},
	): Promise<PlaylistList | NeedsRelink> {
		if (!opts.refresh) {
			const cached = readCache(this.playlistCache, userId);
			if (cached) return cached;
		}
		const special = [
			{ id: 'WL', title: 'Watch Later', url: 'https://www.youtube.com/playlist?list=WL' },
			{ id: 'LL', title: 'Liked videos', url: 'https://www.youtube.com/playlist?list=LL' },
		];
		const feed = await this.fetchList(userId, 'https://www.youtube.com/feed/playlists');
		if (!Array.isArray(feed)) return feed; // NeedsRelink
		const seen = new Set(special.map((p) => p.id));
		const created = feed
			.filter((e) => !seen.has(e.id))
			.map((e) => ({ id: e.id, title: e.title, url: e.url, thumbnail: e.thumbnail }));
		const list: PlaylistList = [...special, ...created];
		writeCache(this.playlistCache, userId, list);
		return list;
	}

	/**
	 * Fetch lightweight stats for a single playlist: its video count and the sum
	 * of the videos' durations. Both come from one flat yt-dlp fetch — YouTube's
	 * flat playlist entries carry per-video `duration`, so no per-video metadata
	 * fetch is needed. File size is intentionally absent (unknowable before a
	 * download, since YouTube serves adaptive streams).
	 */
	async fetchPlaylistStats(
		userId: string,
		url: string,
		opts: { refresh?: boolean } = {},
	): Promise<PlaylistStats | NeedsRelink> {
		const key = `${userId}|${url}`;
		if (!opts.refresh) {
			const cached = readCache(this.statsCache, key);
			if (cached) return cached;
		}
		const result = await this.fetchList(userId, url);
		if (!Array.isArray(result)) return result; // NeedsRelink
		let durationSeconds = 0;
		for (const e of result) {
			if (typeof e.duration === 'number') durationSeconds += e.duration;
		}
		const stats: PlaylistStats = { count: result.length, durationSeconds };
		writeCache(this.statsCache, key, stats);
		return stats;
	}

	/**
	 * Cookie-less flat playlist fetch for public playlists (no user auth).
	 * Reuses the timeout/settled-guarded yt-dlp runner. Returns the playlist's
	 * own title (from the single-json `title` field, null when absent) alongside
	 * the parsed entries. Throws on failure.
	 */
	async fetchPlaylistFlat(url: string): Promise<{ title: string | null; entries: YtEntry[] }> {
		const json = await runYtdlpJson(url);
		let title: string | null = null;
		try {
			const t = JSON.parse(json)?.title;
			if (typeof t === 'string' && t) title = t;
		} catch {
			// entries parsing below handles malformed JSON gracefully
		}
		return { title, entries: parseFlatEntries(json) };
	}

	/**
	 * Best-effort mark-watched via YouTube's internal playback endpoint.
	 * Returns true on apparent success, false otherwise. Never throws.
	 */
	async markWatchedOnYouTube(videoId: string, cookiesTxt: string): Promise<boolean> {
		try {
			const sapisid = /(?:^|\s)\S+\t\S+\t\S+\t\S+\t\S+\tSAPISID\t([^\t\n]+)/.exec(cookiesTxt)?.[1];
			if (!sapisid) return false;
			const origin = 'https://www.youtube.com';
			const ts = Math.floor(Date.now() / 1000);
			const hash = createHash('sha1').update(`${ts} ${sapisid} ${origin}`).digest('hex');
			const cookieHeader = cookiesTxt
				.split('\n')
				.filter((l) => l && !l.startsWith('#'))
				.map((l) => {
					const f = l.split('\t');
					return `${f[5]}=${f[6]}`;
				})
				.join('; ');
			// Playback tracking ping. This is best-effort: a 2xx here means the
			// request was accepted, NOT that YouTube actually registered a view —
			// the real playback protocol needs additional CPN/watchtime params, so
			// this may silently no-op if YouTube changes the endpoint shape.
			const res = await fetch(
				`https://www.youtube.com/api/stats/playback?docid=${encodeURIComponent(videoId)}&ns=yt&ver=2`,
				{
					method: 'GET',
					headers: {
						cookie: cookieHeader,
						authorization: `SAPISIDHASH ${ts}_${hash}`,
						origin,
						'x-origin': origin,
					},
				},
			);
			return res.ok;
		} catch {
			return false;
		}
	}
}

export const youtubeService = new YouTubeService();
