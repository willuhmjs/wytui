# YouTube Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users search YouTube from inside wytui and act on results directly — download videos, subscribe to channels, import playlists.

**Architecture:** A new anonymous (cookie-less) search service shells out to yt-dlp against `youtube.com/results?search_query=…&sp=…`, where `sp` is a base64 protobuf filter blob built by a pure encoder. Results are parsed into a discriminated union, cached process-wide with a bounded TTL map, and served by a new `GET /api/youtube/search`. The existing `/search` page gains a Library/YouTube tab split, with each mode extracted into its own component.

**Tech Stack:** SvelteKit 2 (Svelte 5 runes), TypeScript, Prisma, vitest, yt-dlp 2026.07.04

**Spec:** `docs/superpowers/specs/2026-07-24-youtube-search-design.md`

## Global Constraints

- **Do not run `git commit` without the user's explicit go-ahead.** The user manages the git workflow. Commit steps below are checkpoints — stage the files, show the message, and ask.
- Search is **always anonymous**. Never pass `--cookies` on any code path added by this plan.
- yt-dlp binary path comes from `process.env.YTDLP_PATH || '/usr/local/bin/yt-dlp'` (existing convention in `youtube.service.ts:39`).
- yt-dlp playlist indices are **1-based and inclusive**: `--playlist-start (offset + 1)`, `--playlist-end (offset + limit)`.
- Search timeout is **45s**; the shared runner default stays **120s**.
- Cache: **15 min TTL, 200-entry cap, insertion-order eviction**, shared across all users.
- Rate limit: `youtubeSearch: { windowMs: 60 * 1000, maxRequests: 120 }`.
- Svelte 5 runes (`$state`, `$derived`, `$props`, `$effect`) — match existing components, not Svelte 4 syntax.
- Tabs for indentation, single quotes, semicolons (Prettier config is in the repo; run `npm run format` before committing).
- Unit tests: `npm run test` (vitest). `tests/integration/` is Playwright and excluded from vitest — do not add to it.

## File Structure

| File                                                     | Responsibility                                                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/lib/server/utils/ytdlp-json.ts`                     | **New.** Spawn yt-dlp, return stdout, with timeout + settled guard. Extracted from `YouTubeService.runYtdlpJson`. |
| `src/lib/server/utils/ytdlp-json.test.ts`                | **New.** Success / non-zero exit / timeout, with `spawn` mocked.                                                  |
| `src/lib/server/services/youtube.service.ts`             | **Modify.** Delete private `runYtdlpJson`, import the shared one.                                                 |
| `src/lib/server/services/youtube-search.service.ts`      | **New.** Types, `buildSearchParam`, `parseSearchEntries`, bounded cache, `search()`.                              |
| `src/lib/server/services/youtube-search.service.test.ts` | **New.** Encoder vectors, parser fixtures, cache behaviour, offset mapping.                                       |
| `src/lib/server/rate-limit.ts`                           | **Modify.** Add `youtubeSearch` bucket.                                                                           |
| `src/hooks.server.ts`                                    | **Modify.** Route `/api/youtube/search` to that bucket.                                                           |
| `src/routes/api/youtube/search/+server.ts`               | **New.** `GET` handler: validate params, call service, attach `existingDownload`.                                 |
| `src/lib/utils/format.ts`                                | **Modify.** Add `formatCount` (1234567 → "1.2M").                                                                 |
| `src/lib/utils/format.test.ts`                           | **New or modify.** Tests for `formatCount`.                                                                       |
| `src/routes/search/+page.svelte`                         | **Modify.** Becomes a thin tab shell.                                                                             |
| `src/lib/components/search/LibrarySearch.svelte`         | **New.** Existing library-search body, moved verbatim.                                                            |
| `src/lib/components/search/YouTubeSearch.svelte`         | **New.** Search box, filters, URL state, fetch, result list, Load more, selection bar.                            |
| `src/lib/components/search/YouTubeVideoResult.svelte`    | **New.** One video row.                                                                                           |
| `src/lib/components/search/YouTubeChannelResult.svelte`  | **New.** One channel row.                                                                                         |
| `src/lib/components/search/YouTubePlaylistResult.svelte` | **New.** One playlist row.                                                                                        |
| `src/lib/components/ui/Sidebar.svelte`                   | **Modify.** Add the Search nav item.                                                                              |

Tasks 1–5 are server-side and independently testable. Task 6 is a no-behaviour-change refactor. Tasks 7–8 build the UI on top.

---

### Task 1: Extract the yt-dlp JSON runner

`YouTubeService.runYtdlpJson` is private, hardcodes a 120s timeout, and takes a cookie path. Search needs it cookie-less with a 45s timeout, so it moves to a shared util with an options bag.

**Files:**

- Create: `src/lib/server/utils/ytdlp-json.ts`
- Create: `src/lib/server/utils/ytdlp-json.test.ts`
- Modify: `src/lib/server/services/youtube.service.ts` (remove lines 119-157, the private `runYtdlpJson`; update its 2 call sites and imports)

**Interfaces:**

- Consumes: nothing
- Produces: `runYtdlpJson(target: string, opts?: { cookiePath?: string | null; timeoutMs?: number; extraArgs?: string[] }): Promise<string>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/utils/ytdlp-json.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const spawnMock = vi.fn();
vi.mock('child_process', () => ({ spawn: (...a: any[]) => spawnMock(...a) }));

/** Minimal stand-in for a ChildProcess: emits on stdout/stderr, then closes. */
function fakeProc() {
	const p: any = new EventEmitter();
	p.stdout = new EventEmitter();
	p.stderr = new EventEmitter();
	p.kill = vi.fn();
	return p;
}

