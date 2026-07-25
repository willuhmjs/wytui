export type SearchResultType = 'video' | 'channel' | 'playlist';
export type SearchSort = 'relevance' | 'date' | 'views' | 'rating';
export type SearchUploadDate = 'any' | 'hour' | 'today' | 'week' | 'month' | 'year';
export type SearchDuration = 'any' | 'short' | 'medium' | 'long';

// YouTube's `sp` query param is base64 of a small protobuf message:
//
//   field 1 (varint)   sort
//   field 2 (message)  filters { 1: uploadDate, 2: type, 3: duration }
//
// Fields at their default value are omitted, per standard protobuf encoding.
// Both the omitting form and an explicit `sort=0` were verified to work; the
// omitting form is used here because it is what YouTube's own UI emits.
const SORT_VALUES: Record<SearchSort, number> = {
	relevance: 0,
	date: 1,
	views: 2,
	rating: 3,
};

const UPLOAD_DATE_VALUES: Record<SearchUploadDate, number> = {
	any: 0,
	hour: 1,
	today: 2,
	week: 3,
	month: 4,
	year: 5,
};

const TYPE_VALUES: Record<SearchResultType, number> = {
	video: 1,
	channel: 2,
	playlist: 3,
};

// Not in size order — this is YouTube's numbering, not a mistake.
const DURATION_VALUES: Record<SearchDuration, number> = {
	any: 0,
	short: 1, // under 4 minutes
	long: 2, // over 20 minutes
	medium: 3, // 4 to 20 minutes
};

/** Encode a protobuf varint. Values here are all small, but this is general. */
function varint(value: number): number[] {
	const bytes: number[] = [];
	let v = value;
	while (v > 0x7f) {
		bytes.push((v & 0x7f) | 0x80);
		v >>>= 7;
	}
	bytes.push(v);
	return bytes;
}

/** Encode `field N, wire type 0 (varint)`, or nothing when value is 0. */
function varintField(fieldNumber: number, value: number): number[] {
	if (value === 0) return [];
	return [(fieldNumber << 3) | 0, ...varint(value)];
}

export function buildSearchParam(opts: {
	type: SearchResultType;
	sort?: SearchSort;
	uploadDate?: SearchUploadDate;
	duration?: SearchDuration;
}): string {
	const { type, sort = 'relevance', uploadDate = 'any', duration = 'any' } = opts;

	const videoOnly = type === 'video';
	const filters = [
		...varintField(1, videoOnly ? UPLOAD_DATE_VALUES[uploadDate] : 0),
		...varintField(2, TYPE_VALUES[type]),
		...varintField(3, videoOnly ? DURATION_VALUES[duration] : 0),
	];

	const message = [
		...varintField(1, SORT_VALUES[sort]),
		// field 2, wire type 2 (length-delimited)
		...(filters.length ? [(2 << 3) | 2, ...varint(filters.length), ...filters] : []),
	];

	return Buffer.from(message).toString('base64');
}

export interface VideoResult {
	type: 'video';
	id: string;
	title: string;
	url: string;
	uploader?: string;
	channelId?: string;
	channelUrl?: string;
	thumbnail?: string;
	duration?: number;
	viewCount?: number;
	verified: boolean;
	description?: string;
	/** Attached by the route handler, never by the service — see cache note. */
	existingDownload: { id: string; status: string } | null;
}

export interface ChannelResult {
	type: 'channel';
	id: string;
	title: string;
	url: string;
	thumbnail?: string;
	subscriberCount?: number;
	description?: string;
}

export interface PlaylistResult {
	type: 'playlist';
	id: string;
	title: string;
	url: string;
	thumbnail?: string;
	uploader?: string;
	channelId?: string;
}

export type SearchResult = VideoResult | ChannelResult | PlaylistResult;

/**
 * Largest available thumbnail, normalized to an absolute https URL.
 * Channel avatars come back protocol-relative (`//yt3.googleusercontent.com/…`).
 */
function pickThumbnail(entry: any): string | undefined {
	let url: unknown = entry?.thumbnail;
	if (typeof url !== 'string' || !url) {
		const list = Array.isArray(entry?.thumbnails) ? entry.thumbnails : [];
		url = list.at(-1)?.url;
	}
	if (typeof url !== 'string' || !url) return undefined;
	return url.startsWith('//') ? `https:${url}` : url;
}

