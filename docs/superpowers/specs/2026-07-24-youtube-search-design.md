# YouTube Search — Design

**Date:** 2026-07-24
**Status:** Approved, ready for implementation planning

## Problem

wytui can download any YouTube URL you paste, but you have to find that URL
elsewhere first. Users should be able to search YouTube from inside wytui and
act on the results directly — download videos, subscribe to channels, import
playlists.

An existing `/search` page already exists, but it searches the _local library_
(the `Download` table via `searchService`). It is reachable only by keyboard
shortcut (`src/lib/stores/keyboard.svelte.ts:38`) and is absent from the
sidebar.

## Decisions

| Decision      | Choice                                                                  | Rationale                                                                                 |
| ------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Placement     | Tabs on `/search`: **Library** \| **YouTube**                           | One mental model for "search"; reuses the page shell                                      |
| Result types  | Videos, channels, playlists (separate tabs)                             | An "All" tab is not viable — see Constraints                                              |
| Auth          | **Always anonymous** — never pass cookies                               | Verified unnecessary; keeps the linked session unspent and lets one cache serve all users |
| Filters       | Type + sort + upload date + duration                                    | Built with a protobuf `sp=` encoder                                                       |
| Download UX   | Per-row one-click **and** multi-select batch bar                        | Covers the impulse case and the bulk case                                                 |
| Also in scope | "Already downloaded" badge, Load more, server-side cache, rate limiting | All four confirmed in scope                                                               |

## Verified Constraints

All of the following were confirmed against **yt-dlp 2026.07.04** running in the
`wytui-app-1` container, cookie-less, on 2026-07-24.

| Behaviour                                                      | Result                                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `ytsearch3:query`                                              | Works; returns `view_count`, `description`, `duration`, `channel_is_verified` |
| `results?search_query=X&sp=EgIQAg==` (channels)                | Works; `ie_key: "YoutubeTab"`, `channel_follower_count` present               |
| `results?search_query=X&sp=EgIQAw==` (playlists)               | Works; `ie_key: "YoutubeTab"`, id prefixed `PL`, url is `playlist?list=…`     |
| Unfiltered `results?search_query=X`                            | Returned **20/20 videos** — no channels or playlists interleaved              |
| `--playlist-start 21 --playlist-end 26`                        | Works; took **7.4s** (re-walks continuations each call)                       |
| `sp=CAESBggDEAEYAg==` (date sort + this week + video + >20min) | Works; all 5 results >20 min                                                  |
| `sp=CAASAhAB` (explicit `sort=0`) vs `sp=EgIQAQ==` (omitted)   | Both accepted, near-identical results                                         |

Three consequences that shape the design:

1. **No "All" tab.** An unfiltered search returns only videos, so an "All" tab
   would silently be a Videos tab. Type is a three-way choice defaulting to
   Videos.
2. **No playlist video count.** Flat output does not carry it. Showing "24
   videos" would require a second yt-dlp invocation per playlist result. The
   field is omitted rather than faked.
3. **Deep pagination gets slower.** Each page re-walks continuations
   server-side. Acceptable for a "Load more" button; the cache mitigates repeat
   views of the same page.

Additionally, channel thumbnails come back **protocol-relative**
(`//yt3.ggpht.com/…`) and must be prefixed with `https:` in the parser.

## Architecture

Three new server files, one extraction:

| File                                                | Purpose                                                                                                                                        |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/server/utils/ytdlp-json.ts`                | **Extracted** from `YouTubeService`'s private `runYtdlpJson`: spawn + timeout + settled-guard. Gains a `timeoutMs` option (default `120_000`). |
| `src/lib/server/services/youtube-search.service.ts` | `buildSearchParam`, `search`, three parsers, bounded cache                                                                                     |
| `src/routes/api/youtube/search/+server.ts`          | `GET` handler, auth-required, registered via `apiRoute()`                                                                                      |

Search lives in its own service rather than inside `youtube.service.ts` because
that file is entirely concerned with _the linked user's account_ — cookies,
subscriptions, watch-later, history, mark-watched. Search is anonymous and
shares nothing with it except the process runner, which is exactly what gets
extracted. `youtube.service.ts` is already 305 lines; the extraction leaves it
smaller and more focused, and is scoped strictly to code the new feature needs.

### Data flow

```
filters ──► buildSearchParam() ──► sp=…
                                    │