describe('runYtdlpJson', () => {
	beforeEach(() => {
		spawnMock.mockReset();
		vi.useRealTimers();
	});

	it('resolves stdout and passes the expected base args', async () => {
		const p = fakeProc();
		spawnMock.mockReturnValue(p);
		const { runYtdlpJson } = await import('./ytdlp-json');
		const promise = runYtdlpJson('ytsearch1:hi');

		p.stdout.emit('data', '{"a":');
		p.stdout.emit('data', '1}');
		p.emit('close', 0);

		await expect(promise).resolves.toBe('{"a":1}');
		const args = spawnMock.mock.calls[0][1];
		expect(args).toEqual([
			'--flat-playlist',
			'--dump-single-json',
			'--no-warnings',
			'ytsearch1:hi',
		]);
	});

	it('inserts --cookies and extraArgs before the target', async () => {
		const p = fakeProc();
		spawnMock.mockReturnValue(p);
		const { runYtdlpJson } = await import('./ytdlp-json');
		const promise = runYtdlpJson('TARGET', {
			cookiePath: '/tmp/c.txt',
			extraArgs: ['--playlist-start', '1'],
		});
		p.emit('close', 0);
		await promise;

		expect(spawnMock.mock.calls[0][1]).toEqual([
			'--flat-playlist',
			'--dump-single-json',
			'--no-warnings',
			'--cookies',
			'/tmp/c.txt',
			'--playlist-start',
			'1',
			'TARGET',
		]);
	});

	it('rejects with stderr text on non-zero exit', async () => {
		const p = fakeProc();
		spawnMock.mockReturnValue(p);
		const { runYtdlpJson } = await import('./ytdlp-json');
		const promise = runYtdlpJson('TARGET');
		p.stderr.emit('data', 'ERROR: boom');
		p.emit('close', 1);
		await expect(promise).rejects.toThrow('ERROR: boom');
	});

	it('kills the process and rejects when the timeout elapses', async () => {
		vi.useFakeTimers();
		const p = fakeProc();
		spawnMock.mockReturnValue(p);
		const { runYtdlpJson } = await import('./ytdlp-json');
		const promise = runYtdlpJson('TARGET', { timeoutMs: 1000 });
		vi.advanceTimersByTime(1001);
		await expect(promise).rejects.toThrow('yt-dlp timed out');
		expect(p.kill).toHaveBeenCalledWith('SIGKILL');
	});

	it('ignores a late close after the timeout already rejected', async () => {
		vi.useFakeTimers();
		const p = fakeProc();
		spawnMock.mockReturnValue(p);
		const { runYtdlpJson } = await import('./ytdlp-json');
		const promise = runYtdlpJson('TARGET', { timeoutMs: 1000 });
		vi.advanceTimersByTime(1001);
		await expect(promise).rejects.toThrow('yt-dlp timed out');
		expect(() => p.emit('close', 0)).not.toThrow();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/utils/ytdlp-json.test.ts`
Expected: FAIL — `Cannot find module './ytdlp-json'`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/server/utils/ytdlp-json.ts`:

```ts
import { spawn } from 'child_process';

const YTDLP = process.env.YTDLP_PATH || '/usr/local/bin/yt-dlp';

export interface RunYtdlpJsonOptions {
	/** Netscape cookie file path. Omit for anonymous requests. */
	cookiePath?: string | null;
	/** Hard kill after this many ms. Defaults to 120s. */
	timeoutMs?: number;
	/** Extra flags inserted after the base args, before the target. */
	extraArgs?: string[];
}

/**
 * Run yt-dlp in flat-JSON mode and resolve its stdout.
 *
 * The `settled` guard matters: without it a process that both times out and
 * later closes would settle the promise twice and leave a dangling timer.
 */
export function runYtdlpJson(target: string, opts: RunYtdlpJsonOptions = {}): Promise<string> {
	const { cookiePath = null, timeoutMs = 120000, extraArgs = [] } = opts;

	return new Promise((resolve, reject) => {
		const args = [
			'--flat-playlist',
			'--dump-single-json',
			'--no-warnings',
			...(cookiePath ? ['--cookies', cookiePath] : []),
			...extraArgs,
			target,
		];
		const p = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		let out = '';
		let err = '';
		let settled = false;

		const timeout = setTimeout(() => {
			if (settled) return;
			settled = true;
			try {
				p.kill('SIGKILL');
			} catch {}
			reject(new Error('yt-dlp timed out'));
		}, timeoutMs);

		p.stdout.on('data', (c) => (out += c.toString()));
		p.stderr.on('data', (c) => (err += c.toString()));
		p.on('error', (e) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			reject(e);
		});
		p.on('close', (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			code === 0 ? resolve(out) : reject(new Error(err || `yt-dlp exit ${code}`));
		});
	});
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/server/utils/ytdlp-json.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Switch `youtube.service.ts` to the shared runner**

In `src/lib/server/services/youtube.service.ts`:

1. Delete the entire private `runYtdlpJson` method (the block starting `/** Run yt-dlp and return stdout (flat JSON). Cookies are optional. */` through its closing `}`).
2. Delete the now-unused `const YTDLP = …` line and the `import { spawn } from 'child_process';` line.
3. Add to the imports: `import { runYtdlpJson } from '../utils/ytdlp-json';`
4. In `fetchList`, change `await this.runYtdlpJson(cookiePath, target)` to `await runYtdlpJson(target, { cookiePath })`.
5. In `fetchPlaylistFlat`, change `await this.runYtdlpJson(null, url)` to `await runYtdlpJson(url)`.

- [ ] **Step 6: Verify nothing regressed**

Run: `npx vitest run src/lib/server/services/ && npm run check`
Expected: existing `youtube.service.test.ts`, `youtube-sync.service.test.ts`, `youtube-link.service.test.ts` all PASS; `svelte-check` reports no new errors.

- [ ] **Step 7: Commit (ask first)**

```bash
npm run format
git add src/lib/server/utils/ytdlp-json.ts src/lib/server/utils/ytdlp-json.test.ts src/lib/server/services/youtube.service.ts
git commit -m "refactor: extract yt-dlp JSON runner into a shared util"
```

---

### Task 2: The `sp` filter encoder

A pure function, no I/O. The expected outputs below were verified against live YouTube on 2026-07-24 — treat them as fixed contract, not guesses.

**Files:**

- Create: `src/lib/server/services/youtube-search.service.ts`
- Create: `src/lib/server/services/youtube-search.service.test.ts`

**Interfaces:**

- Consumes: nothing
- Produces:
  - `type SearchResultType = 'video' | 'channel' | 'playlist'`
  - `type SearchSort = 'relevance' | 'date' | 'views' | 'rating'`
  - `type SearchUploadDate = 'any' | 'hour' | 'today' | 'week' | 'month' | 'year'`
  - `type SearchDuration = 'any' | 'short' | 'medium' | 'long'`
  - `buildSearchParam(opts: { type: SearchResultType; sort?: SearchSort; uploadDate?: SearchUploadDate; duration?: SearchDuration }): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/services/youtube-search.service.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSearchParam } from './youtube-search.service';

describe('buildSearchParam', () => {
	// These four were verified against live YouTube on 2026-07-24.
	it('encodes type-only filters with all other fields defaulted', () => {
		expect(buildSearchParam({ type: 'video' })).toBe('EgIQAQ==');
		expect(buildSearchParam({ type: 'channel' })).toBe('EgIQAg==');
		expect(buildSearchParam({ type: 'playlist' })).toBe('EgIQAw==');
	});

	it('encodes sort + uploadDate + duration together', () => {
		expect(
			buildSearchParam({ type: 'video', sort: 'date', uploadDate: 'week', duration: 'long' }),
		).toBe('CAESBggDEAEYAg==');
	});

	it('omits fields at their default value', () => {
		// relevance is sort=0 and is omitted entirely rather than encoded as 08 00
		expect(buildSearchParam({ type: 'video', sort: 'relevance' })).toBe('EgIQAQ==');
		expect(buildSearchParam({ type: 'video', uploadDate: 'any', duration: 'any' })).toBe(
			'EgIQAQ==',
		);
	});

	it('encodes each sort value', () => {
		expect(buildSearchParam({ type: 'video', sort: 'date' })).toBe('CAESAhAB');
		expect(buildSearchParam({ type: 'video', sort: 'views' })).toBe('CAISAhAB');
		expect(buildSearchParam({ type: 'video', sort: 'rating' })).toBe('CAMSAhAB');
	});

	it('uses YouTube duration ordinals, where long=2 and medium=3', () => {
		// short -> 18 01, long -> 18 02, medium -> 18 03
		expect(buildSearchParam({ type: 'video', duration: 'short' })).toBe('EgQQARgB');
		expect(buildSearchParam({ type: 'video', duration: 'long' })).toBe('EgQQARgC');
		expect(buildSearchParam({ type: 'video', duration: 'medium' })).toBe('EgQQARgD');
	});

	it('encodes each uploadDate value', () => {
		expect(buildSearchParam({ type: 'video', uploadDate: 'hour' })).toBe('EgQIARAB');
		expect(buildSearchParam({ type: 'video', uploadDate: 'today' })).toBe('EgQIAhAB');
		expect(buildSearchParam({ type: 'video', uploadDate: 'week' })).toBe('EgQIAxAB');
		expect(buildSearchParam({ type: 'video', uploadDate: 'month' })).toBe('EgQIBBAB');
		expect(buildSearchParam({ type: 'video', uploadDate: 'year' })).toBe('EgQIBRAB');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/services/youtube-search.service.test.ts`
Expected: FAIL — `Cannot find module './youtube-search.service'`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/server/services/youtube-search.service.ts`:

```ts
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

	const filters = [
		...varintField(1, UPLOAD_DATE_VALUES[uploadDate]),
		...varintField(2, TYPE_VALUES[type]),
		...varintField(3, DURATION_VALUES[duration]),
	];

	const message = [
		...varintField(1, SORT_VALUES[sort]),
		// field 2, wire type 2 (length-delimited)
		...(filters.length ? [(2 << 3) | 2, ...varint(filters.length), ...filters] : []),
	];

	return Buffer.from(message).toString('base64');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/server/services/youtube-search.service.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit (ask first)**

```bash
npm run format
git add src/lib/server/services/youtube-search.service.ts src/lib/server/services/youtube-search.service.test.ts
git commit -m "feat: add YouTube search sp filter encoder"
```

---

### Task 3: Result parsers

yt-dlp returns every search hit as `_type: "url"`. Videos carry `ie_key: "Youtube"`; channels and playlists both carry `ie_key: "YoutubeTab"` and are told apart by URL shape. The fixtures below mirror real responses captured on 2026-07-24.

**Files:**

- Modify: `src/lib/server/services/youtube-search.service.ts` (append)
- Modify: `src/lib/server/services/youtube-search.service.test.ts` (append)

**Interfaces:**

- Consumes: `SearchResultType` from Task 2
- Produces:
  - `interface VideoResult`, `ChannelResult`, `PlaylistResult`, `type SearchResult`
  - `parseSearchEntries(json: string, type: SearchResultType): { results: SearchResult[]; rawCount: number }`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/server/services/youtube-search.service.test.ts`:

```ts
import { parseSearchEntries } from './youtube-search.service';

const videoJson = JSON.stringify({
	entries: [
		{
			_type: 'url',
			ie_key: 'Youtube',
			id: '7W3TwaIAlLo',
			url: 'https://www.youtube.com/watch?v=7W3TwaIAlLo',
			title: "TWO reasons your sourdough doesn't SPRING",
			description: 'Having issues with your sourdough starter?',
			duration: 1289,
			channel_id: 'UCzH5n3Ih5kgQoiDAQt2FwLw',
			channel: 'LifebyMikeG',
			channel_url: 'https://www.youtube.com/channel/UCzH5n3Ih5kgQoiDAQt2FwLw',
			uploader: 'LifebyMikeG',
			thumbnails: [
				{ url: 'https://i.ytimg.com/vi/7W3TwaIAlLo/small.jpg', height: 202, width: 360 },
				{ url: 'https://i.ytimg.com/vi/7W3TwaIAlLo/hq720.jpg', height: 404, width: 720 },
			],
			view_count: 2761758,
			channel_is_verified: true,
		},
		{ _type: 'url', ie_key: 'Youtube', id: 'bare', title: 'Bare minimum' },
		{ nope: true },
	],
});

const channelJson = JSON.stringify({
	entries: [
		{
			_type: 'url',
			ie_key: 'YoutubeTab',
			id: 'UCMeIfTykbcnPvbPyX7Kqr0Q',
			url: 'https://www.youtube.com/channel/UCMeIfTykbcnPvbPyX7Kqr0Q',
			title: 'Oh my Bread Sourdough Baking School ',
			channel: 'Oh my Bread Sourdough Baking School ',
			channel_follower_count: 17500,
			description: 'Hello there, Sourdough Enthusiasts!',
			channel_is_verified: null,
			thumbnails: [
				{ url: '//yt3.ggpht.com/abc=s88-c-k-c0x00ffffff-no-rj-mo', height: 88, width: 88 },
				{ url: '//yt3.ggpht.com/abc=s176-c-k-c0x00ffffff-no-rj-mo', height: 176, width: 176 },
			],
		},
	],
});

const playlistJson = JSON.stringify({
	entries: [
		{
			_type: 'url',
			ie_key: 'YoutubeTab',
			id: 'PLt_lOWx8jR_PQQqNquacTdaUuGWCD-V1S',
			url: 'https://www.youtube.com/playlist?list=PLt_lOWx8jR_PQQqNquacTdaUuGWCD-V1S',
			title: 'Your Beginners Guide to Making Sourdough Bread',
			channel: 'LifebyMikeG',
			channel_id: 'UCzH5n3Ih5kgQoiDAQt2FwLw',
			uploader: 'LifebyMikeG',
			duration: null,
			view_count: null,
			thumbnails: [
				{ url: 'https://i.ytimg.com/vi/BJEHsvW2J6M/hq720.jpg', height: 404, width: 720 },
			],
		},
	],
});

describe('parseSearchEntries', () => {
	it('maps video entries and picks the largest thumbnail', () => {
		const { results, rawCount } = parseSearchEntries(videoJson, 'video');
		expect(rawCount).toBe(3);
		expect(results).toHaveLength(2);
		expect(results[0]).toEqual({
			type: 'video',
			id: '7W3TwaIAlLo',
			title: "TWO reasons your sourdough doesn't SPRING",
			url: 'https://www.youtube.com/watch?v=7W3TwaIAlLo',
			uploader: 'LifebyMikeG',
			channelId: 'UCzH5n3Ih5kgQoiDAQt2FwLw',
			channelUrl: 'https://www.youtube.com/channel/UCzH5n3Ih5kgQoiDAQt2FwLw',
			thumbnail: 'https://i.ytimg.com/vi/7W3TwaIAlLo/hq720.jpg',
			duration: 1289,
			viewCount: 2761758,
			verified: true,
			description: 'Having issues with your sourdough starter?',
			existingDownload: null,
		});
	});

	it('tolerates missing fields and synthesizes a watch URL from the id', () => {
		const { results } = parseSearchEntries(videoJson, 'video');
		expect(results[1]).toMatchObject({
			type: 'video',
			id: 'bare',
			title: 'Bare minimum',
			url: 'https://www.youtube.com/watch?v=bare',
			verified: false,
			existingDownload: null,
		});
		expect(results[1]).not.toHaveProperty('duration', expect.anything());
	});

	it('maps channel entries and fixes protocol-relative thumbnails', () => {
		const { results } = parseSearchEntries(channelJson, 'channel');
		expect(results[0]).toEqual({
			type: 'channel',
			id: 'UCMeIfTykbcnPvbPyX7Kqr0Q',
			title: 'Oh my Bread Sourdough Baking School ',
			url: 'https://www.youtube.com/channel/UCMeIfTykbcnPvbPyX7Kqr0Q',
			thumbnail: 'https://yt3.ggpht.com/abc=s176-c-k-c0x00ffffff-no-rj-mo',
			subscriberCount: 17500,
			description: 'Hello there, Sourdough Enthusiasts!',
		});
	});

	it('maps playlist entries without inventing a video count', () => {
		const { results } = parseSearchEntries(playlistJson, 'playlist');
		expect(results[0]).toEqual({
			type: 'playlist',
			id: 'PLt_lOWx8jR_PQQqNquacTdaUuGWCD-V1S',
			title: 'Your Beginners Guide to Making Sourdough Bread',
			url: 'https://www.youtube.com/playlist?list=PLt_lOWx8jR_PQQqNquacTdaUuGWCD-V1S',
			thumbnail: 'https://i.ytimg.com/vi/BJEHsvW2J6M/hq720.jpg',
			uploader: 'LifebyMikeG',
			channelId: 'UCzH5n3Ih5kgQoiDAQt2FwLw',
		});
		expect(results[0]).not.toHaveProperty('videoCount');
	});

	it('skips entries whose shape does not match the requested type', () => {
		// asking for channels but getting video entries yields nothing
		const { results, rawCount } = parseSearchEntries(videoJson, 'channel');
		expect(results).toHaveLength(0);
		expect(rawCount).toBe(3);
	});

	it('returns empty on malformed JSON', () => {
		expect(parseSearchEntries('not json', 'video')).toEqual({ results: [], rawCount: 0 });
	});

	it('returns empty when entries is absent', () => {
		expect(parseSearchEntries('{}', 'video')).toEqual({ results: [], rawCount: 0 });
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/services/youtube-search.service.test.ts`
Expected: FAIL — `parseSearchEntries is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/server/services/youtube-search.service.ts`:

```ts
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
 * Channel avatars come back protocol-relative (`//yt3.ggpht.com/…`).
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
		url: str(e.url) ?? `https://www.youtube.com/watch?v=${e.id}`,
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/server/services/youtube-search.service.test.ts`
Expected: PASS (13 tests total across Tasks 2 and 3)

- [ ] **Step 5: Commit (ask first)**

```bash
npm run format
git add src/lib/server/services/youtube-search.service.ts src/lib/server/services/youtube-search.service.test.ts
git commit -m "feat: parse YouTube search results into a typed union"
```

---

### Task 4: Cache and the `search()` entry point

**Files:**

- Modify: `src/lib/server/services/youtube-search.service.ts` (append)
- Modify: `src/lib/server/services/youtube-search.service.test.ts` (append)

**Interfaces:**

- Consumes: `runYtdlpJson` (Task 1), `buildSearchParam` (Task 2), `parseSearchEntries` (Task 3)
- Produces:
  - `interface SearchOptions { query, type, sort, uploadDate, duration, offset, limit }`
  - `youtubeSearchService.search(opts: SearchOptions): Promise<{ results: SearchResult[]; hasMore: boolean }>`
  - `youtubeSearchService.clearCache(): void` (test seam)

- [ ] **Step 1: Write the failing test**

Append to `src/lib/server/services/youtube-search.service.test.ts`. Note the mock is declared at module scope with `vi.mock` hoisting in mind:

```ts
import { vi, beforeEach, afterEach } from 'vitest';
import { youtubeSearchService } from './youtube-search.service';

// vi.mock is hoisted above every import, so the service module below is loaded
// with this mock already in place. The factory returns a closure over
// runYtdlpJsonMock rather than the fn itself — the closure body is not
// evaluated at hoist time, which is what keeps this out of the TDZ.
const runYtdlpJsonMock = vi.fn();
vi.mock('../utils/ytdlp-json', () => ({
	runYtdlpJson: (...a: any[]) => runYtdlpJsonMock(...a),
}));

const oneVideo = JSON.stringify({
	entries: [{ _type: 'url', ie_key: 'Youtube', id: 'abc', title: 'A' }],
});

function nVideos(n: number) {
	return JSON.stringify({
		entries: Array.from({ length: n }, (_, i) => ({
			_type: 'url',
			ie_key: 'Youtube',
			id: `v${i}`,
			title: `V${i}`,
		})),
	});
}

const base = {
	query: 'sourdough',
	type: 'video' as const,
	sort: 'relevance' as const,
	uploadDate: 'any' as const,
	duration: 'any' as const,
	offset: 0,
	limit: 20,
};

describe('youtubeSearchService.search', () => {
	beforeEach(() => {
		runYtdlpJsonMock.mockReset();
		youtubeSearchService.clearCache();
		vi.useRealTimers();
	});
	afterEach(() => vi.useRealTimers());

	it('builds the results URL with an encoded query and sp param', async () => {
		runYtdlpJsonMock.mockResolvedValue(oneVideo);
		await youtubeSearchService.search({ ...base, query: 'sourdough bread' });

		const [target] = runYtdlpJsonMock.mock.calls[0];
		expect(target).toBe(
			'https://www.youtube.com/results?search_query=sourdough%20bread&sp=EgIQAQ%3D%3D',
		);
	});

	it('never passes cookies', async () => {
		runYtdlpJsonMock.mockResolvedValue(oneVideo);
		await youtubeSearchService.search(base);
		const [, opts] = runYtdlpJsonMock.mock.calls[0];
		expect(opts.cookiePath).toBeUndefined();
	});

	it('maps offset and limit onto 1-based inclusive playlist indices', async () => {
		runYtdlpJsonMock.mockResolvedValue(oneVideo);
		await youtubeSearchService.search(base);
		expect(runYtdlpJsonMock.mock.calls[0][1].extraArgs).toEqual([
			'--playlist-start',
			'1',
			'--playlist-end',
			'20',
		]);

		youtubeSearchService.clearCache();
		await youtubeSearchService.search({ ...base, offset: 20 });
		expect(runYtdlpJsonMock.mock.calls[1][1].extraArgs).toEqual([
			'--playlist-start',
			'21',
			'--playlist-end',
			'40',
		]);
	});

	it('uses a 45s timeout', async () => {
		runYtdlpJsonMock.mockResolvedValue(oneVideo);
		await youtubeSearchService.search(base);
		expect(runYtdlpJsonMock.mock.calls[0][1].timeoutMs).toBe(45000);
	});

	it('derives hasMore from the raw entry count, not the parsed length', async () => {
		// 20 raw entries, but 2 are channels so only 18 parse as videos
		const mixed = JSON.parse(nVideos(20));
		mixed.entries[0] = { _type: 'url', ie_key: 'YoutubeTab', id: 'UC1', url: '/channel/UC1' };
		mixed.entries[1] = { _type: 'url', ie_key: 'YoutubeTab', id: 'UC2', url: '/channel/UC2' };
		runYtdlpJsonMock.mockResolvedValue(JSON.stringify(mixed));

		const out = await youtubeSearchService.search(base);
		expect(out.results).toHaveLength(18);
		expect(out.hasMore).toBe(true);
	});

	it('reports hasMore false on a short page', async () => {
		runYtdlpJsonMock.mockResolvedValue(nVideos(5));
		const out = await youtubeSearchService.search(base);
		expect(out.hasMore).toBe(false);
	});

	it('serves a repeat query from cache without re-spawning yt-dlp', async () => {
		runYtdlpJsonMock.mockResolvedValue(oneVideo);
		await youtubeSearchService.search(base);
		await youtubeSearchService.search(base);
		expect(runYtdlpJsonMock).toHaveBeenCalledTimes(1);
	});

	it('treats differing filters as distinct cache keys', async () => {
		runYtdlpJsonMock.mockResolvedValue(oneVideo);
		await youtubeSearchService.search(base);
		await youtubeSearchService.search({ ...base, duration: 'long' });
		await youtubeSearchService.search({ ...base, offset: 20 });
		await youtubeSearchService.search({ ...base, type: 'channel' });
		expect(runYtdlpJsonMock).toHaveBeenCalledTimes(4);
	});

	it('re-fetches once the TTL has elapsed', async () => {
		vi.useFakeTimers();
		runYtdlpJsonMock.mockResolvedValue(oneVideo);
		await youtubeSearchService.search(base);
		vi.advanceTimersByTime(15 * 60 * 1000 + 1);
		await youtubeSearchService.search(base);
		expect(runYtdlpJsonMock).toHaveBeenCalledTimes(2);
	});

	it('evicts the oldest entry once the cap is reached', async () => {
		runYtdlpJsonMock.mockResolvedValue(oneVideo);
		// Fill the cache past its 200-entry cap.
		for (let i = 0; i < 201; i++) {
			await youtubeSearchService.search({ ...base, query: `q${i}` });
		}
		expect(runYtdlpJsonMock).toHaveBeenCalledTimes(201);

		// q0 was evicted, so it re-fetches; q200 is still cached.
		await youtubeSearchService.search({ ...base, query: 'q0' });
		expect(runYtdlpJsonMock).toHaveBeenCalledTimes(202);
		await youtubeSearchService.search({ ...base, query: 'q200' });
		expect(runYtdlpJsonMock).toHaveBeenCalledTimes(202);
	});

	it('propagates yt-dlp failures to the caller', async () => {
		runYtdlpJsonMock.mockRejectedValue(new Error('ERROR: Sign in to confirm'));
		await expect(youtubeSearchService.search(base)).rejects.toThrow('Sign in to confirm');
	});

	it('does not cache a failed search', async () => {
		runYtdlpJsonMock.mockRejectedValueOnce(new Error('boom'));
		await expect(youtubeSearchService.search(base)).rejects.toThrow('boom');
		runYtdlpJsonMock.mockResolvedValue(oneVideo);
		const out = await youtubeSearchService.search(base);
		expect(out.results).toHaveLength(1);
		expect(runYtdlpJsonMock).toHaveBeenCalledTimes(2);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/services/youtube-search.service.test.ts`
Expected: FAIL — `youtubeSearchService is undefined`

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/server/services/youtube-search.service.ts`:

```ts
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
		return entry.data;
	}

	private writeCache(key: string, data: SearchResponse): void {
		// A Map iterates in insertion order, so the first key is the oldest.
		while (this.cache.size >= CACHE_MAX_ENTRIES) {
			const oldest = this.cache.keys().next();
			if (oldest.done) break;
			this.cache.delete(oldest.value);
		}
		this.cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/server/services/youtube-search.service.test.ts`
Expected: PASS (25 tests total)

- [ ] **Step 5: Commit (ask first)**

```bash
npm run format
git add src/lib/server/services/youtube-search.service.ts src/lib/server/services/youtube-search.service.test.ts
git commit -m "feat: add cached anonymous YouTube search service"
```

---

### Task 5: API route and rate limiting

**Files:**

- Create: `src/routes/api/youtube/search/+server.ts`
- Modify: `src/lib/server/rate-limit.ts` (add to `RATE_LIMITS`, after the `settings` entry)
- Modify: `src/hooks.server.ts:33-40` (add a branch to the existing chain)
- Modify: `src/lib/server/services/youtube-search.service.ts` (append `parseSearchParams`)
- Modify: `src/lib/server/services/youtube-search.service.test.ts` (append)

**Interfaces:**

- Consumes: `youtubeSearchService.search` (Task 4), `requireAuth` from `$lib/server/guards`, `apiRoute` from `$lib/server/openapi`, `prisma` from `$lib/server/db`
- Produces: `GET /api/youtube/search` → `{ results: SearchResult[], hasMore: boolean }`; `parseSearchParams(sp: URLSearchParams): SearchOptions` (throws `Error` with a message on invalid input)

- [ ] **Step 1: Write the failing test for param validation**

Append to `src/lib/server/services/youtube-search.service.test.ts`:

```ts
import { parseSearchParams } from './youtube-search.service';

describe('parseSearchParams', () => {
	const p = (s: string) => new URLSearchParams(s);

	it('applies defaults when only q is given', () => {
		expect(parseSearchParams(p('q=sourdough'))).toEqual({
			query: 'sourdough',
			type: 'video',
			sort: 'relevance',
			uploadDate: 'any',
			duration: 'any',
			offset: 0,
			limit: 20,
		});
	});

	it('trims the query', () => {
		expect(parseSearchParams(p('q=%20%20hi%20%20')).query).toBe('hi');
	});

	it('rejects a missing or blank query', () => {
		expect(() => parseSearchParams(p(''))).toThrow('Query is required');
		expect(() => parseSearchParams(p('q=%20%20'))).toThrow('Query is required');
	});

	it('rejects a query over 200 characters', () => {
		expect(() => parseSearchParams(p(`q=${'a'.repeat(201)}`))).toThrow('Query is too long');
	});

	it('accepts a query of exactly 200 characters', () => {
		expect(parseSearchParams(p(`q=${'a'.repeat(200)}`)).query).toHaveLength(200);
	});

	it('rejects out-of-enum values rather than passing them to the encoder', () => {
		expect(() => parseSearchParams(p('q=x&type=movie'))).toThrow('Invalid type');
		expect(() => parseSearchParams(p('q=x&sort=oldest'))).toThrow('Invalid sort');
		expect(() => parseSearchParams(p('q=x&uploadDate=decade'))).toThrow('Invalid uploadDate');
		expect(() => parseSearchParams(p('q=x&duration=epic'))).toThrow('Invalid duration');
	});

	it('accepts every valid enum value', () => {
		expect(parseSearchParams(p('q=x&type=channel')).type).toBe('channel');
		expect(parseSearchParams(p('q=x&sort=views')).sort).toBe('views');
		expect(parseSearchParams(p('q=x&uploadDate=month')).uploadDate).toBe('month');
		expect(parseSearchParams(p('q=x&duration=medium')).duration).toBe('medium');
	});

	it('clamps limit to 50 and floors it at 1', () => {
		expect(parseSearchParams(p('q=x&limit=999')).limit).toBe(50);
		expect(parseSearchParams(p('q=x&limit=0')).limit).toBe(1);
		expect(parseSearchParams(p('q=x&limit=-5')).limit).toBe(1);
	});

	it('floors offset at 0 and ignores non-numeric input', () => {
		expect(parseSearchParams(p('q=x&offset=-10')).offset).toBe(0);
		expect(parseSearchParams(p('q=x&offset=abc')).offset).toBe(0);
		expect(parseSearchParams(p('q=x&limit=abc')).limit).toBe(20);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/services/youtube-search.service.test.ts`
Expected: FAIL — `parseSearchParams is not a function`

- [ ] **Step 3: Implement `parseSearchParams`**

Append to `src/lib/server/services/youtube-search.service.ts`:

```ts
const MAX_QUERY_LENGTH = 200;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

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
		offset: pickInt(sp.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER),
		limit: pickInt(sp.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT),
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/server/services/youtube-search.service.test.ts`
Expected: PASS (35 tests total)

- [ ] **Step 5: Add the rate limit bucket**

In `src/lib/server/rate-limit.ts`, inside `RATE_LIMITS`, after the `settings` entry:

```ts
	// Each uncached search spawns a yt-dlp process. Cache hits count against
	// this too (the hook runs before the handler and cannot tell), so the
	// budget has to accommodate filter-fiddling, which is mostly cache hits.
	youtubeSearch: {
		windowMs: 60 * 1000,
		maxRequests: 120,
	},
```

In `src/hooks.server.ts`, extend the existing chain (currently ending with the `/api/settings` branch around line 38):

```ts
		} else if (event.url.pathname.startsWith('/api/settings')) {
			rateLimitConfig = RATE_LIMITS.settings;
		} else if (event.url.pathname.startsWith('/api/youtube/search')) {
			rateLimitConfig = RATE_LIMITS.youtubeSearch;
		}
```

- [ ] **Step 6: Create the route**

Create `src/routes/api/youtube/search/+server.ts`:

```ts
import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/guards';
import { prisma } from '$lib/server/db';
import { apiRoute } from '$lib/server/openapi';
import {
	youtubeSearchService,
	parseSearchParams,
	type SearchResult,
} from '$lib/server/services/youtube-search.service';
import type { RequestHandler } from './$types';

/**
 * Attach the caller's existing downloads to video results.
 *
 * Done here rather than in the service because the service's cache is shared
 * across all users — baking per-user state into it would leak one user's
 * library into another's results.
 */
async function attachExistingDownloads(
	results: SearchResult[],
	userId: string,
): Promise<SearchResult[]> {
	const ids = results.filter((r) => r.type === 'video').map((r) => r.id);
	if (ids.length === 0) return results;

	const existing = await prisma.download.findMany({
		where: { userId, videoId: { in: ids }, status: { notIn: ['DELETED'] } },
		select: { id: true, videoId: true, status: true },
		orderBy: { createdAt: 'desc' },
	});

	// Most recent wins — findMany is ordered desc, so only set the first hit.
	const byVideoId = new Map<string, { id: string; status: string }>();
	for (const d of existing) {
		if (d.videoId && !byVideoId.has(d.videoId)) {
			byVideoId.set(d.videoId, { id: d.id, status: d.status });
		}
	}

	return results.map((r) =>
		r.type === 'video' ? { ...r, existingDownload: byVideoId.get(r.id) ?? null } : r,
	);
}

export const GET = apiRoute(
	'/api/youtube/search',
	'GET',
	{
		summary: 'Search YouTube',
		description:
			'Search YouTube for videos, channels or playlists. Runs anonymously — the ' +
			"caller's linked YouTube cookies are never used. Results are cached server-side " +
			'for 15 minutes.',
		tags: ['YouTube'],
		auth: true,
		query: {
			q: { type: 'string', required: true, description: 'Search query (max 200 chars)' },
			type: {
				type: 'string',
				description: 'Result type',
				enum: ['video', 'channel', 'playlist'],
				default: 'video',
			},
			sort: {
				type: 'string',
				description: 'Sort order',
				enum: ['relevance', 'date', 'views', 'rating'],
				default: 'relevance',
			},
			uploadDate: {
				type: 'string',
				description: 'Upload recency filter (videos only)',
				enum: ['any', 'hour', 'today', 'week', 'month', 'year'],
				default: 'any',
			},
			duration: {
				type: 'string',
				description: 'Length filter (videos only)',
				enum: ['any', 'short', 'medium', 'long'],
				default: 'any',
			},
			offset: { type: 'integer', default: 0 },
			limit: { type: 'integer', default: 20, description: 'Max 50' },
		},
		responses: {
			200: {
				description: 'Search results',
				schema: {
					type: 'object',
					properties: {
						results: { type: 'array', items: { type: 'object' } },
						hasMore: { type: 'boolean' },
					},
				},
			},
		},
	},
	async ({ locals, url }) => {
		const userId = requireAuth(locals);

		let opts;
		try {
			opts = parseSearchParams(url.searchParams);
		} catch (e: any) {
			throw error(400, e.message);
		}

		let response;
		try {
			response = await youtubeSearchService.search(opts);
		} catch (e: any) {
			// stderr can carry URLs and internals — log it, never return it.
			console.error('YouTube search failed:', e?.message ?? e);
			throw error(502, 'YouTube search is unavailable right now. Please try again.');
		}

		return json({
			results: await attachExistingDownloads(response.results, userId),
			hasMore: response.hasMore,
		});
	},
) satisfies RequestHandler;
```

- [ ] **Step 7: Verify the route compiles and works end to end**

Run: `npm run check`
Expected: no new errors.

Then, with the dev stack up (`docker compose -f docker-compose.dev.yml up -d`), sign in through the UI and hit the endpoint in the browser console or via curl with a session cookie:

```
/api/youtube/search?q=sourdough&type=video&duration=long&sort=date
```

Expected: JSON with ~20 results, every `duration` over 1200, `hasMore: true`, and each video carrying `existingDownload: null` (or a real id if you already have it). A second identical request should return noticeably faster — that is the cache.

Also confirm the failure path: `?q=` returns **400 "Query is required"**, and `?q=x&type=movie` returns **400 "Invalid type: movie"**.

- [ ] **Step 8: Commit (ask first)**

```bash
npm run format
git add src/routes/api/youtube/search/+server.ts src/lib/server/rate-limit.ts src/hooks.server.ts src/lib/server/services/youtube-search.service.ts src/lib/server/services/youtube-search.service.test.ts
git commit -m "feat: add GET /api/youtube/search"
```

---

### Task 6: Split the search page into tabs

Pure refactor plus the sidebar link. No change to library-search behaviour — that is the acceptance criterion.

**Files:**

- Create: `src/lib/components/search/LibrarySearch.svelte`
- Modify: `src/routes/search/+page.svelte` (currently 590 lines → ~120)
- Modify: `src/lib/components/ui/Sidebar.svelte:32-38` (`libraryItems`)

**Interfaces:**

- Consumes: nothing from earlier tasks
- Produces: `LibrarySearch.svelte` (no props); `/search?tab=library|youtube` URL contract that Task 7 plugs into

- [ ] **Step 1: Move the library search body into its own component**

Create `src/lib/components/search/LibrarySearch.svelte` containing **everything** currently in `src/routes/search/+page.svelte` except:

- the `<svelte:head>` block (stays on the page)
- the outer `<div class="page">` wrapper and the `<h1>Search</h1>` heading (both move to the page shell)

Move the `<script>` block verbatim, the markup from `.search-bar` through the results/empty-state section, and every `<style>` rule those elements use. Keep the 300ms debounce exactly as-is — the Library tab still debounces; only the YouTube tab requires explicit submit.

- [ ] **Step 2: Rewrite the page as a tab shell**

Replace `src/routes/search/+page.svelte` with:

```svelte
<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import LibrarySearch from '$lib/components/search/LibrarySearch.svelte';
	import YouTubeSearch from '$lib/components/search/YouTubeSearch.svelte';

	type Tab = 'library' | 'youtube';

	const tab = $derived<Tab>(
		$page.url.searchParams.get('tab') === 'youtube' ? 'youtube' : 'library',
	);

	function selectTab(next: Tab) {
		const url = new URL($page.url);
		if (next === 'library') url.searchParams.delete('tab');
		else url.searchParams.set('tab', next);
		goto(`${url.pathname}${url.search}`, { replaceState: true, keepFocus: true, noScroll: true });
	}
</script>

<svelte:head>
	<title>Search - wytui</title>
</svelte:head>

<div class="page">
	<h1>Search</h1>

	<div class="tabs" role="tablist" aria-label="Search source">
		<button
			role="tab"
			class="tab"
			class:active={tab === 'library'}
			aria-selected={tab === 'library'}
			onclick={() => selectTab('library')}
		>
			Library
		</button>
		<button
			role="tab"
			class="tab"
			class:active={tab === 'youtube'}
			aria-selected={tab === 'youtube'}
			onclick={() => selectTab('youtube')}
		>
			YouTube
		</button>
	</div>

	{#if tab === 'youtube'}
		<YouTubeSearch />
	{:else}
		<LibrarySearch />
	{/if}
</div>

<style>
	.page {
		padding: 1.5rem;
		max-width: 1400px;
		margin: 0 auto;
	}

	h1 {
		margin: 0 0 1rem;
		font-size: 1.5rem;
		font-weight: 600;
	}

	.tabs {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid var(--border);
		margin-bottom: 1.25rem;
	}

	.tab {
		padding: 0.6rem 1.1rem;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--text-secondary);
		font-size: 0.9rem;
		font-weight: 500;
		cursor: pointer;
		transition:
			color 0.15s,
			border-color 0.15s;
	}

	.tab:hover {
		color: var(--text);
	}

	.tab.active {
		color: var(--accent);
		border-bottom-color: var(--accent);
	}
</style>
```

Check the `.page` and `h1` rules against what the original file used and keep the original values if they differ — the goal is a visually identical Library tab. Also confirm the CSS variable names (`--border`, `--text`, `--text-secondary`, `--accent`) against `src/app.css` and substitute the real ones.

- [ ] **Step 3: Create a placeholder `YouTubeSearch.svelte` so the page compiles**

Create `src/lib/components/search/YouTubeSearch.svelte`:

```svelte
<p>YouTube search coming in the next task.</p>
```

Task 7 replaces this wholesale.

- [ ] **Step 4: Add the sidebar entry**

In `src/lib/components/ui/Sidebar.svelte`, add to `libraryItems` (the `search` icon case already exists at ~line 191, but nothing currently renders it):

```ts
const libraryItems: NavItem[] = [
	{ label: 'Downloads', href: '/downloads', icon: 'download' },
	{ label: 'Search', href: '/search', icon: 'search' },
	{ label: 'Channels', href: '/channels', icon: 'channel' },
	{ label: 'Subscriptions', href: '/subscriptions', icon: 'broadcast' },
	{ label: 'Monitors', href: '/monitors', icon: 'eye' },
	{ label: 'Playlists', href: '/playlists', icon: 'playlist' },
];
```

- [ ] **Step 5: Verify the refactor changed nothing**

Run: `npm run check && npm run test`
Expected: no new errors, all tests pass.

Then in the browser: open `/search`, confirm the Library tab looks and behaves exactly as before (type a query, results appear after ~300ms, the type/storage/uploader filters still work, the clear button still works). Confirm the sidebar now shows Search and highlights when active. Confirm clicking YouTube puts `?tab=youtube` in the URL and that a reload keeps you on that tab.

- [ ] **Step 6: Commit (ask first)**

```bash
npm run format
git add src/routes/search/+page.svelte src/lib/components/search/ src/lib/components/ui/Sidebar.svelte
git commit -m "refactor: split search page into Library/YouTube tabs"
```

---

### Task 7: The YouTube search UI (read-only)

Search box, filters, URL state, fetching, and rendering all three result types. Actions come in Task 8.

**Files:**

- Modify: `src/lib/utils/format.ts` (add `formatCount`)
- Create: `src/lib/utils/format.test.ts`
- Modify: `src/lib/components/search/YouTubeSearch.svelte` (replace the placeholder)
- Create: `src/lib/components/search/YouTubeVideoResult.svelte`
- Create: `src/lib/components/search/YouTubeChannelResult.svelte`
- Create: `src/lib/components/search/YouTubePlaylistResult.svelte`

**Interfaces:**

- Consumes: `GET /api/youtube/search` (Task 5), the tab shell (Task 6)
- Produces: row components taking `{ result, selected?, onToggle? }`; Task 8 adds action props to these same components

- [ ] **Step 1: Write the failing test for `formatCount`**

Create `src/lib/utils/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatCount } from './format';

describe('formatCount', () => {
	it('leaves values under 1000 alone', () => {
		expect(formatCount(0)).toBe('0');
		expect(formatCount(999)).toBe('999');
	});

	it('abbreviates thousands', () => {
		expect(formatCount(1000)).toBe('1K');
		expect(formatCount(1200)).toBe('1.2K');
		expect(formatCount(17500)).toBe('17.5K');
		expect(formatCount(999_000)).toBe('999K');
	});

	it('abbreviates millions', () => {
		expect(formatCount(1_000_000)).toBe('1M');
		expect(formatCount(2_761_758)).toBe('2.8M');
		expect(formatCount(3_542_314)).toBe('3.5M');
	});

	it('abbreviates billions', () => {
		expect(formatCount(1_500_000_000)).toBe('1.5B');
	});

	it('drops a trailing .0', () => {
		expect(formatCount(2_000_000)).toBe('2M');
		expect(formatCount(15_000)).toBe('15K');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/utils/format.test.ts`
Expected: FAIL — `formatCount is not a function`

- [ ] **Step 3: Implement `formatCount`**

Append to `src/lib/utils/format.ts`:

```ts
/** Abbreviate a count the way YouTube does: 2761758 -> "2.8M". */
export function formatCount(n: number): string {
	const units: [number, string][] = [
		[1_000_000_000, 'B'],
		[1_000_000, 'M'],
		[1_000, 'K'],
	];
	for (const [size, suffix] of units) {
		if (n >= size) {
			const scaled = n / size;
			// One decimal below 100, none above — "2.8M" but "999K".
			const text = scaled < 100 ? scaled.toFixed(1) : String(Math.round(scaled));
			return `${text.replace(/\.0$/, '')}${suffix}`;
		}
	}
	return String(n);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/utils/format.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Create the three row components**

Create `src/lib/components/search/YouTubeVideoResult.svelte`:

```svelte
<script lang="ts">
	import { formatDuration, formatCount } from '$lib/utils/format';

	interface VideoResult {
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
		existingDownload: { id: string; status: string } | null;
	}

	interface Props {
		result: VideoResult;
		selected: boolean;
		onToggle: (id: string) => void;
	}

	let { result, selected, onToggle }: Props = $props();
</script>

<div class="row" class:selected>
	<input
		type="checkbox"
		class="row-check"
		checked={selected}
		onchange={() => onToggle(result.id)}
		aria-label="Select {result.title}"
	/>

	<div class="thumb-wrap">
		{#if result.thumbnail}
			<img class="thumb" src={result.thumbnail} alt="" loading="lazy" />
		{:else}
			<div class="thumb thumb-empty"></div>
		{/if}
		{#if result.duration}
			<span class="duration">{formatDuration(result.duration)}</span>
		{/if}
	</div>

	<div class="body">
		<a class="title" href={result.url} target="_blank" rel="noopener noreferrer">
			{result.title}
		</a>
		<div class="meta">
			{#if result.uploader}
				<span class="uploader">
					{result.uploader}{#if result.verified}<span class="verified" title="Verified">✓</span
						>{/if}
				</span>
			{/if}
			{#if result.viewCount}
				<span class="dot">·</span><span>{formatCount(result.viewCount)} views</span>
			{/if}
		</div>
		{#if result.description}
			<p class="desc">{result.description}</p>
		{/if}
	</div>

	<div class="actions">
		{#if result.existingDownload}
			<a class="downloaded" href="/downloads/{result.existingDownload.id}"> ✓ Downloaded </a>
		{/if}
		<!-- Task 8 adds the Download button here -->
	</div>
</div>

<style>
	.row {
		display: grid;
		grid-template-columns: auto 168px 1fr auto;
		gap: 0.75rem;
		align-items: start;
		padding: 0.75rem;
		border-radius: 8px;
	}
	.row:hover {
		background: var(--bg-hover);
	}
	.row.selected {
		background: var(--bg-selected, var(--bg-hover));
	}
	.row-check {
		margin-top: 0.4rem;
		cursor: pointer;
	}
	.thumb-wrap {
		position: relative;
	}
	.thumb {
		width: 168px;
		aspect-ratio: 16 / 9;
		object-fit: cover;
		border-radius: 6px;
		display: block;
	}
	.thumb-empty {
		background: var(--bg-secondary);
	}
	.duration {
		position: absolute;
		right: 4px;
		bottom: 4px;
		padding: 1px 4px;
		border-radius: 3px;
		background: rgba(0, 0, 0, 0.8);
		color: #fff;
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
	}
	.body {
		min-width: 0;
	}
	.title {
		display: block;
		font-weight: 500;
		color: var(--text);
		text-decoration: none;
		line-height: 1.35;
	}
	.title:hover {
		text-decoration: underline;
	}
	.meta {
		margin-top: 0.25rem;
		font-size: 0.82rem;
		color: var(--text-secondary);
	}
	.verified {
		margin-left: 0.2rem;
	}
	.dot {
		margin: 0 0.35rem;
	}
	.desc {
		margin: 0.35rem 0 0;
		font-size: 0.8rem;
		color: var(--text-secondary);
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
	}
	.actions {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		align-items: flex-end;
	}
	.downloaded {
		font-size: 0.8rem;
		color: var(--success, green);
		text-decoration: none;
		white-space: nowrap;
	}
	.downloaded:hover {
		text-decoration: underline;
	}
</style>
```

Create `src/lib/components/search/YouTubeChannelResult.svelte`:

```svelte
<script lang="ts">
	import { formatCount } from '$lib/utils/format';

	interface ChannelResult {
		type: 'channel';
		id: string;
		title: string;
		url: string;
		thumbnail?: string;
		subscriberCount?: number;
		description?: string;
	}

	interface Props {
		result: ChannelResult;
	}

	let { result }: Props = $props();
</script>

<div class="row">
	{#if result.thumbnail}
		<img class="avatar" src={result.thumbnail} alt="" loading="lazy" />
	{:else}
		<div class="avatar avatar-empty"></div>
	{/if}

	<div class="body">
		<a class="title" href={result.url} target="_blank" rel="noopener noreferrer">
			{result.title.trim()}
		</a>
		{#if result.subscriberCount}
			<div class="meta">{formatCount(result.subscriberCount)} subscribers</div>
		{/if}
		{#if result.description}
			<p class="desc">{result.description}</p>
		{/if}
	</div>

	<div class="actions">
		<!-- Task 8 adds the Subscribe button here -->
	</div>
</div>

<style>
	.row {
		display: grid;
		grid-template-columns: 88px 1fr auto;
		gap: 0.75rem;
		align-items: center;
		padding: 0.75rem;
		border-radius: 8px;
	}
	.row:hover {
		background: var(--bg-hover);
	}
	.avatar {
		width: 88px;
		height: 88px;
		border-radius: 50%;
		object-fit: cover;
		display: block;
	}
	.avatar-empty {
		background: var(--bg-secondary);
	}
	.body {
		min-width: 0;
	}
	.title {
		font-weight: 500;
		color: var(--text);
		text-decoration: none;
	}
	.title:hover {
		text-decoration: underline;
	}
	.meta {
		margin-top: 0.2rem;
		font-size: 0.82rem;
		color: var(--text-secondary);
	}
	.desc {
		margin: 0.35rem 0 0;
		font-size: 0.8rem;
		color: var(--text-secondary);
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
	}
</style>
```

Create `src/lib/components/search/YouTubePlaylistResult.svelte`:

```svelte
<script lang="ts">
	interface PlaylistResult {
		type: 'playlist';
		id: string;
		title: string;
		url: string;
		thumbnail?: string;
		uploader?: string;
		channelId?: string;
	}

	interface Props {
		result: PlaylistResult;
	}

	let { result }: Props = $props();
</script>

<div class="row">
	{#if result.thumbnail}
		<img class="thumb" src={result.thumbnail} alt="" loading="lazy" />
	{:else}
		<div class="thumb thumb-empty"></div>
	{/if}

	<div class="body">
		<a class="title" href={result.url} target="_blank" rel="noopener noreferrer">
			{result.title}
		</a>
		{#if result.uploader}
			<div class="meta">{result.uploader}</div>
		{/if}
		<!-- Video count is deliberately absent: yt-dlp's flat output does not
		     carry it, and fetching it would cost one extra yt-dlp run per row. -->
	</div>

	<div class="actions">
		<!-- Task 8 adds the Import button here -->
	</div>
</div>

<style>
	.row {
		display: grid;
		grid-template-columns: 168px 1fr auto;
		gap: 0.75rem;
		align-items: center;
		padding: 0.75rem;
		border-radius: 8px;
	}
	.row:hover {
		background: var(--bg-hover);
	}
	.thumb {
		width: 168px;
		aspect-ratio: 16 / 9;
		object-fit: cover;
		border-radius: 6px;
		display: block;
	}
	.thumb-empty {
		background: var(--bg-secondary);
	}
	.body {
		min-width: 0;
	}
	.title {
		font-weight: 500;
		color: var(--text);
		text-decoration: none;
	}
	.title:hover {
		text-decoration: underline;
	}
	.meta {
		margin-top: 0.2rem;
		font-size: 0.82rem;
		color: var(--text-secondary);
	}
</style>
```

- [ ] **Step 6: Build the container component**

Replace `src/lib/components/search/YouTubeSearch.svelte`:

```svelte
<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { addToast } from '$lib/stores/toast.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import YouTubeVideoResult from './YouTubeVideoResult.svelte';
	import YouTubeChannelResult from './YouTubeChannelResult.svelte';
	import YouTubePlaylistResult from './YouTubePlaylistResult.svelte';

	type ResultType = 'video' | 'channel' | 'playlist';
	type Sort = 'relevance' | 'date' | 'views' | 'rating';
	type UploadDate = 'any' | 'hour' | 'today' | 'week' | 'month' | 'year';
	type Duration = 'any' | 'short' | 'medium' | 'long';

	const PAGE_SIZE = 20;

	// Input state is separate from the committed query: typing must not trigger
	// a search, because each one spawns a 3-7s yt-dlp process.
	let input = $state($page.url.searchParams.get('q') ?? '');
	let query = $state($page.url.searchParams.get('q') ?? '');
	let type = $state<ResultType>(
		(($page.url.searchParams.get('type') as ResultType) ?? 'video') || 'video',
	);
	let sort = $state<Sort>(
		(($page.url.searchParams.get('sort') as Sort) ?? 'relevance') || 'relevance',
	);
	let uploadDate = $state<UploadDate>(
		(($page.url.searchParams.get('uploadDate') as UploadDate) ?? 'any') || 'any',
	);
	let duration = $state<Duration>(
		(($page.url.searchParams.get('duration') as Duration) ?? 'any') || 'any',
	);

	let results = $state<any[]>([]);
	let hasMore = $state(false);
	let loading = $state(false);
	let loadingMore = $state(false);
	let searched = $state(false);
	let errorMessage = $state('');
	let selected = $state(new Set<string>());

	/** Mirror the current search into the URL so it is linkable and reload-safe. */
	function syncUrl() {
		const url = new URL($page.url);
		const set = (k: string, v: string, dflt: string) =>
			v && v !== dflt ? url.searchParams.set(k, v) : url.searchParams.delete(k);
		set('q', query, '');
		set('type', type, 'video');
		set('sort', sort, 'relevance');
		set('uploadDate', uploadDate, 'any');
		set('duration', duration, 'any');
		url.searchParams.set('tab', 'youtube');
		goto(`${url.pathname}${url.search}`, {
			replaceState: true,
			keepFocus: true,
			noScroll: true,
		});
	}

	async function runSearch(offset: number) {
		const params = new URLSearchParams({
			q: query,
			type,
			sort,
			uploadDate,
			duration,
			offset: String(offset),
			limit: String(PAGE_SIZE),
		});

		const res = await fetch(`/api/youtube/search?${params}`);
		if (!res.ok) {
			// SvelteKit's error() puts the text in `message`. Surface it verbatim —
			// the 429 from hooks.server.ts already reads "Try again in N seconds."
			const body = await res.json().catch(() => ({}));
			throw new Error(body?.message || 'Search failed');
		}
		return res.json();
	}

	async function search() {
		if (!input.trim()) return;
		query = input.trim();
		syncUrl();

		loading = true;
		errorMessage = '';
		selected = new Set();
		try {
			const data = await runSearch(0);
			results = data.results;
			hasMore = data.hasMore;
		} catch (e: any) {
			results = [];
			hasMore = false;
			errorMessage = e.message || 'Search failed';
			addToast('error', errorMessage);
		} finally {
			loading = false;
			searched = true;
		}
	}

	async function loadMore() {
		loadingMore = true;
		try {
			const data = await runSearch(results.length);
			// Selection survives Load more; only a new search clears it.
			results = [...results, ...data.results];
			hasMore = data.hasMore;
		} catch (e: any) {
			addToast('error', e.message || 'Failed to load more results');
		} finally {
			loadingMore = false;
		}
	}

	/** Filters re-search immediately, but only once a query is committed. */
	function onFilterChange() {
		if (query) void search();
		else syncUrl();
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') void search();
	}

	function toggle(id: string) {
		const next = new Set(selected);
		next.has(id) ? next.delete(id) : next.add(id);
		selected = next;
	}
</script>

<div class="search-bar">
	<input
		type="text"
		class="search-input"
		placeholder="Search YouTube..."
		bind:value={input}
		onkeydown={onKeydown}
	/>
	<button class="btn-search" onclick={search} disabled={!input.trim() || loading}>
		{loading ? 'Searching...' : 'Search'}
	</button>
</div>

<div class="filter-bar">
	<div class="filter-group">
		<label class="filter-label" for="yt-type">Type</label>
		<select id="yt-type" class="filter-select" bind:value={type} onchange={onFilterChange}>
			<option value="video">Videos</option>
			<option value="channel">Channels</option>
			<option value="playlist">Playlists</option>
		</select>
	</div>

	<div class="filter-group">
		<label class="filter-label" for="yt-sort">Sort by</label>
		<select id="yt-sort" class="filter-select" bind:value={sort} onchange={onFilterChange}>
			<option value="relevance">Relevance</option>
			<option value="date">Upload date</option>
			<option value="views">View count</option>
			<option value="rating">Rating</option>
		</select>
	</div>

	{#if type === 'video'}
		<div class="filter-group">
			<label class="filter-label" for="yt-date">Uploaded</label>
			<select id="yt-date" class="filter-select" bind:value={uploadDate} onchange={onFilterChange}>
				<option value="any">Any time</option>
				<option value="hour">Last hour</option>
				<option value="today">Today</option>
				<option value="week">This week</option>
				<option value="month">This month</option>
				<option value="year">This year</option>
			</select>
		</div>

		<div class="filter-group">
			<label class="filter-label" for="yt-length">Length</label>
			<select id="yt-length" class="filter-select" bind:value={duration} onchange={onFilterChange}>
				<option value="any">Any length</option>
				<option value="short">Under 4 minutes</option>
				<option value="medium">4-20 minutes</option>
				<option value="long">Over 20 minutes</option>
			</select>
		</div>
	{/if}
</div>

{#if loading}
	<Skeleton count={6} variant="row" />
{:else if errorMessage}
	<EmptyState title="Search unavailable" description={errorMessage} />
{:else if searched && results.length === 0}
	<EmptyState title="No results" description="Try a different query or loosen the filters." />
{:else if results.length > 0}
	<div class="results">
		{#each results as result (result.id)}
			{#if result.type === 'video'}
				<YouTubeVideoResult {result} selected={selected.has(result.id)} onToggle={toggle} />
			{:else if result.type === 'channel'}
				<YouTubeChannelResult {result} />
			{:else}
				<YouTubePlaylistResult {result} />
			{/if}
		{/each}
	</div>

	{#if hasMore}
		<div class="load-more">
			<button class="btn-more" onclick={loadMore} disabled={loadingMore}>
				{loadingMore ? 'Loading...' : 'Load more'}
			</button>
		</div>
	{/if}
{:else if query}
	<!-- A shared link or a carried-over Library query: the form is restored but
	     nothing has been submitted. Auto-searching here would violate the
	     "tab switching does not auto-search" rule, since a tab click mounts this
	     component with exactly the same state a shared link produces. -->
	<EmptyState
		title="Ready to search"
		description={`Press Search to look up "${query}" on YouTube.`}
	/>
{:else}
	<EmptyState
		title="Search YouTube"
		description="Find videos, channels and playlists, then download them straight into wytui."
	/>
{/if}

<style>
	.search-bar {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.search-input {
		flex: 1;
		padding: 0.6rem 0.85rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg-secondary);
		color: var(--text);
		font-size: 0.95rem;
	}
	.btn-search {
		padding: 0.6rem 1.25rem;
		border: none;
		border-radius: 8px;
		background: var(--accent);
		color: #fff;
		font-weight: 500;
		cursor: pointer;
	}
	.btn-search:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.filter-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		margin-bottom: 1.25rem;
	}
	.filter-group {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.filter-label {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}
	.filter-select {
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg-secondary);
		color: var(--text);
		font-size: 0.85rem;
	}
	.results {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.load-more {
		display: flex;
		justify-content: center;
		padding: 1.25rem 0;
	}
	.btn-more {
		padding: 0.55rem 1.5rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg-secondary);
		color: var(--text);
		cursor: pointer;
	}
	.btn-more:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
</style>
```

`Skeleton` takes `count` and `variant` (`'card' | 'row' | 'text' | 'list' | 'grid' | 'table-row'`) and renders its own repetition — do not wrap it in an `{#each}`. `EmptyState` takes `title` and optional `description`. Both are confirmed against the current components.

- [ ] **Step 7: Verify**

Run: `npm run check && npm run test`
Expected: no new errors, all tests pass.

In the browser at `/search?tab=youtube`:

- Typing does **not** fire a request (watch the network tab) — only Enter or the Search button does.
- Searching "sourdough" returns ~20 video rows with thumbnails, durations, view counts and verified ticks.
- Switching Type to Channels shows round avatars and subscriber counts, and hides the Uploaded/Length filters.
- Switching Type to Playlists shows playlist rows with no video count.
- Changing Sort/Uploaded/Length re-searches immediately.
- The URL tracks every filter; reloading restores the query in the box (unsubmitted) and the filters.
- Load more appends a second page.
- Checkboxes toggle and highlight rows.
- A video you have already downloaded shows the "✓ Downloaded" link.

- [ ] **Step 8: Commit (ask first)**

```bash
npm run format
git add src/lib/utils/format.ts src/lib/utils/format.test.ts src/lib/components/search/
git commit -m "feat: add YouTube search UI with filters and pagination"
```

---

### Task 8: Wire up the actions

Adds the profile picker, per-row download, the batch selection bar, Subscribe, and Import.

**Files:**

- Modify: `src/lib/components/search/YouTubeSearch.svelte`
- Modify: `src/lib/components/search/YouTubeVideoResult.svelte`
- Modify: `src/lib/components/search/YouTubeChannelResult.svelte`
- Modify: `src/lib/components/search/YouTubePlaylistResult.svelte`

**Interfaces:**

- Consumes: everything from Task 7; `GET /api/profiles`, `POST /api/downloads/quick`, `POST /api/downloads/batch`, `POST /api/subscriptions`, `POST /api/playlists/import`
- Produces: nothing downstream — this is the last task

- [ ] **Step 1: Add the profile picker and action handlers to the container**

In `src/lib/components/search/YouTubeSearch.svelte`, add to the imports:

```ts
import { csrfFetch } from '$lib/utils/fetch';
```

Add state next to the existing declarations:

```ts
	interface Profile {
		id: string;
		name: string;
		isDefault?: boolean;
	}

	let profiles = $state<Profile[]>([]);
	let profileId = $state('');
	let saveToLibrary = $state(false);
	let busyIds = $state(new Set<string>());
	let batchBusy = $state(false);

	// Loaded once, when the YouTube tab first mounts.
	$effect(() => {
		void loadProfiles();
	});

	async function loadProfiles() {
		try {
			const res = await fetch('/api/profiles');
			if (!res.ok) return;
			profiles = await res.json();
			profileId = (profiles.find((p) => p.isDefault) ?? profiles[0])?.id ?? '';
		} catch {
			// Non-fatal: the action buttons stay disabled and explain why.
		}
	}

	function setBusy(id: string, on: boolean) {
		const next = new Set(busyIds);
		on ? next.add(id) : next.delete(id);
		busyIds = next;
	}

	async function downloadOne(result: any) {
		if (!profileId) return;
		setBusy(result.id, true);
		try {
			const res = await csrfFetch('/api/downloads/quick', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: result.url, profileId, saveToLibrary }),
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body?.error || body?.message || 'Download failed');
			}
			const download = await res.json();
			addToast('success', `Queued "${result.title}"`);
			// Reflect it immediately so the row flips to the Downloaded link.
			results = results.map((r) =>
				r.id === result.id
					? { ...r, existingDownload: { id: download.id, status: download.status } }
					: r,
			);
		} catch (e: any) {
			addToast('error', e.message || 'Download failed');
		} finally {
			setBusy(result.id, false);
		}
	}

	async function downloadSelected() {
		if (!profileId || selected.size === 0) return;
		const chosen = results.filter((r) => selected.has(r.id));
		batchBusy = true;
		try {
			const res = await csrfFetch('/api/downloads/batch', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					urls: chosen.map((r) => r.url),
					profileId,
					saveToLibrary,
				}),
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body?.message || 'Batch download failed');
			}
			const out = await res.json();
			// addToast only accepts 'success' | 'error' | 'info' — no 'warning'.
			if (out.failed > 0) {
				addToast('info', `Queued ${out.succeeded}, ${out.failed} failed`);
			} else {
				addToast('success', `Queued ${out.succeeded} video${out.succeeded === 1 ? '' : 's'}`);
			}
			selected = new Set();
		} catch (e: any) {
			addToast('error', e.message || 'Batch download failed');
		} finally {
			batchBusy = false;
		}
	}

	async function subscribe(result: any) {
		if (!profileId) return;
		setBusy(result.id, true);
		try {
			const res = await csrfFetch('/api/subscriptions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					url: result.url,
					name: result.title.trim(),
					profileId,
					type: 'CHANNEL',
					saveToLibrary,
				}),
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body?.message || 'Failed to subscribe');
			}
			addToast('success', `Subscribed to ${result.title.trim()}`);
		} catch (e: any) {
			addToast('error', e.message || 'Failed to subscribe');
		} finally {
			setBusy(result.id, false);
		}
	}

	async function importPlaylist(result: any) {
		if (!profileId) return;
		setBusy(result.id, true);
		try {
			const res = await csrfFetch('/api/playlists/import', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: result.url, profileId, saveToLibrary }),
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body?.message || 'Failed to import playlist');
			}
			addToast('success', `Importing "${result.title}"`);
		} catch (e: any) {
			addToast('error', e.message || 'Failed to import playlist');
		} finally {
			setBusy(result.id, false);
		}
	}
</script>
```

- [ ] **Step 2: Add the profile picker to the filter bar**

Inside `.filter-bar` in `YouTubeSearch.svelte`, after the last filter group:

```svelte
<div class="filter-group filter-group-end">
	<label class="filter-label" for="yt-profile">Profile</label>
	<select id="yt-profile" class="filter-select" bind:value={profileId}>
		{#each profiles as p (p.id)}
			<option value={p.id}>{p.name}</option>
		{/each}
	</select>
</div>
```

And add the style rule:

```css
.filter-group-end {
	margin-left: auto;
}
```

Below the `.filter-bar` div, add the no-profile warning:

```svelte
{#if profiles.length === 0}
	<p class="no-profile">
		No download profile found — <a href="/settings">create one in Settings</a> before downloading.
	</p>
{/if}
```

```css
.no-profile {
	margin: -0.5rem 0 1rem;
	font-size: 0.83rem;
	color: var(--warning, #b45309);
}
```

- [ ] **Step 3: Pass the handlers into the row components**

Update the `{#each}` block in `YouTubeSearch.svelte`:

```svelte
{#each results as result (result.id)}
	{#if result.type === 'video'}
		<YouTubeVideoResult
			{result}
			selected={selected.has(result.id)}
			onToggle={toggle}
			onDownload={downloadOne}
			busy={busyIds.has(result.id)}
			disabled={!profileId}
		/>
	{:else if result.type === 'channel'}
		<YouTubeChannelResult
			{result}
			onSubscribe={subscribe}
			busy={busyIds.has(result.id)}
			disabled={!profileId}
		/>
	{:else}
		<YouTubePlaylistResult
			{result}
			onImport={importPlaylist}
			busy={busyIds.has(result.id)}
			disabled={!profileId}
		/>
	{/if}
{/each}
```

- [ ] **Step 4: Add the sticky selection bar**

At the very end of the markup in `YouTubeSearch.svelte`, after the results block:

```svelte
{#if selected.size > 0}
	<div class="selection-bar">
		<span class="selection-count">{selected.size} selected</span>
		<button class="btn-link" onclick={() => (selected = new Set())}>Clear</button>
		<label class="library-toggle">
			<input type="checkbox" bind:checked={saveToLibrary} />
			Save to library
		</label>
		<button class="btn-primary" onclick={downloadSelected} disabled={batchBusy || !profileId}>
			{batchBusy ? 'Queuing...' : `Download ${selected.size}`}
		</button>
	</div>
{/if}
```

```css
.selection-bar {
	position: sticky;
	bottom: 0;
	display: flex;
	align-items: center;
	gap: 1rem;
	padding: 0.75rem 1rem;
	margin-top: 0.5rem;
	border-top: 1px solid var(--border);
	background: var(--bg);
	box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.08);
}
.selection-count {
	font-weight: 500;
}
.btn-link {
	background: none;
	border: none;
	color: var(--accent);
	cursor: pointer;
	font-size: 0.85rem;
}
.library-toggle {
	margin-left: auto;
	display: flex;
	align-items: center;
	gap: 0.4rem;
	font-size: 0.85rem;
	color: var(--text-secondary);
}
.btn-primary {
	padding: 0.5rem 1.1rem;
	border: none;
	border-radius: 8px;
	background: var(--accent);
	color: #fff;
	font-weight: 500;
	cursor: pointer;
}
.btn-primary:disabled {
	opacity: 0.55;
	cursor: not-allowed;
}
```

- [ ] **Step 5: Add the buttons to the row components**

In `YouTubeVideoResult.svelte`, extend `Props` and the actions block:

```ts
interface Props {
	result: VideoResult;
	selected: boolean;
	onToggle: (id: string) => void;
	onDownload: (result: VideoResult) => void;
	busy: boolean;
	disabled: boolean;
}

let { result, selected, onToggle, onDownload, busy, disabled }: Props = $props();
```

```svelte
<div class="actions">
	{#if result.existingDownload}
		<a class="downloaded" href="/downloads/{result.existingDownload.id}">✓ Downloaded</a>
	{:else}
		<button class="btn-row" onclick={() => onDownload(result)} disabled={busy || disabled}>
			{busy ? '...' : '↓ Download'}
		</button>
	{/if}
</div>
```

```css
.btn-row {
	padding: 0.35rem 0.7rem;
	border: 1px solid var(--border);
	border-radius: 6px;
	background: var(--bg-secondary);
	color: var(--text);
	font-size: 0.82rem;
	white-space: nowrap;
	cursor: pointer;
}
.btn-row:hover:not(:disabled) {
	background: var(--bg-hover);
}
.btn-row:disabled {
	opacity: 0.55;
	cursor: not-allowed;
}
```

In `YouTubeChannelResult.svelte`, the same pattern with `onSubscribe` and label `+ Subscribe`. In `YouTubePlaylistResult.svelte`, `onImport` and label `+ Import`. Copy the `.btn-row` CSS into both — Svelte scopes styles per component, so it does not carry over.

Note the deliberate asymmetry: an already-downloaded **video** hides its button, but channels and playlists always show theirs. wytui has no cheap way to know whether you are already subscribed to a channel from within the search response, and re-importing a playlist is a valid way to pick up new entries.

- [ ] **Step 6: Verify**

Run: `npm run check && npm run test`
Expected: no new errors, all tests pass.

In the browser at `/search?tab=youtube`:

- The Profile dropdown is populated and preselects your default profile.
- Clicking Download on one row queues it, toasts, and flips the row to "✓ Downloaded" — check `/downloads` to confirm the job appears.
- Checking three rows shows the sticky bar; "Download 3" queues all three and toasts with the count.
- The Save to library toggle actually routes to the library pool — verify `storagePool` on the created download.
- Switch to Channels, click Subscribe, then check `/subscriptions` for the new entry.
- Switch to Playlists, click Import, then check `/playlists`.
- Temporarily rename your only profile away / test with no profiles to confirm the warning shows and the buttons disable rather than erroring.

- [ ] **Step 7: Commit (ask first)**

```bash
npm run format
git add src/lib/components/search/
git commit -m "feat: download, subscribe and import from YouTube search results"
```

---

## Verification Checklist

Run once the whole plan is done:

- [ ] `npm run test` — all vitest suites pass
- [ ] `npm run check` — no new svelte-check errors
- [ ] `npm run format:check` — clean
- [ ] `/search` Library tab behaves exactly as it did before Task 6
- [ ] `/api/youtube/search` appears in the OpenAPI docs at `/docs`
- [ ] Searching does not send `--cookies`: `docker exec wytui-app-1 ps aux | grep yt-dlp` during a search shows no cookie flag
- [ ] A repeat search is served from cache (visibly faster, no new yt-dlp process)
