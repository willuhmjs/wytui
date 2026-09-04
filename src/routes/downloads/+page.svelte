<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { csrfFetch, safeFetchJson, isFetchError, type FetchError } from '$lib/utils/fetch';
	import DownloadForm from '$lib/components/download/DownloadForm.svelte';
	import DownloadCard from '$lib/components/download/DownloadCard.svelte';
	import DownloadListRow from '$lib/components/download/DownloadListRow.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ErrorMessage from '$lib/components/ui/ErrorMessage.svelte';
	import ViewToggle from '$lib/components/ui/ViewToggle.svelte';
	import FilterDropdown from '$lib/components/ui/FilterDropdown.svelte';
	import { getSSEState, onSSEEvent } from '$lib/stores/sse.svelte';
	import { showConfirm } from '$lib/stores/modal.svelte';
	import { addToast, addStickyToast, updateToast, resolveToast } from '$lib/stores/toast.svelte';
	import { formatBytes, formatTimestamp } from '$lib/utils/format';
	import CheckSquareIcon from '$lib/components/icons/CheckSquareIcon.svelte';
	import FolderDownIcon from '$lib/components/icons/FolderDownIcon.svelte';
	import TrashIcon from '$lib/components/icons/TrashIcon.svelte';
	import ListPlusIcon from '$lib/components/icons/ListPlusIcon.svelte';

	let sseState = getSSEState();

	const DOWNLOADS_PAGE_SIZE = 50;
	let completedDownloads = $state<any[]>([]);
	let completedLoading = $state(false);
	let completedOffset = $state(0);
	let hasMoreDownloads = $state(false);
	let loadingMoreDownloads = $state(false);
	let completedFilter = $state<'all' | 'cache' | 'library'>('all');
	let watchStateFilter = $state<'all' | 'watched' | 'unwatched' | 'in_progress'>('all');
	let channelFilter = $state<string>('all');
	let sortOption = $state<
		'newest' | 'oldest' | 'largest' | 'smallest' | 'longest' | 'shortest' | 'uploader'
	>('newest');
	let resolutionFilter = $state<string>('all');
	let dateFrom = $state('');
	let dateTo = $state('');
	let searchQuery = $state('');
	let searchResults = $state<any[]>([]);
	let searchTotal = $state(0);
	let searchOffset = $state(0);
	let hasMoreSearch = $state(false);
	let loadingMoreSearch = $state(false);
	let searchLoading = $state(false);
	let searchError = $state<FetchError | null>(null);
	let subtitleMatches = $state<any[]>([]);
	let subtitleTotal = $state(0);
	let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	let viewMode = $state<'grid' | 'list'>('grid');
	let selectionMode = $state(false);
	let selectedIds = $state<Set<string>>(new Set());
	let bulkActing = $state(false);
	let bulkSuccess = $state(false);
	let bulkSuccessTimer: ReturnType<typeof setTimeout> | null = null;

	function flashBulkSuccess() {
		bulkSuccess = true;
		if (bulkSuccessTimer) clearTimeout(bulkSuccessTimer);
		bulkSuccessTimer = setTimeout(() => {
			bulkSuccess = false;
		}, 900);
	}

	let jellyfinUrl = $state('');
	let libraryConfigured = $state(false);
	let cacheUsage = $state<{
		usedBytes: string;
		quotaBytes: string;
		percentage: number;
	} | null>(null);
	let libraryUsage = $state<{
		video: { usedBytes: string; count: number } | null;
		music: { usedBytes: string; count: number } | null;
	} | null>(null);
	let clearingCache = $state(false);
	let failedDownloads = $state<any[]>([]);
	let failedLoading = $state(false);
	let diskInfo = $state<{
		totalBytes: string;
		availableBytes: string;
	} | null>(null);

	let diskUsedBytes = $derived(
		diskInfo ? String(Number(diskInfo.totalBytes) - Number(diskInfo.availableBytes)) : '0',
	);
	let diskPercent = $derived(
		diskInfo && Number(diskInfo.totalBytes) > 0
			? ((Number(diskInfo.totalBytes) - Number(diskInfo.availableBytes)) /
					Number(diskInfo.totalBytes)) *
					100
			: 0,
	);

	let poolFilteredDownloads = $derived(
		completedFilter === 'all'
			? completedDownloads
			: completedDownloads.filter((d) => d.storagePool === completedFilter),
	);

	let availableChannels = $derived(
		[...new Set(poolFilteredDownloads.map((d) => d.uploader).filter(Boolean))].sort() as string[],
	);

	$effect(() => {
		if (
			!completedLoading &&
			channelFilter !== 'all' &&
			completedDownloads.length > 0 &&
			!availableChannels.includes(channelFilter)
		) {
			channelFilter = 'all';
		}
	});

	// Reload downloads when watch state filter changes
	let prevWatchState = $state(watchStateFilter);
	$effect(() => {
		const ws = watchStateFilter;
		if (ws !== prevWatchState) {
			prevWatchState = ws;
			loadCompletedDownloads();
		}
	});

	let filtersInitialized = false;

	// Reload when resolution or date filters change
	$effect(() => {
		// Track these values to trigger reload
		const _r = resolutionFilter;
		const _df = dateFrom;
		const _dt = dateTo;
		if (filtersInitialized) {
			loadCompletedDownloads();
		}
	});

	function buildSearchParams(
		q: string,
		sp: string,
		uf: string,
		ws: string,
		rf: string,
		df: string,
		dt: string,
		offset: number,
	) {
		const params = new URLSearchParams({
			q,
			limit: String(DOWNLOADS_PAGE_SIZE),
			offset: String(offset),
		});
		if (sp !== 'all') params.set('storagePool', sp);
		if (uf !== 'all') params.set('uploader', uf);
		if (ws !== 'all') params.set('watchState', ws);
		const heightRange = getHeightRange(rf);
		if (heightRange.min) params.set('minHeight', String(heightRange.min));
		if (heightRange.max) params.set('maxHeight', String(heightRange.max));
		if (df) params.set('dateFrom', df);
		if (dt) params.set('dateTo', dt);
		return params;
	}

	async function runSearch(
		q: string,
		sp: string,
		uf: string,
		ws: string,
		rf: string,
		df: string,
		dt: string,
	) {
		searchLoading = true;
		searchError = null;
		searchOffset = 0;
		try {
			const params = buildSearchParams(q, sp, uf, ws, rf, df, dt, 0);
			const data = await safeFetchJson<any>(`/api/search?${params}`);
			const results = data.results || data;
			searchResults = results;
			searchTotal = data.total || results.length;
			subtitleMatches = data.subtitleMatches || [];
			subtitleTotal = data.subtitleTotal || 0;
			searchOffset = results.length;
			hasMoreSearch = results.length === DOWNLOADS_PAGE_SIZE;
		} catch (e) {
			searchResults = [];
			searchTotal = 0;
			subtitleMatches = [];
			subtitleTotal = 0;
			hasMoreSearch = false;
			searchError = isFetchError(e)
				? e
				: {
						type: 'unknown',
						message: 'Search failed. Please try again.',
						canRetry: true,
					};
		} finally {
			searchLoading = false;
		}
	}

	async function loadMoreSearch() {
		if (loadingMoreSearch || !hasMoreSearch || !searchQuery.trim()) return;
		loadingMoreSearch = true;
		try {
			const params = buildSearchParams(
				searchQuery,
				completedFilter,
				channelFilter,
				watchStateFilter,
				resolutionFilter,
				dateFrom,
				dateTo,
				searchOffset,
			);
			const data = await safeFetchJson<any>(`/api/search?${params}`);
			const results = data.results || data;
			searchResults = [...searchResults, ...results];
			searchOffset += results.length;
			hasMoreSearch = results.length === DOWNLOADS_PAGE_SIZE;
		} catch (e) {
			console.error('Failed to load more search results:', e);
		} finally {
			loadingMoreSearch = false;
		}
	}

	function retrySearch() {
		if (!searchQuery.trim()) return;
		runSearch(
			searchQuery,
			completedFilter,
			channelFilter,
			watchStateFilter,
			resolutionFilter,
			dateFrom,
			dateTo,
		);
	}

	$effect(() => {
		const q = searchQuery;
		const sp = completedFilter;
		const uf = channelFilter;
		const ws = watchStateFilter;
		const rf = resolutionFilter;
		const df = dateFrom;
		const dt = dateTo;

		if (searchDebounceTimer) clearTimeout(searchDebounceTimer);

		if (!q.trim()) {
			searchResults = [];
			searchTotal = 0;
			subtitleMatches = [];
			subtitleTotal = 0;
			searchLoading = false;
			searchError = null;
			searchOffset = 0;
			hasMoreSearch = false;
			return;
		}

		searchLoading = true;
		searchDebounceTimer = setTimeout(() => runSearch(q, sp, uf, ws, rf, df, dt), 300);
	});

	let filteredCompletedDownloads = $derived.by(() => {
		// Use search results if searching
		if (searchQuery.trim()) {
			return searchResults;
		}

		// Otherwise use normal filtering
		let filtered =
			channelFilter === 'all'
				? poolFilteredDownloads
				: poolFilteredDownloads.filter((d) => d.uploader === channelFilter);

		const sorted = [...filtered];
		switch (sortOption) {
			case 'oldest':
				sorted.sort(
					(a, b) =>
						new Date(a.completedAt || a.createdAt).getTime() -
						new Date(b.completedAt || b.createdAt).getTime(),
				);
				break;
			case 'newest':
				sorted.sort(
					(a, b) =>
						new Date(b.completedAt || b.createdAt).getTime() -
						new Date(a.completedAt || a.createdAt).getTime(),
				);
				break;
			case 'largest':
				sorted.sort((a, b) => Number(b.filesize || 0) - Number(a.filesize || 0));
				break;
			case 'smallest':
				sorted.sort((a, b) => Number(a.filesize || 0) - Number(b.filesize || 0));
				break;
			case 'longest':
				sorted.sort((a, b) => (b.duration || 0) - (a.duration || 0));
				break;
			case 'shortest':
				sorted.sort((a, b) => (a.duration || 0) - (b.duration || 0));
				break;
			case 'uploader':
				sorted.sort((a, b) => (a.uploader || '').localeCompare(b.uploader || ''));
				break;
		}
		return sorted;
	});

	onMount(() => {
		// Pre-apply uploader filter from URL (e.g. from /channels page)
		const uploaderParam = $page.url.searchParams.get('uploader');
		if (uploaderParam) channelFilter = uploaderParam;

		loadSettings();
		loadCompletedDownloads().then(() => {
			filtersInitialized = true;
		});
		loadFailedDownloads();
		loadCacheUsage();
		loadDiskInfo();

		const unsubComplete = onSSEEvent('download:complete', ({ download }) => {
			const exists = completedDownloads.find((d) => d.id === download.id);
			if (!exists) {
				completedDownloads = [download, ...completedDownloads];
			}
			loadCacheUsage();
			loadDiskInfo();
		});
		const unsubDeleted = onSSEEvent('download:deleted', ({ id }) => {
			completedDownloads = completedDownloads.filter((d) => d.id !== id);
			failedDownloads = failedDownloads.filter((d) => d.id !== id);
			loadCacheUsage();
			loadDiskInfo();
		});
		// download:failed only carries { id, error }, so refetch the failed
		// list to pick up the full record and show it live.
		const unsubFailed = onSSEEvent('download:failed', () => {
			loadFailedDownloads();
		});

		return () => {
			unsubComplete();
			unsubDeleted();
			unsubFailed();
		};
	});

	async function loadSettings() {
		try {
			const res = await fetch('/api/settings');
			if (res.ok) {
				const settings = await res.json();
				libraryConfigured = !!settings.libraryPath;
				jellyfinUrl = settings.jellyfinExternalUrl || settings.jellyfinUrl || '';
			}
		} catch (e) {
			console.error('Failed to load settings:', e);
		}
	}

	function buildCompletedParams(offset: number) {
		const params = new URLSearchParams({
			status: 'COMPLETED',
			limit: String(DOWNLOADS_PAGE_SIZE),
			offset: String(offset),
		});
		if (watchStateFilter !== 'all') {
			params.set('watchState', watchStateFilter);
		}
		const heightRange = getHeightRange(resolutionFilter);
		if (heightRange.min) params.set('minHeight', String(heightRange.min));
		if (heightRange.max) params.set('maxHeight', String(heightRange.max));
		if (dateFrom) params.set('dateFrom', dateFrom);
		if (dateTo) params.set('dateTo', dateTo);
		return params;
	}

	async function loadCompletedDownloads() {
		// Fresh load: reset pagination and replace the list from offset 0.
		completedLoading = true;
		completedOffset = 0;
		try {
			const res = await fetch(`/api/downloads?${buildCompletedParams(0)}`);
			if (res.ok) {
				const page: any[] = await res.json();
				completedDownloads = page;
				completedOffset = page.length;
				hasMoreDownloads = page.length === DOWNLOADS_PAGE_SIZE;
			}
		} catch (e) {
			console.error('Failed to load completed downloads:', e);
		} finally {
			completedLoading = false;
		}
	}

	async function loadMoreCompletedDownloads() {
		if (loadingMoreDownloads || !hasMoreDownloads) return;
		loadingMoreDownloads = true;
		try {
			const res = await fetch(`/api/downloads?${buildCompletedParams(completedOffset)}`);
			if (res.ok) {
				const page: any[] = await res.json();
				completedDownloads = [...completedDownloads, ...page];
				completedOffset += page.length;
				hasMoreDownloads = page.length === DOWNLOADS_PAGE_SIZE;
			}
		} catch (e) {
			console.error('Failed to load more completed downloads:', e);
		} finally {
			loadingMoreDownloads = false;
		}
	}

	function getHeightRange(filter: string): { min?: number; max?: number } {
		switch (filter) {
			case '4k':
				return { min: 2160 };
			case '1080p':
				return { min: 1080, max: 1080 };
			case '720p':
				return { min: 720, max: 720 };
			case '480p':
				return { min: 480, max: 480 };
			case 'other':
				return { max: 479 };
			default:
				return {};
		}
	}

	async function loadCacheUsage() {
		try {
			const res = await fetch('/api/library/usage');
			if (res.ok) {
				const data = await res.json();
				cacheUsage = data.cache;
				libraryUsage = data.library;
			}
		} catch (e) {
			console.error('Failed to load usage:', e);
		}
	}

	async function loadFailedDownloads() {
		failedLoading = true;
		try {
			const params = new URLSearchParams({
				status: 'FAILED',
				limit: String(DOWNLOADS_PAGE_SIZE),
				offset: '0',
			});
			const res = await fetch(`/api/downloads?${params}`);
			if (res.ok) {
				failedDownloads = await res.json();
			}
		} catch (e) {
			console.error('Failed to load failed downloads:', e);
		} finally {
			failedLoading = false;
		}
	}

	async function loadDiskInfo() {
		try {
			const res = await fetch('/api/settings/disk');
			if (res.ok) {
				diskInfo = await res.json();
			}
		} catch {
			// disk info is best-effort
		}
	}

	async function retryAllFailed() {
		if (failedDownloads.length === 0) return;

		// Iterate over a copy: the download:deleted SSE handler mutates
		// failedDownloads as each old record is removed.
		for (const download of [...failedDownloads]) {
			try {
				const body: any = {
					url: download.url,
					profileId: download.profileId,
				};
				if (download.storagePool === 'library') body.saveToLibrary = true;
				if (download.customFlags?.length) body.customFlags = download.customFlags;

				await csrfFetch('/api/downloads', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				});
				// Delete the old FAILED record so it doesn't reappear on reload.
				await csrfFetch(`/api/downloads/${download.id}`, {
					method: 'DELETE',
				});
			} catch (e) {
				console.error(`Failed to retry ${download.id}:`, e);
			}
		}
		await loadCompletedDownloads();
	}

	async function clearCache() {
		const confirmed = await showConfirm(
			'Clear Cache',
			'This will delete all cached downloads. Library downloads will not be affected.',
			'Clear Cache',
		);
		if (!confirmed) return;

		clearingCache = true;
		try {
			await csrfFetch('/api/library/clear', { method: 'POST' });
			await Promise.all([loadCompletedDownloads(), loadCacheUsage()]);
		} catch (e) {
			console.error('Failed to clear cache:', e);
		} finally {
			clearingCache = false;
		}
	}

	function toggleSelection(id: string) {
		const next = new Set(selectedIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedIds = next;
	}

	function selectAll() {
		selectedIds = new Set(filteredCompletedDownloads.map((d) => d.id));
	}

	function deselectAll() {
		selectedIds = new Set();
	}

	function exitSelectionMode() {
		selectionMode = false;
		selectedIds = new Set();
	}

	function getDownloadLabel(id: string): string {
		const d = completedDownloads.find((dl) => dl.id === id);
		return d?.title || id;
	}

	type BulkItemResult = { id: string; ok: boolean; reason?: string };

	async function runBulkOperation(
		ids: string[],
		verbPresent: string,
		verbPast: string,
		runOne: (id: string) => Promise<void>,
		concurrency = 4,
	): Promise<BulkItemResult[]> {
		const total = ids.length;
		const results: BulkItemResult[] = [];
		const toastId = addStickyToast('info', `${verbPresent} 0 of ${total}…`, 0);

		let completed = 0;
		let cursor = 0;

		async function worker() {
			while (cursor < ids.length) {
				const i = cursor++;
				const id = ids[i];
				try {
					await runOne(id);
					results.push({ id, ok: true });
				} catch (err) {
					const reason = err instanceof Error ? err.message : 'Unknown error';
					results.push({ id, ok: false, reason });
				}
				completed += 1;
				const percent = Math.round((completed / total) * 100);
				updateToast(toastId, {
					message: `${verbPresent} ${completed} of ${total}…`,
					progress: percent,
				});
			}
		}

		await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));

		const failures = results.filter((r) => !r.ok);
		const successes = total - failures.length;

		if (failures.length === 0) {
			resolveToast(
				toastId,
				'success',
				`${verbPast} ${successes} item${successes !== 1 ? 's' : ''}`,
			);
		} else if (successes === 0) {
			resolveToast(
				toastId,
				'error',
				`Failed to ${verbPresent.toLowerCase()} all ${total} item${total !== 1 ? 's' : ''}`,
				{
					details: failures.map((f) => `${getDownloadLabel(f.id)}: ${f.reason ?? 'failed'}`),
					duration: 10000,
				},
			);
		} else {
			resolveToast(
				toastId,
				'info',
				`${verbPast} ${successes} item${successes !== 1 ? 's' : ''} (${failures.length} failed)`,
				{
					details: failures.map((f) => `${getDownloadLabel(f.id)}: ${f.reason ?? 'failed'}`),
					duration: 10000,
				},
			);
		}

		return results;
	}

	async function bulkDelete() {
		const ids = [...selectedIds];
		const count = ids.length;
		const confirmed = await showConfirm(
			'Delete Selected',
			`Delete ${count} download${count !== 1 ? 's' : ''}? This cannot be undone.`,
			'Delete',
		);
		if (!confirmed) return;

		bulkActing = true;
		try {
			const results = await runBulkOperation(ids, 'Deleting', 'Deleted', async (id) => {
				const res = await csrfFetch(`/api/downloads/${id}`, {
					method: 'DELETE',
				});
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
			});
			if (results.some((r) => r.ok)) {
				flashBulkSuccess();
				exitSelectionMode();
				await loadCompletedDownloads();
			}
		} finally {
			bulkActing = false;
		}
	}

	let bulkPlaylistOpen = $state(false);
	let bulkPlaylists = $state<{ id: string; name: string }[]>([]);
	let bulkPlaylistLoading = $state(false);
	let bulkPlaylistAdding = $state(false);

	async function openBulkPlaylistPicker() {
		bulkPlaylistOpen = !bulkPlaylistOpen;
		if (!bulkPlaylistOpen) return;
		bulkPlaylistLoading = true;
		try {
			const res = await fetch('/api/playlists');
			bulkPlaylists = res.ok ? await res.json() : [];
		} catch {
			bulkPlaylists = [];
		} finally {
			bulkPlaylistLoading = false;
		}
	}

	async function bulkAddToPlaylist(playlistId: string, playlistName: string) {
		// Only library items can be added to playlists; skip cache-only selections.
		const ids = [...selectedIds].filter((id) => {
			const d = completedDownloads.find((dl) => dl.id === id);
			return d?.storagePool === 'library';
		});
		if (ids.length === 0) {
			addToast('info', 'Only library items can be added to playlists');
			bulkPlaylistOpen = false;
			return;
		}
		bulkPlaylistAdding = true;
		bulkPlaylistOpen = false;
		try {
			const results = await runBulkOperation(
				ids,
				`Adding to "${playlistName}"`,
				`Added to "${playlistName}"`,
				async (id) => {
					const res = await csrfFetch(`/api/playlists/${playlistId}/items`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ downloadId: id }),
					});
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
				},
			);
			if (results.some((r) => r.ok)) {
				flashBulkSuccess();
			}
		} finally {
			bulkPlaylistAdding = false;
		}
	}

	async function bulkPromote() {
		const ids = [...selectedIds].filter((id) => {
			const d = completedDownloads.find((dl) => dl.id === id);
			return d?.storagePool === 'cache';
		});
		if (ids.length === 0) {
			addToast('info', 'No cache downloads selected to move');
			return;
		}
		bulkActing = true;
		try {
			const results = await runBulkOperation(ids, 'Moving', 'Moved to library', async (id) => {
				const res = await csrfFetch(`/api/downloads/${id}/promote`, { method: 'POST' });
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
			});
			if (results.some((r) => r.ok)) {
				flashBulkSuccess();
				exitSelectionMode();
				await loadCompletedDownloads();
			}
		} finally {
			bulkActing = false;
		}
	}

	function focusUrlInput() {
		const el = document.getElementById('url') as HTMLInputElement | null;
		if (!el) return;
		el.scrollIntoView({ behavior: 'smooth', block: 'center' });
		el.focus();
	}

	function clearFilters() {
		completedFilter = 'all';
		watchStateFilter = 'all';
		channelFilter = 'all';
		dateFrom = '';
		dateTo = '';
		searchQuery = '';
	}
