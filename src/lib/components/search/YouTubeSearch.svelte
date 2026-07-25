<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { addToast } from '$lib/stores/toast.svelte';
	import { csrfFetch } from '$lib/utils/fetch';
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

	const TYPES = ['video', 'channel', 'playlist'] as const;
	const SORTS = ['relevance', 'date', 'views', 'rating'] as const;
	const UPLOAD_DATES = ['any', 'hour', 'today', 'week', 'month', 'year'] as const;
	const DURATIONS = ['any', 'short', 'medium', 'long'] as const;

	// Seed filter state from the URL, but ignore any value outside the known set —
	// a hand-edited `?type=foo` must not leave the <select> unmatched or send an
	// invalid filter to the API.
	function pickParam<T extends string>(key: string, valid: readonly T[], fallback: T): T {
		const raw = $page.url.searchParams.get(key);
		return raw && valid.includes(raw as T) ? (raw as T) : fallback;
	}

	// Input state is separate from the committed query: typing must not trigger
	// a search, because each one spawns a 3-7s yt-dlp process.
	let input = $state($page.url.searchParams.get('q') ?? '');
	let query = $state($page.url.searchParams.get('q') ?? '');
	let type = $state<ResultType>(pickParam('type', TYPES, 'video'));
	let sort = $state<Sort>(pickParam('sort', SORTS, 'relevance'));
	let uploadDate = $state<UploadDate>(pickParam('uploadDate', UPLOAD_DATES, 'any'));
	let duration = $state<Duration>(pickParam('duration', DURATIONS, 'any'));

	let results = $state<any[]>([]);
	let hasMore = $state(false);
	let loading = $state(false);
	let loadingMore = $state(false);
	let searched = $state(false);
	let errorMessage = $state('');
	let nextOffset = $state(0);
	let selected = $state(new Set<string>());

	interface Profile {
		id: string;
		name: string;
		isDefault?: boolean;
	}

	let profiles = $state<Profile[]>([]);
	let profilesLoaded = $state(false);
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
		} finally {
			profilesLoaded = true;
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
				throw new Error(body?.error || body?.message || 'Batch download failed');
			}
			const out = await res.json();
			// Flip each successfully-queued row to its Downloaded link, matching the
			// single-row behaviour. The batch endpoint returns the created download
			// per URL under `results`.
			const queued = new Map<string, { id: string; status: string }>();
			for (const item of out.results ?? []) {
				if (item?.success && item.download) {
					queued.set(item.url, { id: item.download.id, status: item.download.status });
				}
			}
			results = results.map((r) =>
				queued.has(r.url) ? { ...r, existingDownload: queued.get(r.url) } : r,
			);
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
				throw new Error(body?.error || body?.message || 'Failed to subscribe');
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
				throw new Error(body?.error || body?.message || 'Failed to import playlist');
			}
			addToast('success', `Importing "${result.title}"`);
		} catch (e: any) {
			addToast('error', e.message || 'Failed to import playlist');
		} finally {
			setBusy(result.id, false);
		}
	}

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
			throw new Error(body?.error || body?.message || 'Search failed');
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
			nextOffset = PAGE_SIZE;
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
			const data = await runSearch(nextOffset);
			nextOffset += PAGE_SIZE;
			// Dedupe: YouTube pagination is unstable and can return overlapping ids.
			const seen = new Set(results.map((r) => r.id));
			const newResults = data.results.filter((r: any) => !seen.has(r.id));
			results = [...results, ...newResults];
			// A page of pure duplicates (or an empty page) means we've reached the
			// end in practice — stop offering "Load more" and say so.
			if (newResults.length === 0) {
				hasMore = false;
				addToast('info', 'No more results');
			} else {
				hasMore = data.hasMore;
			}
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

	function onTypeChange() {
		// Reset video-only filters when switching away from video type.
		if (type !== 'video') {
			uploadDate = 'any';
			duration = 'any';
		}
		onFilterChange();
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
		<select id="yt-type" class="filter-select" bind:value={type} onchange={onTypeChange}>
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

	<div class="filter-group filter-group-end">
		<label class="filter-label" for="yt-profile">Profile</label>
		<select id="yt-profile" class="filter-select" bind:value={profileId}>
			{#each profiles as p (p.id)}
				<option value={p.id}>{p.name}</option>
			{/each}
		</select>
	</div>

	<div class="filter-group">
		<span class="filter-label">Library</span>
		<label class="library-check">
			<input type="checkbox" bind:checked={saveToLibrary} />
			Save copy
		</label>
	</div>
</div>

{#if profilesLoaded && profiles.length === 0}
	<p class="no-profile">
		No download profile found — <a href="/settings">create one in Settings</a> before downloading.
	</p>
{/if}

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
	</div>

	{#if hasMore}
		<div class="load-more">
			<button class="btn-more" onclick={loadMore} disabled={loadingMore}>
				{loadingMore ? 'Loading...' : 'Load more'}
			</button>
		</div>
	{/if}

	{#if selected.size > 0}
		<div class="selection-bar">
			<span class="selection-count">{selected.size} selected</span>
			<button class="btn-link" onclick={() => (selected = new Set())}>Clear</button>
			<button class="btn-primary" onclick={downloadSelected} disabled={batchBusy || !profileId}>
				{batchBusy ? 'Queuing...' : `Download ${selected.size}`}
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
		border: 1px solid var(--color-border-default);
		border-radius: 8px;
		background: var(--color-bg-secondary);
		color: var(--color-text-primary);
		font-size: 0.95rem;
	}
	.btn-search {
		padding: 0.6rem 1.25rem;
		border: none;
		border-radius: 8px;
		background: var(--color-accent-primary);
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
		color: var(--color-text-secondary);
	}
	.filter-select {
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		background: var(--color-bg-secondary);
		color: var(--color-text-primary);
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
		border: 1px solid var(--color-border-default);
		border-radius: 8px;
		background: var(--color-bg-secondary);
		color: var(--color-text-primary);
		cursor: pointer;
	}
	.btn-more:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.filter-group-end {
		margin-left: auto;
	}
	.no-profile {
		margin: -0.5rem 0 1rem;
		font-size: 0.83rem;
		color: var(--color-status-warning);
	}
	.selection-bar {
		position: sticky;
		bottom: 0;
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1rem;
		margin-top: 0.5rem;
		border-top: 1px solid var(--color-border-default);
		background: var(--color-bg-primary);
		box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.08);
	}
	.selection-count {
		font-weight: 500;
	}
	.btn-link {
		background: none;
		border: none;
		color: var(--color-accent-primary);
		cursor: pointer;
		font-size: 0.85rem;
	}
	.selection-bar .btn-primary {
		margin-left: auto;
	}
	.library-check {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0;
		font-size: 0.85rem;
		color: var(--color-text-secondary);
		white-space: nowrap;
		cursor: pointer;
	}
	.btn-primary {
		padding: 0.5rem 1.1rem;
		border: none;
		border-radius: 8px;
		background: var(--color-accent-primary);
		color: #fff;
		font-weight: 500;
		cursor: pointer;
	}
	.btn-primary:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
</style>