query ──────────────────────────────┤
                                    ▼
              https://www.youtube.com/results?search_query=…&sp=…
                                    │
                              cache lookup ──hit──► results
                                    │ miss
                                    ▼
        yt-dlp --flat-playlist --dump-single-json --no-warnings
               --playlist-start N --playlist-end M   (no --cookies)
                                    │
                                    ▼
                      parser (by requested type)
                                    │
                     (videos only)  ▼
        prisma.download.findMany({ videoId: { in: [...] } })
                                    │
                                    ▼
                    { results, hasMore }  ──► cache write
```

### Service interface

```ts
interface SearchOptions {
  query: string;
  type: SearchResultType;      // default 'video'
  sort: 'relevance' | 'date' | 'views' | 'rating';
  uploadDate: 'any' | 'hour' | 'today' | 'week' | 'month' | 'year';
  duration: 'any' | 'short' | 'medium' | 'long';
  offset: number;
  limit: number;
}

search(opts: SearchOptions): Promise<{ results: SearchResult[]; hasMore: boolean }>
```

`existingDownload` is **not** attached by the service — it is per-user, and the
cache is shared across users. The route handler attaches it after the service
returns, so cached entries stay user-neutral.

**yt-dlp playlist indices are 1-based and inclusive.** The mapping is
`--playlist-start (offset + 1)` and `--playlist-end (offset + limit)`. So
`offset=0, limit=20` → `--playlist-start 1 --playlist-end 20`; `offset=20` →
`--playlist-start 21 --playlist-end 40`.

### The `sp` parameter builder

`buildSearchParam(opts)` is a pure function returning a base64 string. It
encodes a small protobuf message with a ~30-line varint encoder:

```
field 1 (varint)   sort:       0 relevance | 1 date | 2 views | 3 rating
field 2 (message)  filters:
    field 1 (varint)  uploadDate: 1 hour | 2 today | 3 week | 4 month | 5 year
    field 2 (varint)  type:       1 video | 2 channel | 3 playlist
    field 3 (varint)  duration:   1 short (<4m) | 2 long (>20m) | 3 medium (4-20m)
```

Fields at their default value (`sort = relevance`, `uploadDate = any`,
`duration = any`) are **omitted**, per standard protobuf encoding. `type` is
always emitted. Both encodings of the relevance case were verified to work; the
omitting form is chosen for simplicity.

Note the duration ordinals are not in size order: `2` is _long_ and `3` is
_medium_. This is YouTube's numbering, not a typo.

### Cache

Keyed by `type|sort|uploadDate|duration|offset|query`, TTL **15 minutes**.

Unlike the existing playlist cache in `youtube.service.ts` — which is keyed by
`userId` and therefore naturally bounded — the search query space is unbounded.
This cache must have a **hard entry cap of 200 entries, evicting in insertion
order** (a JS `Map` preserves insertion order, so evicting `keys().next()` is
sufficient — no LRU bookkeeping needed) to avoid unbounded memory growth.
Because search is anonymous and `existingDownload` is attached downstream, one
cache serves every user.

## Result Types

```ts
type SearchResultType = 'video' | 'channel' | 'playlist';

interface VideoResult {
	type: 'video';
	id: string; // 11-char video id
	title: string;
	url: string;
	uploader?: string;
	channelId?: string;
	channelUrl?: string;
	thumbnail?: string;
	duration?: number; // seconds
	viewCount?: number;
	verified?: boolean; // channel_is_verified
	description?: string; // truncated snippet from YouTube
	existingDownload: { id: string; status: string } | null;
}

interface ChannelResult {
	type: 'channel';
	id: string; // UC… channel id
	title: string;
	url: string;
	thumbnail?: string; // https: prefix applied
	subscriberCount?: number; // channel_follower_count
	description?: string;
}

interface PlaylistResult {
	type: 'playlist';
	id: string; // PL… playlist id
	title: string;
	url: string;
	thumbnail?: string;
	uploader?: string;
	channelId?: string;
}
```

Entries are discriminated by `ie_key` plus URL shape: `Youtube` → video;
`YoutubeTab` with `/channel/` → channel; `YoutubeTab` with `/playlist?list=` →
playlist. Entries that match none are skipped.

## API

```
GET /api/youtube/search
      ?q=<string>                                       (required)
      &type=video|channel|playlist                      (default video)
      &sort=relevance|date|views|rating                 (default relevance)
      &uploadDate=any|hour|today|week|month|year        (default any)
      &duration=any|short|medium|long                   (default any)
      &offset=<int>                                     (default 0)
      &limit=<int>                                      (default 20, max 50)

