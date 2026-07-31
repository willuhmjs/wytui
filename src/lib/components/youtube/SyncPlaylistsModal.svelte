<script lang="ts">
	import { addToast } from '$lib/stores/toast.svelte';
	import { csrfFetch } from '$lib/utils/fetch';
	import { trapFocus, uniqueId } from '$lib/utils/a11y';
	import { formatDurationLong } from '$lib/utils/format';
	import { onSSEEvent } from '$lib/stores/sse.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import RefreshIcon from '$lib/components/icons/RefreshIcon.svelte';
	import { onDestroy } from 'svelte';

	interface YtPlaylist {
		id: string;
		title: string;
		url: string;
		thumbnail?: string;
	}

	interface PlaylistStat {
		status: 'loading' | 'done' | 'error';
		count?: number;
		durationSeconds?: number;
	}

	interface Props {
		open: boolean;
		onSynced?: () => void;
	}

	let { open = $bindable(), onSynced }: Props = $props();

	let playlists = $state<YtPlaylist[]>([]);
	let stats = $state<Record<string, PlaylistStat>>({});
	let loading = $state(false);
	let refreshing = $state(false);
	let syncing = $state(false);
	let syncProgress = $state<{ current: number; total: number; lastTitle: string } | null>(null);
	let selected = $state(new Set<string>());
	let filter = $state('');

	// Per-open generation guard: bump on each load so in-flight stat responses
	// from a previous open are ignored, and abort their requests outright.
	let statsRun = 0;
	let statsAbort: AbortController | null = null;

	// Guard for the staggered select/deselect wave — bumping it cancels the
	// pending timeouts of any earlier wave.
	let waveRun = 0;

	const filtered = $derived(
		filter.trim()
			? playlists.filter((p) => p.title.toLowerCase().includes(filter.trim().toLowerCase()))
			: playlists,
	);

	const titleId = uniqueId('sync-playlists-title');
	const bodyId = uniqueId('sync-playlists-body');

	// Listen for background sync progress events from the server.
	const unsubProgress = onSSEEvent('playlist:sync:progress', (data) => {
		if (!syncing) return;
		syncProgress = { current: data.current, total: data.total, lastTitle: data.title };
		if (data.rateLimited) {
			addToast('info', `Rate limited on "${data.title}" — backing off, will continue`);
		}
	});
	const unsubComplete = onSSEEvent('playlist:sync:complete', (data) => {
		if (!syncing) return;
		syncing = false;
		syncProgress = null;
		if (data.needsRelink) {
			addToast('error', 'YouTube session expired — re-link via the extension');
			return;
		}
		addToast('success', `Synced ${data.totalAdded ?? 0} video(s) across ${data.total} playlist(s)`);
		onSynced?.();
		close();
	});

	onDestroy(() => {
		unsubProgress();
		unsubComplete();
	});

	let dialogEl: HTMLDivElement | null = $state(null);
	let gridEl: HTMLDivElement | null = $state(null);

	$effect(() => {
		if (open && dialogEl) {
			const release = trapFocus(dialogEl);
			return release;
		}
	});

	$effect(() => {
		if (open) {
			void loadData();
		}
	});

	async function loadData(refresh = false) {
		// On refresh keep the existing cards visible (no skeleton) so the grid
		// doesn't flash empty; on first open show the loading skeleton.
		if (refresh) refreshing = true;
		else loading = true;
		filter = '';
		selected = new Set();
		stats = {};
		waveRun++;
		statsAbort?.abort();
		const runId = ++statsRun;
		try {
			const res = await fetch(`/api/youtube/playlists${refresh ? '?refresh=1' : ''}`);
			if (!res.ok) {
				addToast('error', 'Failed to load playlists');
				if (!refresh) close();
				return;
			}
			const data = await res.json();
			if (data.needsRelink) {
				addToast('error', 'YouTube session expired — re-link via the extension');
				if (!refresh) close();
				return;
			}
			playlists = data.playlists || [];
			// Select all by default.
			selected = new Set(playlists.map((p) => p.id));
			// Kick off progressive stat scraping in the background while the user picks.
			void loadStats(runId, refresh);
		} catch {
			addToast('error', 'Failed to load playlists');
			if (!refresh) close();
		} finally {
			loading = false;
			refreshing = false;
		}
	}

	// Scrape each playlist's stats (video count + total duration) with a small
	// concurrency pool so we don't spawn one yt-dlp process per playlist at once.
	async function loadStats(runId: number, refresh = false) {
		const controller = new AbortController();
		statsAbort = controller;
		const initial: Record<string, PlaylistStat> = {};
		for (const p of playlists) initial[p.id] = { status: 'loading' };
		stats = initial;

		const queue = [...playlists];
		const CONCURRENCY = 3;

		const worker = async () => {
			for (;;) {
				const p = queue.shift();
				if (!p) return;
				await fetchStat(p, runId, controller.signal, refresh);
			}
		};

		await Promise.all(Array.from({ length: CONCURRENCY }, worker));
	}

	async function fetchStat(p: YtPlaylist, runId: number, signal: AbortSignal, refresh = false) {
		const set = (stat: PlaylistStat) => {
			if (runId !== statsRun) return;
			stats = { ...stats, [p.id]: stat };
		};
		try {
			const res = await csrfFetch('/api/youtube/playlists/stats', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: p.url, refresh }),
				signal,
			});
			if (runId !== statsRun) return;
			if (res.status === 429) {
				// Rate limited: mark this card as unavailable and wait before the
				// concurrency pool moves on to the next request.
				set({ status: 'error' });
				await new Promise((r) => setTimeout(r, 5000));
				return;
			}
			if (!res.ok) {
				set({ status: 'error' });
				return;
			}
			const data = await res.json();
			if (data.needsRelink) {
				set({ status: 'error' });
				return;
			}
			set({ status: 'done', count: data.count, durationSeconds: data.durationSeconds });
		} catch {
			set({ status: 'error' });
		}
	}

	function toggle(id: string) {
		// Reassign a fresh Set — mutating in place and reassigning the same
		// reference doesn't register as a change in Svelte 5.
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected = next;
	}

	// Number of columns the grid is currently rendering, read from the resolved
	// grid-template-columns so the wave delay can follow the real layout.
	function columnCount(): number {
		if (!gridEl) return 1;
		const cols = getComputedStyle(gridEl).gridTemplateColumns.split(' ').filter(Boolean).length;
		return Math.max(1, cols);
	}

	// Apply select/deselect across the visible playlists as a diagonal wave from
	// the top-left. Each card's change is delayed by (row + col) so it sweeps out
	// from the corner; the card's border/check transition does the rest.
	function runWave(select: boolean) {
		const runId = ++waveRun;
		const items = filtered;
		const reduced =
			typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

		const apply = (id: string) => {
			const next = new Set(selected);
			if (select) next.add(id);
			else next.delete(id);
			selected = next;
		};

		if (reduced) {
			for (const p of items) apply(p.id);
			return;
		}

		const cols = columnCount();
		const step = 35;
		items.forEach((p, i) => {
			const delay = (Math.floor(i / cols) + (i % cols)) * step;
			setTimeout(() => {
				if (runId !== waveRun) return;
				apply(p.id);
			}, delay);
		});
	}

	function refresh() {
		if (refreshing || loading) return;
		void loadData(true);
	}

	function selectAll() {
		runWave(true);
	}

	function deselectAll() {
		runWave(false);
	}

	async function sync() {
		if (selected.size === 0) {
			addToast('error', 'Select at least one playlist');
			return;
		}
		syncing = true;
		syncProgress = null;
		try {
			const chosen = playlists.filter((p) => selected.has(p.id));
			const res = await csrfFetch('/api/youtube/playlists/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					playlists: chosen.map((p) => ({ title: p.title, url: p.url })),
				}),
			});
			if (!res.ok) {
				syncing = false;
				addToast('error', 'Failed to start playlist sync');
				return;
			}
			const data = await res.json();
			// 202: sync started in background — SSE events will drive the rest.
			// If needsRelink comes back synchronously (no cookie), handle it here.
			if (data.needsRelink) {
				syncing = false;
				addToast('error', 'YouTube session expired — re-link via the extension');
				return;
			}
			// Initial playlists created; show progress until SSE complete arrives.
			syncProgress = { current: 0, total: chosen.length, lastTitle: '' };
			addToast('info', `Syncing ${chosen.length} playlist(s) in background…`);
		} catch {
			syncing = false;
			addToast('error', 'Failed to start playlist sync');
		}
	}

	function close() {
		statsRun++;
		waveRun++;
		statsAbort?.abort();
		statsAbort = null;
		// Don't wait for background sync to finish before allowing close.
		// SSE handlers will still fire and show toasts even with modal closed.
		syncing = false;
		syncProgress = null;
		open = false;
	}

	function handleOverlayClick(e: MouseEvent) {
		if (e.target === e.currentTarget) close();
	}

	function handleDialogKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			close();
		}
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={handleOverlayClick}>
		<div
			bind:this={dialogEl}
			class="modal"
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
			aria-describedby={bodyId}
			tabindex="-1"
			onkeydown={handleDialogKeydown}
		>
			<div class="modal-header">
				<div class="header-text">
					<h3 id={titleId}>Sync YouTube Playlists</h3>
					<p class="hint">
						Selected playlists are added to your library. Videos are recorded now and downloaded
						later from each playlist.
					</p>
				</div>
				<button class="btn-icon-close" onclick={close} aria-label="Close">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<line x1="18" y1="6" x2="6" y2="18" />
						<line x1="6" y1="6" x2="18" y2="18" />
					</svg>
				</button>
			</div>
			<div class="modal-body" id={bodyId}>
				{#if loading}
					<Skeleton count={6} variant="list" />
				{:else}
					{#if playlists.length > 0}
						<div class="selection-bar">
							<span class="selection-count">{selected.size} of {playlists.length} selected</span>
							<div class="selection-actions">
								<button class="btn-text" onclick={selectAll} type="button">Select All</button>
								<button class="btn-text" onclick={deselectAll} type="button">Deselect All</button>
								<button
									class="btn-refresh"
									onclick={refresh}
									type="button"
									disabled={refreshing}
									aria-label="Refresh playlists"
									title="Refresh (clears cache)"
								>
									<RefreshIcon width={14} height={14} class={refreshing ? 'spin-icon' : ''} />
									<span>Refresh</span>
								</button>
							</div>
						</div>

						{#if playlists.length > 8}
							<div class="playlist-filter">
								<input
									type="text"
									bind:value={filter}
									placeholder="Filter playlists…"
									aria-label="Filter playlists"
								/>
							</div>
						{/if}

						<div class="playlist-grid" bind:this={gridEl}>
							{#each filtered as playlist (playlist.id)}
								{@const stat = stats[playlist.id]}
								<button
									type="button"
									class="playlist-card"
									class:selected={selected.has(playlist.id)}
									onclick={() => toggle(playlist.id)}
									aria-pressed={selected.has(playlist.id)}
								>
									<div class="card-thumb">
										{#if playlist.thumbnail}
											<img src={playlist.thumbnail} alt="" loading="lazy" />
										{:else}
											<span class="thumb-placeholder" aria-hidden="true">
												<svg
													width="28"
													height="28"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-linejoin="round"
												>
													<line x1="8" y1="6" x2="21" y2="6" />
													<line x1="8" y1="12" x2="21" y2="12" />
													<line x1="8" y1="18" x2="15" y2="18" />
													<polyline points="3 6 4 7 6 5" />
													<polyline points="3 12 4 13 6 11" />
												</svg>
											</span>
										{/if}
										<span class="card-check" aria-hidden="true">
											{#if selected.has(playlist.id)}
												<svg
													width="14"
													height="14"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="3"
													stroke-linecap="round"
													stroke-linejoin="round"
												>
													<polyline points="20 6 9 17 4 12" />
												</svg>
											{/if}
										</span>
									</div>
									<div class="card-body">
										<span class="card-title">{playlist.title}</span>
										<div class="card-stats">
											{#if !stat || stat.status === 'loading'}
												<span class="stat stat-loading">
													<span class="spinner" aria-hidden="true"></span>
													videos
												</span>
												<span class="stat stat-loading">
													<span class="spinner" aria-hidden="true"></span>
													length
												</span>
											{:else if stat.status === 'error'}
												<span class="stat stat-muted">stats unavailable</span>
											{:else}
												<span class="stat">{stat.count} video{stat.count === 1 ? '' : 's'}</span>
												{#if stat.durationSeconds && stat.durationSeconds > 0}
													<span class="stat">{formatDurationLong(stat.durationSeconds)}</span>
												{/if}
											{/if}
										</div>
									</div>
								</button>
							{:else}
								<p class="no-match text-muted">No playlists match “{filter}”.</p>
							{/each}
						</div>
					{:else}
						<p class="text-muted">No playlists found.</p>
					{/if}
				{/if}
			</div>
			<div class="modal-footer">
				<button class="btn btn-secondary" onclick={close} disabled={syncing}>Cancel</button>
				<button
					class="btn btn-primary"
					onclick={sync}
					disabled={loading || syncing || selected.size === 0}
				>
					{#if syncing && syncProgress}
						Syncing {syncProgress.current}/{syncProgress.total}…
					{:else if syncing}
						Starting…
					{:else}
						Sync {selected.size > 0 ? `(${selected.size})` : ''}
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: var(--color-overlay-medium);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: var(--z-modal);
		animation: fadeIn var(--transition-fast);
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.modal {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		max-width: 700px;
		width: 90%;
		max-height: 90vh;
		display: flex;
		flex-direction: column;
		box-shadow: var(--shadow-xl);
		animation: slideUp 200ms ease;
		outline: none;
	}

	.modal:focus-visible {
		box-shadow:
			var(--shadow-xl),
			0 0 0 3px var(--color-focus-ring);
	}

	@keyframes slideUp {
		from {
			transform: translateY(20px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	.modal-header {
		padding: var(--spacing-lg);
		border-bottom: 1px solid var(--color-border-default);
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--spacing-md);
	}

	.header-text {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		min-width: 0;
	}

	.modal-header h3 {
		margin: 0;
		font-size: var(--font-size-xl);
		color: var(--color-text-primary);
	}

	.btn-icon-close {
		background: none;
		border: none;
		padding: var(--spacing-xs);
		cursor: pointer;
		color: var(--color-text-secondary);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
		transition: background var(--transition-fast);
	}

	.btn-icon-close:hover {
		background: var(--color-overlay-white-10);
		color: var(--color-text-primary);
	}

	.modal-body {
		padding: var(--spacing-lg);
		overflow-y: auto;
		flex: 1;
	}

	.hint {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.selection-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-sm);
		margin-bottom: var(--spacing-sm);
	}

	.selection-count {
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	.selection-actions {
		display: flex;
		gap: var(--spacing-sm);
	}

	.btn-text {
		background: none;
		border: none;
		padding: var(--spacing-xs) var(--spacing-sm);
		cursor: pointer;
		color: var(--color-accent-primary);
		font-size: 0.875rem;
		border-radius: var(--radius-sm);
		transition: background var(--transition-fast);
	}

	.btn-text:hover {
		background: var(--color-overlay-white-10);
	}

	.btn-refresh {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		background: none;
		border: none;
		padding: var(--spacing-xs) var(--spacing-sm);
		cursor: pointer;
		color: var(--color-text-secondary);
		font-size: 0.875rem;
		border-radius: var(--radius-sm);
		transition:
			background var(--transition-fast),
			color var(--transition-fast);
	}

	.btn-refresh:hover:not(:disabled) {
		background: var(--color-overlay-white-10);
		color: var(--color-text-primary);
	}

	.btn-refresh:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.btn-refresh :global(.spin-icon) {
		animation: spin 0.8s linear infinite;
	}

	.playlist-filter {
		margin-bottom: var(--spacing-sm);
	}

	.playlist-filter input {
		width: 100%;
		padding: var(--spacing-xs) var(--spacing-sm);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-sm);
		color: var(--color-text-primary);
		font-size: 0.875rem;
	}

	.no-match {
		padding: var(--spacing-md);
		text-align: center;
		margin: 0;
		grid-column: 1 / -1;
	}

	.playlist-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: var(--spacing-sm);
		padding-top: var(--spacing-xs);
	}

	.playlist-card {
		display: flex;
		flex-direction: column;
		text-align: left;
		padding: 0;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		overflow: hidden;
		cursor: pointer;
		transition:
			border-color var(--transition-fast),
			box-shadow var(--transition-fast),
			transform var(--transition-fast);
	}

	.playlist-card:hover {
		border-color: var(--color-border-translucent-hover);
		transform: translateY(-2px);
	}

	.playlist-card.selected {
		border-color: var(--color-accent-primary);
		box-shadow: 0 0 0 1px var(--color-accent-primary);
	}

	.playlist-card:focus-visible {
		outline: none;
		box-shadow: 0 0 0 3px var(--color-focus-ring);
	}

	.card-thumb {
		position: relative;
		width: 100%;
		aspect-ratio: 16 / 9;
		background: var(--color-bg-tertiary);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.card-thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.thumb-placeholder {
		color: var(--color-text-tertiary);
		display: flex;
	}

	.card-check {
		position: absolute;
		top: var(--spacing-xs);
		right: var(--spacing-xs);
		width: 22px;
		height: 22px;
		border-radius: var(--radius-full, 999px);
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-overlay-medium);
		border: 1.5px solid var(--color-text-inverse, #fff);
		color: var(--color-text-inverse, #fff);
		transition:
			background var(--transition-fast),
			border-color var(--transition-fast);
	}

	.playlist-card.selected .card-check {
		background: var(--color-accent-primary);
		border-color: var(--color-accent-primary);
	}

	.card-body {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		padding: var(--spacing-sm);
		min-width: 0;
	}

	.card-title {
		font-weight: 500;
		color: var(--color-text-primary);
		font-size: 0.8125rem;
		line-height: 1.3;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.card-stats {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-xs);
	}

	.stat {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 0.625rem;
		font-weight: 500;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		background: var(--color-overlay-white-06);
		color: var(--color-text-secondary);
		font-family: var(--font-family-mono);
		letter-spacing: 0.02em;
	}

	.stat-muted {
		color: var(--color-text-tertiary);
		font-style: italic;
		font-family: inherit;
	}

	.stat-loading {
		color: var(--color-text-tertiary);
	}

	.spinner {
		width: 10px;
		height: 10px;
		border: 1.5px solid var(--color-border-translucent-hover);
		border-top-color: var(--color-accent-primary);
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: none;
		}
	}

	.text-muted {
		color: var(--color-text-secondary);
	}

	.modal-footer {
		padding: var(--spacing-lg);
		border-top: 1px solid var(--color-border-default);
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-md);
	}

	@media (max-width: 768px) {
		.modal {
			width: 95%;
		}

		.modal-header,
		.modal-body,
		.modal-footer {
			padding: var(--spacing-md);
		}

		.modal-footer {
			flex-direction: column-reverse;
		}

		.modal-footer button {
			width: 100%;
		}
	}
</style>
