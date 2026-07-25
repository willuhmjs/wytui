<script lang="ts">
	import { goto } from '$app/navigation';
	import { formatBytes, formatDuration } from '$lib/utils/format';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';

	let query = $state('');
	let videoType = $state('all');
	let storagePool = $state('all');
	let uploaderFilter = $state('');

	let results = $state<any[]>([]);
	let total = $state(0);
	let loading = $state(false);
	let searched = $state(false);
	let debounceTimer = $state<ReturnType<typeof setTimeout> | null>(null);

	$effect(() => {
		// Track all reactive dependencies
		const q = query;
		const vt = videoType;
		const sp = storagePool;
		const uf = uploaderFilter;

		if (debounceTimer) clearTimeout(debounceTimer);

		if (!q.trim()) {
			results = [];
			total = 0;
			searched = false;
			loading = false;
			return;
		}

		loading = true;
		debounceTimer = setTimeout(() => {
			performSearch(q, vt, sp, uf);
		}, 300);
	});

	async function performSearch(q: string, vt: string, sp: string, uf: string) {
		try {
			const params = new URLSearchParams({ q, limit: '40' });
			if (vt !== 'all') params.set('videoType', vt);
			if (sp !== 'all') params.set('storagePool', sp);
			if (uf.trim()) params.set('uploader', uf.trim());

			const res = await fetch(`/api/search?${params}`);
			if (res.ok) {
				const data = await res.json();
				results = data.results;
				total = data.total;
			} else {
				results = [];
				total = 0;
			}
		} catch (e) {
			console.error('Search failed:', e);
			results = [];
			total = 0;
		} finally {
			loading = false;
			searched = true;
		}
	}

	function navigateToDownload(id: string) {
		goto(`/downloads/${id}`);
	}

	let searchInputEl: HTMLInputElement | undefined = $state();

	function focusSearch() {
		searchInputEl?.focus();
		searchInputEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}

	function clearSearchFilters() {
		query = '';
		videoType = 'all';
		storagePool = 'all';
		uploaderFilter = '';
		searchInputEl?.focus();
	}
</script>