function str(v: unknown): string | undefined {
	return typeof v === 'string' && v ? v : undefined;
}

function num(v: unknown): number | undefined {
	return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

function toVideo(e: any): VideoResult | null {
	if (e?.ie_key !== 'Youtube' || typeof e?.id !== 'string') return null;
	return {
		type: 'video',
		id: e.id,
		title: str(e.title) ?? e.id,
		url: str(e.url) ?? `https://www.youtube.com/watch?v=${encodeURIComponent(e.id)}`,
		uploader: str(e.uploader) ?? str(e.channel),
		channelId: str(e.channel_id),
		channelUrl: str(e.channel_url),
		thumbnail: pickThumbnail(e),
		duration: num(e.duration),
		viewCount: num(e.view_count),
		verified: e.channel_is_verified === true,
		description: str(e.description),
		existingDownload: null,
	};
}

function toChannel(e: any): ChannelResult | null {
	if (e?.ie_key !== 'YoutubeTab' || typeof e?.id !== 'string') return null;
	const url = str(e.url);
	if (!url?.includes('/channel/')) return null;
	return {
		type: 'channel',
		id: e.id,
		title: str(e.title) ?? str(e.channel) ?? e.id,
		url,
		thumbnail: pickThumbnail(e),
		subscriberCount: num(e.channel_follower_count),
		description: str(e.description),
	};
}

function toPlaylist(e: any): PlaylistResult | null {
	if (e?.ie_key !== 'YoutubeTab' || typeof e?.id !== 'string') return null;
	const url = str(e.url);
	if (!url?.includes('/playlist?list=')) return null;
	return {
		type: 'playlist',
		id: e.id,
		title: str(e.title) ?? e.id,
		url,
		thumbnail: pickThumbnail(e),
		uploader: str(e.uploader) ?? str(e.channel),
		channelId: str(e.channel_id),
	};
}

const MAPPERS = {
	video: toVideo,
	channel: toChannel,
	playlist: toPlaylist,
} as const;

/**
 * Parse a `--dump-single-json` search response.
 *
 * `rawCount` is the number of entries yt-dlp returned, before any were skipped
 * for shape mismatch. Callers use it for `hasMore` — deriving that from
 * `results.length` would end pagination early whenever an entry is dropped.
 */
export function parseSearchEntries(
	json: string,
	type: SearchResultType,
): { results: SearchResult[]; rawCount: number } {
	let data: any;
	try {
		data = JSON.parse(json);
	} catch {
		return { results: [], rawCount: 0 };
	}
	const entries = Array.isArray(data?.entries) ? data.entries : [];
	const map = MAPPERS[type];
	const results: SearchResult[] = [];
	for (const e of entries) {
		const mapped = map(e);
		if (mapped) results.push(mapped);
	}
	return { results, rawCount: entries.length };
}

import { runYtdlpJson } from '../utils/ytdlp-json';

export interface SearchOptions {
	query: string;
	type: SearchResultType;
	sort: SearchSort;
	uploadDate: SearchUploadDate;
	duration: SearchDuration;
	offset: number;
	limit: number;
}

export interface SearchResponse {
	results: SearchResult[];
	hasMore: boolean;
}

const SEARCH_TIMEOUT_MS = 45_000;
const CACHE_TTL_MS = 15 * 60 * 1000;
// The playlist caches in youtube.service.ts are keyed by userId and so are
// naturally bounded. Search query space is not, hence a hard cap.
const CACHE_MAX_ENTRIES = 200;

type CacheEntry = { data: SearchResponse; expires: number };

class YouTubeSearchService {
	private cache = new Map<string, CacheEntry>();

	/** Test seam — also useful if we ever expose a manual refresh. */
	clearCache(): void {
		this.cache.clear();
	}

	private cacheKey(o: SearchOptions): string {
		return [o.type, o.sort, o.uploadDate, o.duration, o.offset, o.limit, o.query].join('|');
	}

	private readCache(key: string): SearchResponse | undefined {
		const entry = this.cache.get(key);
		if (!entry) return undefined;
		if (entry.expires <= Date.now()) {
			this.cache.delete(key);
			return undefined;
		}
		// Hand back a clone: the route handler attaches per-user download state to
		// results, and mutating a shared cache entry would leak it between users.
		return structuredClone(entry.data);
	}

	private writeCache(key: string, data: SearchResponse): void {
		// A Map iterates in insertion order, so the first key is the oldest.
		while (this.cache.size >= CACHE_MAX_ENTRIES) {
			const oldest = this.cache.keys().next();
			if (oldest.done) break;
			this.cache.delete(oldest.value);
		}
		// Store a clone so the object returned to the current caller and the cached
		// copy are independent — the caller mutates its result, the cache must not.
		this.cache.set(key, { data: structuredClone(data), expires: Date.now() + CACHE_TTL_MS });
	}

	/**
	 * Search YouTube. Always anonymous — no cookies on this path, so one cache
	 * serves every user. `existingDownload` stays null here and is attached
	 * per-user by the route handler; caching it would leak library state
	 * between users.
	 */
	async search(opts: SearchOptions): Promise<SearchResponse> {
		const key = this.cacheKey(opts);
		const cached = this.readCache(key);
		if (cached) return cached;

		const sp = buildSearchParam({
			type: opts.type,
			sort: opts.sort,
			uploadDate: opts.uploadDate,
			duration: opts.duration,
		});
		const target =
			`https://www.youtube.com/results` +
			`?search_query=${encodeURIComponent(opts.query)}` +
			`&sp=${encodeURIComponent(sp)}`;

		const json = await runYtdlpJson(target, {
			timeoutMs: SEARCH_TIMEOUT_MS,
			extraArgs: [
				'--playlist-start',
				String(opts.offset + 1),
				'--playlist-end',
				String(opts.offset + opts.limit),
			],
		});

		const { results, rawCount } = parseSearchEntries(json, opts.type);
		const response: SearchResponse = { results, hasMore: rawCount >= opts.limit };
		this.writeCache(key, response);
		return response;
	}
}

export const youtubeSearchService = new YouTubeSearchService();

const MAX_QUERY_LENGTH = 200;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
// Forwarded to yt-dlp as --playlist-start/--playlist-end (see below). Left
// unbounded, a caller could force yt-dlp to page arbitrarily deep into
// YouTube's results on every request — scraping-abuse and ban-risk surface.
const MAX_OFFSET = 1000;

const VALID_TYPES: SearchResultType[] = ['video', 'channel', 'playlist'];
const VALID_SORTS: SearchSort[] = ['relevance', 'date', 'views', 'rating'];
const VALID_UPLOAD_DATES: SearchUploadDate[] = ['any', 'hour', 'today', 'week', 'month', 'year'];
const VALID_DURATIONS: SearchDuration[] = ['any', 'short', 'medium', 'long'];

function pickEnum<T extends string>(raw: string | null, valid: T[], fallback: T, label: string): T {
	if (raw === null || raw === '') return fallback;
	if (!valid.includes(raw as T)) throw new Error(`Invalid ${label}: ${raw}`);
	return raw as T;
}

function pickInt(raw: string | null, fallback: number, min: number, max: number): number {
	const n = Number.parseInt(raw ?? '', 10);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

/**
 * Validate and normalize query params into SearchOptions.
 * Throws a plain Error whose message is safe to return to the client as a 400.
 */
export function parseSearchParams(sp: URLSearchParams): SearchOptions {
	const query = (sp.get('q') ?? '').trim();
	if (!query) throw new Error('Query is required');
	if (query.length > MAX_QUERY_LENGTH) {
		throw new Error(`Query is too long (max ${MAX_QUERY_LENGTH} characters)`);
	}

	return {
		query,
		type: pickEnum(sp.get('type'), VALID_TYPES, 'video', 'type'),
		sort: pickEnum(sp.get('sort'), VALID_SORTS, 'relevance', 'sort'),
		uploadDate: pickEnum(sp.get('uploadDate'), VALID_UPLOAD_DATES, 'any', 'uploadDate'),
		duration: pickEnum(sp.get('duration'), VALID_DURATIONS, 'any', 'duration'),
		offset: pickInt(sp.get('offset'), 0, 0, MAX_OFFSET),
		limit: pickInt(sp.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT),
	};
}