200 → { results: SearchResult[], hasMore: boolean }
```

Auth required via `requireAuth(locals)`. Registered through `apiRoute()` so it
appears in the OpenAPI docs alongside the rest of the API.

For `type=video`, `existingDownload` is populated by a **single** batched query
per page:

```ts
prisma.download.findMany({
	where: {
		userId,
		videoId: { in: ids },
		status: { notIn: ['DELETED'] },
	},
	select: { id: true, videoId: true, status: true },
});
```

`videoId` is already indexed. Channel and playlist results carry no
`existingDownload`.

`hasMore` is computed from the **raw entry count** yt-dlp returned, not from
`results.length` — parsers skip unrecognised entries, so a page that yielded 18
parsed results from 20 raw entries still has more available. YouTube gives no
total count, so `rawEntryCount === limit` is the only signal.

### Rate limiting

Add to `RATE_LIMITS` in `src/lib/server/rate-limit.ts`:

```ts
youtubeSearch: { windowMs: 60 * 1000, maxRequests: 120 },
```

and an `else if` branch for `/api/youtube/search` in the existing chain in
`src/hooks.server.ts` (~line 33).

120/min fits the existing buckets (`downloads` 200, `settings` 100, `general` 500) rather than sitting far below them. It matters that **cache hits still
count against the budget** — `handle` runs before the route handler and cannot
know whether a request will reach yt-dlp — so the limit has to accommodate
filter-fiddling and tab-switching, which are mostly cache hits. The purpose here
is to stop a runaway client, not to meter normal use.

## UI

### Page structure

`src/routes/search/+page.svelte` is 590 lines today. Adding a second search mode
inline would push it past 1200. Instead the page becomes a thin shell (tab
switcher + shared header), with bodies extracted to:

- `src/lib/components/search/LibrarySearch.svelte` — existing code, moved as-is
- `src/lib/components/search/YouTubeSearch.svelte` — new
- `src/lib/components/search/YouTubeVideoResult.svelte`
- `src/lib/components/search/YouTubeChannelResult.svelte`
- `src/lib/components/search/YouTubePlaylistResult.svelte`

State lives in the URL (`?tab=youtube&q=…&type=…&sort=…&uploadDate=…&duration=…`)
so searches are linkable and survive reload.

```
┌───────────────────────────────────────────────────────────┐
│ Search                                                    │
│ ┌─────────┬─────────┐                                     │
│ │ Library │ YouTube │                                     │
│ └─────────┴─────────┘                                     │
│ 🔍 [ sourdough                          ]  [Search]       │
│                                                           │
│ Type[Videos▾] Sort[Relevance▾] Uploaded[Any▾]             │
│ Length[Any▾]              Profile[Best▾]                  │
├───────────────────────────────────────────────────────────┤
│ ☐ ┌────┐ A Very Boring Tutorial on Sourdough              │
│   │thmb│ Serena Neel ✓ · 36:03 · 1.2M views  [↓ Download] │
│   └────┘                                                  │
│ ☑ ┌────┐ Amazing Sourdough Bread Recipe                   │
│   │thmb│ Preppy Kitchen ✓ · 16:50 · 3.5M     [↓ Download] │
│   └────┘                                                  │
│   ┌────┐ Easy Sourdough for Beginners                     │
│   │thmb│ Bread Guy · 21:12    ✓ Downloaded → view         │
│   └────┘                                                  │
│                    [ Load more ]                          │
╞═══════════════════════════════════════════════════════════╡
│ 1 selected   ☐ Save to library          [Download 1]      │
└───────────────────────────────────────────────────────────┘
```

### Interaction rules

**Explicit submit, not debounce.** The Library tab debounces at 300ms because it
queries Postgres. Each YouTube search spawns a yt-dlp process taking 3–7s, so
the YouTube tab searches on Enter or button click, and on filter change when a
query is already present — never per keystroke.

**One page-level profile picker.** Per-row download, batch download, Subscribe
and Import all need a `profileId`. A single `<select>` in the filter row serves
all four actions rather than four separate pickers. It is populated from
`GET /api/profiles` (as `ImportSubscriptionsModal` does) on first switch to the
YouTube tab, and defaults to the profile flagged `isDefault`.

**Tab switching does not auto-search.** `q` is shared across both tabs in the
URL, so switching from Library to YouTube carries the text into the input but
leaves it unsubmitted. This avoids spawning a yt-dlp process as a side effect of
a tab click. Switching back to Library, which is cheap, does search immediately
per its existing debounce behaviour.

**Selection.** Checking one or more video rows reveals a sticky bottom bar with
the count, a Save-to-library toggle, and `[Download N]`. Selection is cleared on
a new search or filter change, but **preserved across Load more**. Checkboxes
appear on video rows only.

**Already-downloaded rows** keep their checkbox — re-downloading is legitimate,
e.g. at a different quality — but the per-row `[↓ Download]` button is replaced
by a badge linking to `/downloads/{id}`.

**Load more.** Shown when `hasMore`; fetches `offset += limit` and appends.

### Actions → existing endpoints

| Action                  | Endpoint                     | Payload                                     |
| ----------------------- | ---------------------------- | ------------------------------------------- |
| Per-row Download        | `POST /api/downloads/quick`  | `{ url, profileId, saveToLibrary }`         |
| Batch Download          | `POST /api/downloads/batch`  | `{ urls, profileId, saveToLibrary }`        |
| Channel `[+ Subscribe]` | `POST /api/subscriptions`    | `{ url, name, profileId, type: 'CHANNEL' }` |
| Playlist `[+ Import]`   | `POST /api/playlists/import` | `{ url, profileId, saveToLibrary }`         |

All four already exist and accept exactly what a search result provides. All
mutations go through `csrfFetch` with `addToast` feedback, following
`ImportSubscriptionsModal.svelte`.

### Shared components

`Skeleton.svelte` for loading rows, `EmptyState.svelte` for no results,
`addToast` for feedback, `formatDuration` from `$lib/utils/format`.

### Sidebar

Add `{ label: 'Search', href: '/search', icon: 'search' }` to `libraryItems` in
`src/lib/components/ui/Sidebar.svelte`. The `search` icon case already exists at
line 191 but nothing currently renders it — the page is keyboard-shortcut-only
today.

## Error Handling

| Condition                                           | Behaviour                                                                                                                                                  |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| yt-dlp non-zero exit or timeout                     | **502** with a generic message ("YouTube search is unavailable right now"). stderr logged server-side, never returned — it can contain URLs and internals. |
| Search timeout                                      | **45s**, overriding the runner's 120s default. This is an interactive path.                                                                                |
| Malformed JSON                                      | Parser returns `[]`, matching the existing `parseFlatEntries` behaviour.                                                                                   |
| Zero results                                        | `{ results: [], hasMore: false }` → `EmptyState`.                                                                                                          |
| `q` empty after trim, or >200 chars                 | **400**.                                                                                                                                                   |
| Invalid `type`/`sort`/`uploadDate`/`duration` value | **400** — enum-validated, never passed through to the encoder.                                                                                             |
| Batch partial failure                               | Toast reports `succeeded`/`failed`; the endpoint already returns both.                                                                                     |
| Rate limit                                          | **429**; toast shows the retry-after seconds.                                                                                                              |
| No download profile exists                          | Action buttons disabled with a hint linking to profile creation, rather than a failed request.                                                             |

**No SSRF surface.** The target URL is constructed by us from a fixed origin
with the query URL-encoded into `search_query`; it is never user-supplied. yt-dlp
is invoked via `spawn` with an argument array, so no shell is involved. The
`isYouTubeUrl` guard is therefore not needed on this path. URLs handed onward to
`/api/downloads/*` come from YouTube's own response, the same as the existing
subscription and playlist-import paths.

## Testing

`src/lib/server/services/youtube-search.service.test.ts` (vitest, matching the
sibling `*.service.test.ts` files):

- **`buildSearchParam`** — table-driven across combinations, including the
  live-verified cases:
  - `{sort:'date', uploadDate:'week', type:'video', duration:'long'}` → `CAESBggDEAEYAg==`
  - `{type:'video'}` (all defaults) → `EgIQAQ==`
  - `{type:'channel'}` → `EgIQAg==`
  - `{type:'playlist'}` → `EgIQAw==`
- **Parsers** — against fixtures captured from the three real responses
  documented in Verified Constraints. Asserts field mapping, the
  protocol-relative thumbnail fix, tolerance of missing/null fields, correct
  discrimination by `ie_key`, skipping of unrecognised entries, and malformed
  JSON → `[]`.
- **`hasMore`** — derived from raw entry count, so a page with skipped entries
  (18 parsed from 20 raw at `limit=20`) still reports `hasMore: true`.
- **Offset mapping** — `offset=0, limit=20` produces `--playlist-start 1
--playlist-end 20`; `offset=20` produces `21`/`40`.
- **Cache** — hit, miss, TTL expiry, and eviction at the 200-entry cap.

No live-network tests. `tests/integration/` currently holds only
`share-api.test.ts` and is excluded from the vitest run; it is left untouched.

## Out of Scope

- Search suggestions / autocomplete
- Search history
- Cookie-authenticated (personalised) search — explicitly rejected
- Playlist video counts in results — not obtainable without a per-playlist fetch
- An "All" result type — YouTube does not interleave types in flat output