<div class="search-header">
	<div class="search-bar">
		<svg class="search-icon" width="20" height="20" viewBox="0 0 16 16" fill="none">
			<circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5" />
			<path d="M11 11l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
		</svg>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			type="text"
			class="search-input"
			placeholder="Search downloads by title, description, or uploader..."
			bind:value={query}
			bind:this={searchInputEl}
			autofocus
		/>
		{#if query}
			<button class="search-clear" aria-label="Clear search" onclick={() => (query = '')}>
				<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"
					><path
						d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
					/></svg
				>
			</button>
		{/if}
	</div>
</div>

<div class="filter-bar">
	<div class="filter-group">
		<label class="filter-label" for="video-type">Type</label>
		<select id="video-type" class="filter-select" bind:value={videoType}>
			<option value="all">All types</option>
			<option value="regular">Regular</option>
			<option value="short">Short</option>
			<option value="stream">Stream</option>
		</select>
	</div>
	<div class="filter-group">
		<label class="filter-label" for="storage-pool">Storage</label>
		<select id="storage-pool" class="filter-select" bind:value={storagePool}>
			<option value="all">All storage</option>
			<option value="cache">Cache</option>
			<option value="library">Library</option>
		</select>
	</div>
	<div class="filter-group filter-group-grow">
		<label class="filter-label" for="uploader-filter">Uploader</label>
		<input
			id="uploader-filter"
			type="text"
			class="filter-input"
			placeholder="Filter by uploader..."
			bind:value={uploaderFilter}
		/>
	</div>
</div>

{#if loading}
	<div class="status-message">
		<div class="spinner"></div>
		<span>Searching...</span>
	</div>
{:else if searched && results.length === 0}
	<EmptyState
		title={query ? `No results found for "${query}"` : 'No results found'}
		description="Try different keywords, check your spelling, or adjust the filters above."
		actionLabel="Clear search and filters"
		onAction={clearSearchFilters}
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
				<circle cx="11" cy="11" r="8" />
				<line x1="21" y1="21" x2="16.65" y2="16.65" />
				<line x1="8" y1="8" x2="14" y2="14" />
				<line x1="14" y1="8" x2="8" y2="14" />
			</svg>
		{/snippet}
	</EmptyState>
{:else if searched}
	<div class="results-header">
		<span class="results-count">{total} result{total !== 1 ? 's' : ''}</span>
	</div>
	<div class="results-grid">
		{#each results as result (result.id)}
			<button
				type="button"
				class="result-card"
				aria-label="Open {result.title || 'Untitled'}{result.uploader
					? ` by ${result.uploader}`
					: ''}"
				onclick={() => navigateToDownload(result.id)}
			>
				{#if result.thumbnail}
					<div class="result-thumbnail">
						<img src={result.thumbnail} alt={result.title || 'Thumbnail'} />
						{#if result.duration}
							<span class="duration-badge" aria-label="Duration {formatDuration(result.duration)}"
								>{formatDuration(result.duration)}</span
							>
						{/if}
					</div>
				{:else}
					<div class="result-thumbnail no-thumb" aria-hidden="true">
						<svg
							width="32"
							height="32"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
						>
							<rect x="2" y="2" width="20" height="20" rx="2" />
							<path d="M10 9l5 3-5 3V9z" fill="currentColor" stroke="none" />
						</svg>
						{#if result.duration}
							<span class="duration-badge" aria-label="Duration {formatDuration(result.duration)}"
								>{formatDuration(result.duration)}</span
							>
						{/if}
					</div>
				{/if}
				<div class="result-content">
					<h3 class="result-title">{result.title || 'Untitled'}</h3>
					{#if result.uploader}
						<p class="result-uploader">{result.uploader}</p>
					{/if}
					<div class="result-badges">
						{#if result.videoType}
							<span class="badge badge-type">{result.videoType}</span>
						{/if}
						<span
							class="badge"
							class:badge-library={result.storagePool === 'library'}
							class:badge-cache={result.storagePool === 'cache'}
						>
							{result.storagePool === 'library' ? 'Library' : 'Cache'}
						</span>
						{#if result.filesize}
							<span class="badge badge-meta">{formatBytes(result.filesize)}</span>
						{/if}
					</div>
				</div>
			</button>
		{/each}
	</div>
{:else}
	<EmptyState
		title="Search your downloads"
		description="Find videos by title, description, or uploader across your cache and library."
		actionLabel="Start typing"
		onAction={focusSearch}
		size="lg"
	>
		{#snippet icon()}
			<svg
				width="32"
				height="32"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<circle cx="11" cy="11" r="8" />
				<line x1="21" y1="21" x2="16.65" y2="16.65" />
			</svg>
		{/snippet}
	</EmptyState>
{/if}

<style>
	.search-header {
		margin-bottom: var(--spacing-xl);
	}

	.search-bar {
		position: relative;
		display: flex;
		align-items: center;
	}

	.search-icon {
		position: absolute;
		left: var(--spacing-lg);
		color: var(--color-text-tertiary);
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		padding: var(--spacing-md) var(--spacing-lg) var(--spacing-md) calc(var(--spacing-lg) + 28px);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		color: var(--color-text-primary);
		font-size: var(--font-size-sm);
		transition: border-color var(--transition-fast);
	}

	.search-input:focus {
		outline: none;
		border-color: var(--color-accent-primary);
		box-shadow: 0 0 0 3px var(--color-focus-ring-search);
	}

	.search-input::placeholder {
		color: var(--color-text-tertiary);
	}

	.search-clear {
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
	}

	.search-clear:hover {
		color: var(--color-text-primary);
		background: var(--color-overlay-hover);
	}

	.filter-bar {
		display: flex;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-xl);
		flex-wrap: wrap;
	}

	.filter-group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		min-width: 140px;
	}

	.filter-group-grow {
		flex: 1;
		min-width: 180px;
	}

	.filter-label {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-tertiary);
	}

	.filter-select,
	.filter-input {
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		color: var(--color-text-primary);
		font-size: 0.875rem;
		transition: border-color var(--transition-fast);
	}

	.filter-select:focus,
	.filter-input:focus {
		outline: none;
		border-color: var(--color-accent-primary);
	}

	.filter-select option {
		background: var(--color-bg-secondary);
		color: var(--color-text-primary);
	}

	.filter-input::placeholder {
		color: var(--color-text-tertiary);
	}

	.status-message {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-md);
		padding: var(--spacing-2xl) var(--spacing-xl);
		color: var(--color-text-secondary);
		text-align: center;
	}

	.spinner {
		width: 24px;
		height: 24px;
		border: 2px solid var(--color-border-default);
		border-top-color: var(--color-accent-primary);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.results-header {
		display: flex;
		align-items: center;
		margin-bottom: var(--spacing-md);
	}

	.results-count {
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		font-weight: 500;
	}

	.results-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(var(--grid-search-result-min-width), 1fr));
		gap: var(--spacing-lg);
		width: 100%;
	}

	.result-card {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		overflow: hidden;
		cursor: pointer;
		transition:
			transform var(--transition-normal),
			box-shadow var(--transition-normal),
			border-color var(--transition-normal);
		display: flex;
		flex-direction: column;
		padding: 0;
		text-align: left;
		font: inherit;
		color: inherit;
		width: 100%;
	}

	.result-card:hover {
		border-color: var(--color-border-translucent-hover);
		transform: translateY(-3px) scale(1.01);
		box-shadow:
			var(--shadow-lg),
			0 0 0 1px rgba(59, 130, 246, 0.06);
	}

	.result-card:focus-visible {
		outline: none;
		border-color: var(--color-accent-primary);
		box-shadow: 0 0 0 3px var(--color-focus-ring);
	}

	.result-thumbnail {
		width: 100%;
		height: 160px;
		background: var(--color-bg-tertiary);
		position: relative;
		overflow: hidden;
	}

	.result-thumbnail img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.result-thumbnail.no-thumb {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-tertiary);
	}

	.duration-badge {
		position: absolute;
		bottom: var(--spacing-sm);
		right: var(--spacing-sm);
		padding: 2px 6px;
		background: var(--color-overlay-heavy);
		border-radius: var(--radius-sm);
		font-size: 0.6875rem;
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-on-accent);
		font-family: var(--font-family-mono);
	}

	.result-content {
		padding: var(--spacing-md) var(--spacing-lg);
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.result-title {
		font-size: 0.9375rem;
		font-weight: 600;
		line-height: 1.4;
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		color: var(--color-text-primary);
	}

	.result-uploader {
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		margin: 0;
	}

	.result-badges {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-xs);
		margin-top: var(--spacing-xs);
	}

	.badge {
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		font-size: 0.625rem;
		font-weight: 600;
		background: var(--color-bg-tertiary);
		color: var(--color-text-secondary);
	}

	.badge-library {
		background: var(--color-status-success-bg);
		color: var(--color-status-success);
	}

	.badge-cache {
		background: var(--color-status-info-bg);
		color: var(--color-accent-primary);
	}

	.badge-type {
		text-transform: capitalize;
	}

	.badge-meta {
		font-family: monospace;
		letter-spacing: 0.02em;
	}

	@media (max-width: 768px) {
		.search-input {
			font-size: 1rem;
		}

		.filter-bar {
			flex-direction: column;
		}

		.filter-group {
			min-width: unset;
		}

		.results-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