</script>

<svelte:head>
	<title>Downloads - wytui</title>
</svelte:head>

<div class="page">
	<div class="downloads-layout">
		<div class="form-section">
			<h2>Download</h2>
			<DownloadForm />
		</div>

		<div class="active-section" aria-live="polite" aria-atomic="false">
			<h2>Active ({sseState.downloads.length})</h2>
			<div class="active-box" class:active={sseState.downloads.length > 0}>
				{#if sseState.downloads.length === 0}
					<EmptyState
						title="No active downloads"
						description="Paste a video URL above and your download progress will appear here in real time."
						size="sm"
						variant="subtle"
					>
						{#snippet icon()}
							<svg
								width="24"
								height="24"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.75"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
								<polyline points="7 10 12 15 17 10" />
								<line x1="12" y1="15" x2="12" y2="3" />
							</svg>
						{/snippet}
					</EmptyState>
				{:else}
					<div class="downloads-list">
						{#each [...sseState.downloads].sort((a, b) => {
							const active = ['FETCHING_INFO', 'DOWNLOADING', 'PROCESSING'];
							const aActive = active.includes(a.status) ? 0 : 1;
							const bActive = active.includes(b.status) ? 0 : 1;
							if (aActive !== bActive) return aActive - bActive;
							return sseState.downloads.indexOf(b) - sseState.downloads.indexOf(a);
						}) as download (download.id)}
							<DownloadCard {download} {jellyfinUrl} {libraryConfigured} />
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>

	{#if cacheUsage || libraryUsage}
		<div class="storage-row">
			{#if cacheUsage}
				<div class="storage-box cache-box">
					<div class="cache-disk-row">
						<div class="cache-disk-col">
							<div class="cache-usage-header">
								<div class="cache-usage-left">
									<span class="cache-usage-label">Cache</span>
									<span
										class="cache-usage-tooltip"
										data-tooltip="Downloads are stored in a temporary cache. When the cache fills up, the oldest downloads are automatically removed to free space. Save to Library to keep downloads permanently."
										>?</span
									>
								</div>
								<div class="cache-usage-right">
									<span class="cache-usage-value"
										>{formatBytes(cacheUsage.usedBytes)} / {formatBytes(
											cacheUsage.quotaBytes,
										)}</span
									>
									{#if Number(cacheUsage.usedBytes) > 0}
										<button
											class="btn btn-sm btn-secondary cache-clear-btn"
											onclick={clearCache}
											disabled={clearingCache}
											aria-label="Clear cache"
											title="Clear cache"
										>
											{#if clearingCache}
												<svg
													xmlns="http://www.w3.org/2000/svg"
													width="16"
													height="16"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-linejoin="round"
													class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg
												>
											{:else}
												<svg
													xmlns="http://www.w3.org/2000/svg"
													width="16"
													height="16"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-linejoin="round"
													><polyline points="3 6 5 6 21 6" /><path
														d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
													/></svg
												>
											{/if}
										</button>
									{/if}
								</div>
							</div>
							<div class="cache-usage-bar">
								<div
									class="cache-usage-fill"
									class:warning={cacheUsage.percentage > 80}
									class:critical={cacheUsage.percentage > 95}
									style="width: max({cacheUsage.percentage}%, {cacheUsage.percentage > 0
										? '4px'
										: '0px'})"
								></div>
							</div>
						</div>
						{#if diskInfo}
							<div class="cache-disk-col">
								<div class="cache-usage-header">
									<div class="cache-usage-left">
										<span class="cache-usage-label">Disk</span>
									</div>
									<div class="cache-usage-right">
										<span class="cache-usage-value"
											>{formatBytes(diskUsedBytes)} / {formatBytes(diskInfo.totalBytes)}</span
										>
									</div>
								</div>
								<div class="cache-usage-bar">
									<div
										class="cache-usage-fill"
										class:warning={diskPercent > 80}
										class:critical={diskPercent > 95}
										style="width: max({diskPercent}%, {diskPercent > 0 ? '4px' : '0px'})"
									></div>
								</div>
							</div>
						{/if}
					</div>
				</div>
			{/if}
			{#if libraryUsage?.video}
				<div class="storage-box">
					<div class="cache-usage-header">
						<div class="cache-usage-left">
							<span class="cache-usage-label">Video Library</span>
						</div>
						<div class="cache-usage-right">
							<span class="cache-usage-value">{formatBytes(libraryUsage.video.usedBytes)}</span>
							<span class="storage-count"
								>{libraryUsage.video.count} file{libraryUsage.video.count !== 1 ? 's' : ''}</span
							>
						</div>
					</div>
				</div>
			{/if}
			{#if libraryUsage?.music}
				<div class="storage-box">
					<div class="cache-usage-header">
						<div class="cache-usage-left">
							<span class="cache-usage-label">Music Library</span>
						</div>
						<div class="cache-usage-right">
							<span class="cache-usage-value">{formatBytes(libraryUsage.music.usedBytes)}</span>
							<span class="storage-count"
								>{libraryUsage.music.count} file{libraryUsage.music.count !== 1 ? 's' : ''}</span
							>
						</div>
					</div>
				</div>
			{/if}
		</div>
	{/if}

	{#if diskInfo}
		{#if Number(diskInfo.availableBytes) < Number(diskInfo.totalBytes) * 0.2}
			<div class="storage-warning">
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="warning-icon"
				>
					<path
						d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
					/>
					<line x1="12" y1="9" x2="12" y2="13" />
					<line x1="12" y1="17" x2="12.01" y2="17" />
				</svg>
				<div class="warning-text">
					<span class="warning-label">Warning: Disk space low</span>
					<span class="warning-message"
						>Your disk is over 80% full. Available: {formatBytes(diskInfo.availableBytes)} / Total: {formatBytes(
							diskInfo.totalBytes,
						)}</span
					>
				</div>
			</div>
		{/if}
	{/if}

	{#if failedDownloads.length > 0 || failedLoading}
		<div class="section">
			<div class="section-header">
				<h2>Failed ({failedDownloads.length})</h2>
				{#if failedDownloads.length > 0}
					<button class="btn btn-sm btn-primary" onclick={retryAllFailed} disabled={failedLoading}>
						Retry All
					</button>
				{/if}
			</div>

			{#if failedLoading && failedDownloads.length === 0}
				<Skeleton count={3} variant="card" />
			{:else}
				<div class="downloads-grid">
					{#each failedDownloads as download (download.id)}
						<DownloadCard {download} {jellyfinUrl} {libraryConfigured} />
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<div class="section completed-card">
		<div class="section-header">
			<div class="section-header-left">
				<h2>
					Completed ({searchQuery ? searchTotal : filteredCompletedDownloads.length})
				</h2>
				<ViewToggle bind:view={viewMode} />
				<button
					class="select-btn"
					class:active={selectionMode}
					onclick={(e) => {
						e.stopPropagation();
						if (selectionMode) exitSelectionMode();
						else selectionMode = true;
					}}
				>
					{selectionMode ? 'Cancel' : 'Select'}
				</button>
			</div>
			<div class="section-header-right">
				<div class="tabs completed-filter">
					<button
						class="tab"
						class:active={completedFilter === 'all'}
						onclick={(e) => {
							e.stopPropagation();
							completedFilter = 'all';
						}}>All</button
					>
					<button
						class="tab"
						class:active={completedFilter === 'cache'}
						onclick={(e) => {
							e.stopPropagation();
							completedFilter = 'cache';
						}}>Cache</button
					>
					<button
						class="tab"
						class:active={completedFilter === 'library'}
						onclick={(e) => {
							e.stopPropagation();
							completedFilter = 'library';
						}}>Library</button
					>
				</div>
				{#if availableChannels.length > 1}
					<FilterDropdown
						label="Filter by channel"
						bind:value={channelFilter}
						searchable
						searchPlaceholder="Search channels..."
						emptyText="No channels found"
						options={[
							{ value: 'all', label: 'All channels' },
							...availableChannels.map((c) => ({ value: c, label: c })),
						]}
					/>
				{/if}
				<FilterDropdown
					label="Sort downloads"
					bind:value={sortOption}
					options={[
						{ value: 'newest', label: 'Newest first', short: 'Newest' },
						{ value: 'oldest', label: 'Oldest first', short: 'Oldest' },
						{ value: 'largest', label: 'Largest first', short: 'Largest' },
						{ value: 'smallest', label: 'Smallest first', short: 'Smallest' },
						{ value: 'longest', label: 'Longest first', short: 'Longest' },
						{ value: 'shortest', label: 'Shortest first', short: 'Shortest' },
						{ value: 'uploader', label: 'Uploader A–Z', short: 'Uploader' },
					]}
				>
					{#snippet icon()}
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
							<path
								d="M2 4h10M4 7h6M6 10h2"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
							/>
						</svg>
					{/snippet}
				</FilterDropdown>
			</div>
			<div class="section-header-filters">
				<FilterDropdown
					label="Filter by watch state"
					bind:value={watchStateFilter}
					options={[
						{ value: 'all', label: 'All states' },
						{ value: 'unwatched', label: 'Unwatched' },
						{ value: 'in_progress', label: 'In progress' },
						{ value: 'watched', label: 'Watched' },
					]}
				>
					{#snippet icon()}
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
							<circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.3" fill="none" />
							<path d="M5.5 5.5L9 7L5.5 8.5z" fill="currentColor" />
						</svg>
					{/snippet}
				</FilterDropdown>
				<FilterDropdown
					label="Filter by resolution"
					bind:value={resolutionFilter}
					options={[
						{ value: 'all', label: 'All resolutions', short: 'All res' },
						{ value: '4k', label: '4K+ (2160p+)', short: '4K+' },
						{ value: '1080p', label: '1080p' },
						{ value: '720p', label: '720p' },
						{ value: '480p', label: '480p' },
						{ value: 'other', label: 'Below 480p', short: 'Other' },
					]}
				>
					{#snippet icon()}
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
							<rect
								x="2"
								y="3"
								width="10"
								height="8"
								rx="1"
								stroke="currentColor"
								stroke-width="1.3"
								fill="none"
							/>
							<path d="M5 7h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
						</svg>
					{/snippet}
				</FilterDropdown>
				<div class="date-range-filter">
					<input
						type="date"
						class="date-input"
						bind:value={dateFrom}
						placeholder="From"
						title="Download date from"
					/>
					<span class="date-range-separator">–</span>
					<input
						type="date"
						class="date-input"
						bind:value={dateTo}
						placeholder="To"
						title="Download date to"
					/>
					{#if dateFrom || dateTo}
						<button
							class="date-clear-btn"
							aria-label="Clear dates"
							title="Clear date filter"
							onclick={() => {
								dateFrom = '';
								dateTo = '';
							}}
						>
							<svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"
								><path
									d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
								/></svg
							>
						</button>
					{/if}
				</div>
			</div>
		</div>
		<div class="completed-search">
			<div class="search-bar-wrapper">
				<svg class="search-icon" width="20" height="20" viewBox="0 0 16 16" fill="none">
					<circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5" />
					<path d="M11 11l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
				</svg>
				<input
					type="text"
					class="search-input-main"
					placeholder="Search by title, description, uploader, or subtitle text..."
					aria-label="Search downloads"
					bind:value={searchQuery}
				/>
				{#if searchQuery}
					<button
						class="search-clear-btn"
						aria-label="Clear search"
						onclick={() => (searchQuery = '')}
					>
						<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"
							><path
								d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
							/></svg
						>
					</button>
				{/if}
			</div>
			{#if searchError}
				<div class="search-error-wrapper">
					<ErrorMessage
						error={searchError}
						onRetry={retrySearch}
						onDismiss={() => (searchError = null)}
					/>
				</div>
			{/if}
		</div>

		{#if searchQuery.trim() && subtitleMatches.length > 0}
			<div class="completed-subtitles">
				<h3 class="subtitle-results-heading">
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
					</svg>
					Found in subtitles ({subtitleTotal})
				</h3>
				<div class="subtitle-matches">
					{#each subtitleMatches as match (match.id)}
						<a
							class="subtitle-match"
							href="/downloads/{match.downloadId}?t={Math.floor(match.startTime)}"
						>
							<div class="subtitle-match-time">
								{formatTimestamp(match.startTime)}
							</div>
							<div class="subtitle-match-content">
								<div class="subtitle-match-text">{match.text}</div>
								<div class="subtitle-match-video">
									{match.download.title || 'Untitled'}{match.download.uploader
										? ` - ${match.download.uploader}`
										: ''}
								</div>
							</div>
						</a>
					{/each}
				</div>
			</div>
		{/if}
		<div class="completed-body">
			{#if completedLoading && completedDownloads.length === 0}
				{#if viewMode === 'grid'}
					<Skeleton count={6} variant="card" />
				{:else}
					<Skeleton count={8} variant="table-row" columns={4} />
				{/if}
			{:else if filteredCompletedDownloads.length === 0}
				{@const noFilters =
					completedFilter === 'all' &&
					watchStateFilter === 'all' &&
					channelFilter === 'all' &&
					!dateFrom &&
					!dateTo &&
					!searchQuery}
				{#if noFilters}
					<EmptyState
						title="No completed downloads yet"
						description="Paste a video URL above to download your first video. It will appear here once it finishes processing."
						actionLabel="Download a video"
						onAction={focusUrlInput}
					>
						{#snippet icon()}
							<svg
								width="28"
								height="28"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<rect x="2" y="3" width="20" height="14" rx="2" />
								<path d="M10 8l5 3-5 3V8z" fill="currentColor" stroke="none" />
								<line x1="8" y1="21" x2="16" y2="21" />
								<line x1="12" y1="17" x2="12" y2="21" />
							</svg>
						{/snippet}
					</EmptyState>
				{:else}
					<EmptyState
						title={watchStateFilter !== 'all'
							? `No ${watchStateFilter.replace('_', ' ')} downloads`
							: completedFilter !== 'all'
								? `No ${completedFilter} downloads`
								: 'No downloads match your filters'}
						description="Try adjusting or clearing your filters to see more results."
						actionLabel="Clear filters"
						onAction={clearFilters}
					>
						{#snippet icon()}
							<svg
								width="28"
								height="28"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
							</svg>
						{/snippet}
					</EmptyState>
				{/if}
			{:else if viewMode === 'grid'}
				<div class="downloads-grid">
					{#each filteredCompletedDownloads as download (download.id)}
						<DownloadCard
							{download}
							{jellyfinUrl}
							{selectionMode}
							selected={selectedIds.has(download.id)}
							{libraryConfigured}
							onToggleSelect={() => toggleSelection(download.id)}
						/>
					{/each}
				</div>
			{:else}
				<div class="downloads-list">
					{#each filteredCompletedDownloads as download (download.id)}
						<DownloadListRow
							{download}
							{selectionMode}
							selected={selectedIds.has(download.id)}
							onToggleSelect={() => toggleSelection(download.id)}
							onclick={() => {
								if (download.status === 'COMPLETED') goto(`/downloads/${download.id}`);
							}}
						/>
					{/each}
				</div>
			{/if}

			{#if searchQuery.trim()}
				{#if hasMoreSearch}
					<div class="load-more-row">
						<button class="btn btn-secondary" onclick={loadMoreSearch} disabled={loadingMoreSearch}>
							{loadingMoreSearch ? 'Loading…' : 'Load More'}
						</button>
					</div>
				{/if}
			{:else if hasMoreDownloads && !completedLoading}
				<div class="load-more-row">
					<button
						class="btn btn-secondary"
						onclick={loadMoreCompletedDownloads}
						disabled={loadingMoreDownloads}
					>
						{loadingMoreDownloads ? 'Loading…' : 'Load More'}
					</button>
				</div>
			{/if}

			{#if selectionMode && selectedIds.size > 0}
				<div class="bulk-bar" class:bulk-bar-success={bulkSuccess}>
					<span class="bulk-count">{selectedIds.size} selected</span>
					<div class="bulk-actions">
						<button
							class="btn btn-sm btn-secondary"
							onclick={() => {
								selectedIds.size === filteredCompletedDownloads.length
									? deselectAll()
									: selectAll();
							}}
						>
							<CheckSquareIcon checked={selectedIds.size === filteredCompletedDownloads.length} />
							{selectedIds.size === filteredCompletedDownloads.length
								? 'Deselect all'
								: 'Select all'}
						</button>
						<div class="bulk-playlist-wrap">
							<button
								class="btn btn-sm btn-secondary"
								onclick={openBulkPlaylistPicker}
								disabled={bulkPlaylistAdding}
							>
								<ListPlusIcon />
								Add to Playlist
							</button>
							{#if bulkPlaylistOpen}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<div
									class="bulk-playlist-backdrop"
									onclick={() => (bulkPlaylistOpen = false)}
								></div>
								<div class="bulk-playlist-menu">
									{#if bulkPlaylistLoading}
										<p class="bulk-playlist-empty">Loading…</p>
									{:else if bulkPlaylists.length === 0}
										<p class="bulk-playlist-empty">No playlists yet</p>
									{:else}
										{#each bulkPlaylists as pl}
											<button
												class="bulk-playlist-option"
												onclick={() => bulkAddToPlaylist(pl.id, pl.name)}
												disabled={bulkPlaylistAdding}
											>
												{pl.name}
											</button>
										{/each}
									{/if}
								</div>
							{/if}
						</div>
						<button class="btn btn-sm btn-accent" onclick={bulkPromote} disabled={bulkActing}>
							<FolderDownIcon />
							Move to Library
						</button>
						<button class="btn btn-sm btn-danger" onclick={bulkDelete} disabled={bulkActing}>
							<TrashIcon />
							Delete
						</button>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.page {
		max-width: 1400px;
		margin: 0 auto;
		width: 100%;
	}

	.downloads-layout {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-xl);
		align-items: start;
		margin-bottom: var(--spacing-lg);
	}

	.form-section {
		align-self: start;
	}
	.form-section h2 {
		margin-bottom: var(--spacing-lg);
	}
	.active-section {
		min-width: 0;
		align-self: stretch;
		display: flex;
		flex-direction: column;
	}
	.active-section h2 {
		margin-bottom: var(--spacing-lg);
	}

	/* Matches the download panel's size (radius + padding) and fills the column
	   height, but with no interior fill. The border is drawn by a masked
	   pseudo-element so only the ring is painted and the inside stays
	   transparent. */
	.active-box {
		position: relative;
		flex: 1;
		padding: var(--spacing-xl);
		border-radius: var(--radius-lg);
		background: none;
	}
	.active-box::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		padding: 2px;
		/* Idle: neutral grey diagonal stripes (grey dashes over the dark page). */
		background: repeating-linear-gradient(
			45deg,
			var(--color-border-default) 0,
			var(--color-border-default) 8px,
			transparent 8px,
			transparent 16px
		);
		-webkit-mask:
			linear-gradient(#000 0 0) content-box,
			linear-gradient(#000 0 0);
		-webkit-mask-composite: xor;
		mask:
			linear-gradient(#000 0 0) content-box,
			linear-gradient(#000 0 0);
		mask-composite: exclude;
		pointer-events: none;
	}
	/* Active downloads: no border at all. */
	.active-box.active::before {
		display: none;
	}

	.downloads-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-lg);
		max-height: 70vh;
		overflow-y: auto;
		/* Room for the card's hover lift/scale so it doesn't overflow the
		   scroll container and trigger a scrollbar. Negative margin keeps the
		   cards visually aligned with the rest of the layout. */
		padding: var(--spacing-xs);
		margin: calc(var(--spacing-xs) * -1);
	}

	.section {
		margin-bottom: var(--spacing-lg);
		width: 100%;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-xl);
		flex-wrap: wrap;
	}

	.section-header-left {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}
	.section-header-right {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}
	.section-header-filters {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		margin-top: var(--spacing-xs);
	}
	.section-header h2 {
		margin: 0;
		line-height: 1;
		font-size: 1.25rem;
	}
	.section > h2 {
		margin-bottom: var(--spacing-lg);
	}

	.completed-card {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
	}
	.completed-card .section-header {
		margin-bottom: 0;
		padding: var(--spacing-lg);
		background: var(--color-bg-tertiary);
		border-bottom: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg) var(--radius-lg) 0 0;
	}
	.completed-body {
		padding: var(--spacing-lg);
	}

	.select-btn {
		height: var(--control-height);
		padding: 0 var(--spacing-md);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border-translucent);
		border-radius: var(--radius-md);
		color: var(--color-text-secondary);
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.select-btn:hover {
		color: var(--color-text-primary);
		border-color: var(--color-border-translucent-hover);
	}
	.select-btn.active {
		background: var(--color-accent-primary);
		border-color: var(--color-accent-primary);
		color: var(--color-text-on-accent);
	}

	.tabs {
		display: flex;
		gap: 4px;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		padding: 4px;
	}
	.tab {
		padding: var(--spacing-sm) var(--spacing-xl);
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--color-text-secondary);
		font-weight: 500;
		font-size: 0.875rem;
		cursor: pointer;
		transition: all var(--transition-fast);
	}
	.tab:hover:not(.active) {
		color: var(--color-text-primary);
		background: var(--color-overlay-hover-subtle);
	}
	.tab.active {
		background: var(--color-accent-primary);
		color: var(--color-text-on-accent);
		font-weight: 600;
	}

	.completed-filter {
		margin-bottom: 0;
		height: var(--control-height);
		align-items: stretch;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border-translucent);
		border-radius: var(--radius-md);
	}
	.completed-filter .tab {
		display: flex;
		align-items: center;
		padding: 0 var(--spacing-md);
		font-size: 0.8125rem;
	}

	.downloads-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(var(--grid-card-min-width), 1fr));
		gap: var(--spacing-lg);
		width: 100%;
	}

	.load-more-row {
		display: flex;
		justify-content: center;
		margin-top: var(--spacing-xl);
	}

	.downloads-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		width: 100%;
	}

	.bulk-bar {
		position: sticky;
		bottom: var(--spacing-lg);
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--spacing-sm) var(--spacing-lg);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border-translucent);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-dropdown);
		margin-top: var(--spacing-lg);
		z-index: 50;
		transition:
			border-color 0.3s ease,
			box-shadow 0.3s ease;
	}
	.bulk-bar-success {
		border-color: var(--color-status-success, var(--color-status-success));
		box-shadow:
			0 0 0 1px var(--color-status-success, var(--color-status-success)),
			0 8px 24px -8px var(--color-status-success, var(--color-status-success));
		animation: bulk-bar-flash 0.9s ease-out;
	}
	@keyframes bulk-bar-flash {
		0% {
			background: var(--color-bg-tertiary);
		}
		25% {
			background: color-mix(
				in srgb,
				var(--color-status-success, var(--color-status-success)) 18%,
				var(--color-bg-tertiary)
			);
		}
		100% {
			background: var(--color-bg-tertiary);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.bulk-bar-success {
			animation: none;
		}
	}
	.bulk-count {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text-primary);
	}
	.bulk-actions {
		display: flex;
		gap: var(--spacing-sm);
		align-items: center;
		flex-wrap: wrap;
	}

	.bulk-playlist-wrap {
		position: relative;
	}
	.bulk-playlist-backdrop {
		position: fixed;
		inset: 0;
		z-index: 49;
	}
	.bulk-playlist-menu {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 0;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
		min-width: 180px;
		max-height: 240px;
		overflow-y: auto;
		z-index: 50;
		padding: var(--spacing-xs);
		transform-origin: bottom left;
		animation: dropdown-in 160ms cubic-bezier(0.2, 0.8, 0.3, 1.1) both;
	}
	@media (prefers-reduced-motion: reduce) {
		.bulk-playlist-menu {
			animation: none;
		}
	}
	.bulk-playlist-option {
		display: block;
		width: 100%;
		text-align: left;
		padding: 7px var(--spacing-sm);
		background: none;
		border: none;
		color: var(--color-text-primary);
		font: inherit;
		font-size: 0.875rem;
		cursor: pointer;
		border-radius: var(--radius-sm);
		transition: background var(--transition-fast);
		min-height: unset;
	}
	.bulk-playlist-option:hover {
		background: var(--color-overlay-hover);
	}
	.bulk-playlist-option:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.bulk-playlist-empty {
		padding: var(--spacing-sm) var(--spacing-sm);
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		margin: 0;
	}

	.storage-row {
		display: flex;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-lg);
	}
	.storage-box {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		padding: var(--spacing-md) var(--spacing-lg);
		flex: 1;
		min-width: 0;
	}
	/* Cache island holds the cache + disk bars side by side. */
	.cache-box {
		flex: 1 1 360px;
	}
	.cache-disk-row {
		display: flex;
		gap: var(--spacing-lg);
	}
	.cache-disk-col {
		flex: 1 1 0;
		min-width: 0;
	}
	@media (max-width: 640px) {
		.cache-disk-row {
			flex-direction: column;
			gap: var(--spacing-md);
		}
	}
	.storage-count {
		font-size: 0.75rem;
		color: var(--color-text-tertiary);
	}
	.cache-usage-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-sm);
	}
	.cache-usage-left {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}
	.cache-usage-right {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}
	.cache-usage-label {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-tertiary);
	}
	.cache-usage-tooltip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--color-bg-tertiary);
		color: var(--color-text-tertiary);
		font-size: 0.625rem;
		font-weight: 700;
		cursor: help;
		border: 1px solid var(--color-border-default);
		position: relative;
	}
	.cache-usage-tooltip::after {
		content: attr(data-tooltip);
		position: absolute;
		bottom: calc(100% + 8px);
		left: 50%;
		transform: translateX(-50%);
		background: var(--color-bg-tertiary);
		color: var(--color-text-primary);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		padding: 8px 12px;
		font-size: 0.75rem;
		font-weight: 400;
		line-height: 1.4;
		width: 260px;
		white-space: normal;
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.15s ease;
		z-index: 200;
		box-shadow: var(--shadow-lg);
	}
	.cache-usage-tooltip:hover::after {
		opacity: 1;
	}
	.cache-usage-value {
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}
	.cache-clear-btn {
		padding: 4px !important;
		font-size: 0 !important;
		line-height: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.cache-clear-btn svg {
		display: block;
	}

	:global(.btn-icon) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-sm) !important;
		line-height: 1;
	}

	:global(.btn-icon svg) {
		display: block;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.cache-clear-btn .spin {
		animation: spin 1s linear infinite;
	}
	.cache-usage-bar {
		height: 6px;
		background: var(--color-bg-tertiary);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}
	.cache-usage-fill {
		height: 100%;
		background: var(--color-accent-primary);
		border-radius: var(--radius-sm);
		transition: width 0.3s ease;
	}
	.cache-usage-fill.warning {
		background: var(--color-status-warning);
	}
	.cache-usage-fill.critical {
		background: var(--color-status-error);
	}

	.storage-warning {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		padding: var(--spacing-md) var(--spacing-lg);
		background: var(--color-overlay-warning-10);
		border: 1px solid var(--color-status-warning);
		border-radius: var(--radius-lg);
		margin-bottom: var(--spacing-lg);
	}

	.warning-icon {
		color: var(--color-status-warning);
		min-width: 20px;
	}

	.warning-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.warning-label {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-status-warning);
	}

	.warning-message {
		font-size: 0.8125rem;
		color: var(--color-text-primary);
	}

	.completed-search {
		padding: var(--spacing-lg);
		border-bottom: 1px solid var(--color-border-default);
		display: flex;
		gap: var(--spacing-md);
		flex-wrap: wrap;
		align-items: flex-start;
	}

	.search-bar-wrapper {
		position: relative;
		display: flex;
		align-items: center;
		flex: 1;
		min-width: 300px;
	}

	.search-error-wrapper {
		flex-basis: 100%;
		margin-top: var(--spacing-sm);
	}

	.search-icon {
		position: absolute;
		left: var(--spacing-lg);
		color: var(--color-text-tertiary);
		pointer-events: none;
		z-index: 1;
	}

	.search-input-main {
		width: 100%;
		padding: var(--spacing-md) var(--spacing-lg) var(--spacing-md) calc(var(--spacing-lg) + 28px);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		color: var(--color-text-primary);
		font-size: var(--font-size-sm);
		transition: border-color var(--transition-fast);
	}

	.search-input-main:focus {
		outline: none;
		border-color: var(--color-accent-primary);
		box-shadow: 0 0 0 3px var(--color-focus-ring-search);
	}

	.search-input-main::placeholder {
		color: var(--color-text-tertiary);
	}

	.search-clear-btn {
		position: absolute;
		right: var(--spacing-md);
		display: flex;
		align-items: center;
		padding: 4px;
		background: transparent;
		border: none;
		color: var(--color-text-tertiary);
		cursor: pointer;
		border-radius: var(--radius-sm);
		z-index: 1;
	}

	.search-clear-btn:hover {
		color: var(--color-text-primary);
		background: var(--color-overlay-hover);
	}

	.completed-subtitles {
		padding: var(--spacing-lg);
		border-bottom: 1px solid var(--color-border-default);
	}

	.subtitle-results-heading {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		margin-bottom: var(--spacing-md);
	}

	.subtitle-results-heading svg {
		color: var(--color-text-tertiary);
		flex-shrink: 0;
	}

	.subtitle-matches {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.subtitle-match {
		display: flex;
		align-items: flex-start;
		gap: var(--spacing-md);
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		text-decoration: none;
		color: inherit;
		transition:
			border-color 0.15s,
			background 0.15s;
	}

	.subtitle-match:hover {
		border-color: var(--color-accent-primary);
		background: var(--color-bg-tertiary);
	}

	.subtitle-match-time {
		flex-shrink: 0;
		font-family: var(--font-family-mono);
		font-size: 0.8125rem;
		color: var(--color-accent-primary);
		padding-top: 1px;
		min-width: 48px;
	}

	.subtitle-match-content {
		min-width: 0;
		flex: 1;
	}

	.subtitle-match-text {
		font-size: 0.875rem;
		color: var(--color-text-primary);
		line-height: 1.4;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.subtitle-match-video {
		font-size: 0.75rem;
		color: var(--color-text-tertiary);
		margin-top: 2px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.date-range-filter {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.date-input {
		height: var(--control-height);
		padding: 0 var(--spacing-sm);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border-translucent);
		border-radius: var(--radius-md);
		color: var(--color-text-primary);
		font-size: 0.8125rem;
		width: 130px;
		cursor: pointer;
		transition: border-color 0.15s;
	}

	.date-input:hover {
		border-color: var(--color-border-translucent-hover);
	}
	.date-input:focus {
		outline: none;
		border-color: var(--color-accent-primary);
	}

	.date-input::-webkit-calendar-picker-indicator {
		filter: invert(0.7);
		cursor: pointer;
	}

	.date-range-separator {
		color: var(--color-text-tertiary);
		font-size: 0.8125rem;
		user-select: none;
	}

	.date-clear-btn {
		display: flex;
		align-items: center;
		padding: 4px;
		background: transparent;
		border: none;
		color: var(--color-text-tertiary);
		cursor: pointer;
		border-radius: var(--radius-sm);
	}

	.date-clear-btn:hover {
		color: var(--color-text-primary);
		background: var(--color-overlay-hover);
	}

	@media (max-width: 768px) {
		.page {
			padding: 0 var(--spacing-sm);
		}
		.storage-row {
			flex-direction: column;
		}
		.downloads-layout {
			grid-template-columns: 1fr;
			gap: var(--spacing-lg);
		}
		.active-box {
			padding: var(--spacing-md);
		}
		.downloads-grid {
			grid-template-columns: 1fr;
		}
		.completed-search {
			flex-direction: column;
		}
		.search-bar-wrapper {
			min-width: unset;
		}
		.search-input-main {
			font-size: 1rem;
			min-height: 44px;
		}
		.search-clear-btn {
			min-width: 44px;
			min-height: 44px;
		}
		.section-header {
			flex-direction: column;
			align-items: stretch;
			gap: var(--spacing-sm);
		}
		.section-header-left {
			justify-content: space-between;
			flex-wrap: wrap;
			gap: var(--spacing-sm);
		}
		.section-header-right {
			display: grid;
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			gap: var(--spacing-sm);
			align-items: stretch;
		}
		.section-header-filters {
			display: grid;
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			gap: var(--spacing-sm);
		}
		.select-btn {
			min-height: 44px;
			padding: var(--spacing-sm) var(--spacing-md);
		}
		.completed-filter {
			grid-column: 1 / -1;
			width: 100%;
			/* Override the fixed desktop control height so the container grows to
			   contain the 44px touch-target tabs instead of letting them overflow. */
			height: auto;
		}
		.completed-filter .tab {
			flex: 1;
			text-align: center;
			min-height: 44px;
		}
		.bulk-bar {
			flex-direction: column;
			gap: var(--spacing-sm);
			padding: var(--spacing-md);
		}
		.bulk-actions {
			width: 100%;
			flex-wrap: wrap;
		}
		.bulk-actions .btn {
			flex: 1;
			min-width: 0;
			min-height: 44px;
		}
		.date-range-filter {
			grid-column: 1 / -1;
			width: 100%;
			gap: var(--spacing-sm);
		}
		.date-input {
			flex: 1;
			min-width: 0;
			width: auto;
			min-height: 44px;
			font-size: 1rem;
			padding: var(--spacing-sm) var(--spacing-md);
		}
		.date-clear-btn {
			min-width: 44px;
			min-height: 44px;
			padding: var(--spacing-sm);
		}
	}

	@media (max-width: 480px) {
		.section-header-right {
			grid-template-columns: minmax(0, 1fr);
		}
		.section-header-filters {
			grid-template-columns: minmax(0, 1fr);
		}
		.tabs {
			flex-wrap: wrap;
		}
		.tab {
			padding: var(--spacing-sm) var(--spacing-md);
		}
	}
</style>
