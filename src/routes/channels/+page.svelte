<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import ViewToggle from '$lib/components/ui/ViewToggle.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ErrorMessage from '$lib/components/ui/ErrorMessage.svelte';
	import FilterDropdown from '$lib/components/ui/FilterDropdown.svelte';

	type Channel = { name: string; count: number; thumbnail: string | null };

	const CHANNELS_PAGE_SIZE = 60;

	let channels = $state<Channel[]>([]);
	let loading = $state(true);
	let loadingMore = $state(false);
	let error = $state<string | null>(null);
	let viewMode = $state<'grid' | 'list'>('grid');
	let search = $state('');
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	let offset = $state(0);
	let hasMore = $state(false);
	let channelsSort = $state<'name' | 'count'>('name');

	let visibleChannels = $derived.by(() => {
		const sorted = [...channels];
		if (channelsSort === 'count') {
			sorted.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
		} else {
			sorted.sort((a, b) => a.name.localeCompare(b.name));
		}
		return sorted;
	});

	onMount(() => loadChannels());

	async function loadChannels(q = search) {
		// Fresh load: reset pagination and replace results.
		loading = true;
		error = null;
		offset = 0;
		try {
			const params = new URLSearchParams({ limit: String(CHANNELS_PAGE_SIZE), offset: '0' });
			if (q) params.set('q', q);
			const res = await fetch(`/api/channels?${params}`);
			if (res.ok) {
				const page: Channel[] = await res.json();
				channels = page;
				offset = page.length;
				hasMore = page.length === CHANNELS_PAGE_SIZE;
			} else {
				error = `Failed to load channels (${res.status})`;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load channels';
		} finally {
			loading = false;
		}
	}

	async function loadMoreChannels() {
		if (loadingMore || !hasMore) return;
		loadingMore = true;
		try {
			const params = new URLSearchParams({
				limit: String(CHANNELS_PAGE_SIZE),
				offset: String(offset),
			});
			if (search) params.set('q', search);
			const res = await fetch(`/api/channels?${params}`);
			if (res.ok) {
				const page: Channel[] = await res.json();
				channels = [...channels, ...page];
				offset += page.length;
				hasMore = page.length === CHANNELS_PAGE_SIZE;
			}
		} catch (e) {
			console.error('Failed to load more channels:', e);
		} finally {
			loadingMore = false;
		}
	}

	function handleSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => loadChannels(search), 300);
	}

	function goToChannel(name: string) {
		goto(`/channels/${encodeURIComponent(name)}`);
	}
</script>

<svelte:head>
	<title>Channels - wytui</title>
</svelte:head>

<div class="page">
	<div class="page-header">
		<h1>Channels</h1>
		<div class="header-right">
			<input
				class="search-input"
				type="search"
				placeholder="Search channels…"
				bind:value={search}
				oninput={handleSearchInput}
			/>
			<FilterDropdown
				label="Sort channels"
				bind:value={channelsSort}
				options={[
					{ value: 'name', label: 'Name A–Z' },
					{ value: 'count', label: 'Most videos' },
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
			<ViewToggle bind:view={viewMode} />
		</div>
	</div>

	{#if error && channels.length > 0}
		<ErrorMessage {error} onRetry={() => loadChannels()} />
	{/if}

	{#if loading && channels.length === 0}
		<Skeleton count={12} variant="card" />
	{:else if error && channels.length === 0}
		<ErrorMessage {error} onRetry={() => loadChannels()} />
	{:else if channels.length === 0}
		<EmptyState title={search ? 'No channels match your search' : 'No completed downloads yet'} />
	{:else if viewMode === 'list'}
		<div class="channels-list">
			{#each visibleChannels as channel (channel.name)}
				<button class="channel-list-row" onclick={() => goToChannel(channel.name)}>
					<div class="channel-list-avatar">
						{#if channel.thumbnail}
							<img src={channel.thumbnail} alt={channel.name} class="avatar-img" />
						{:else}
							<div class="avatar-placeholder small">
								{channel.name.slice(0, 2).toUpperCase()}
							</div>
						{/if}
					</div>
					<span class="channel-list-name">{channel.name}</span>
					<span class="channel-list-count"
						>{channel.count} video{channel.count !== 1 ? 's' : ''}</span
					>
				</button>
			{/each}
		</div>
	{:else}
		<div class="channels-grid">
			{#each visibleChannels as channel (channel.name)}
				<button class="channel-card" onclick={() => goToChannel(channel.name)}>
					<div class="channel-avatar">
						{#if channel.thumbnail}
							<img src={channel.thumbnail} alt={channel.name} class="avatar-img" />
						{:else}
							<div class="avatar-placeholder">
								{channel.name.slice(0, 2).toUpperCase()}
							</div>
						{/if}
					</div>
					<div class="channel-info">
						<p class="channel-name">{channel.name}</p>
						<p class="channel-count">{channel.count} video{channel.count !== 1 ? 's' : ''}</p>
					</div>
				</button>
			{/each}
		</div>
	{/if}

	{#if !loading && !error && hasMore}
		<div class="load-more-row">
			<button class="btn btn-secondary" onclick={loadMoreChannels} disabled={loadingMore}>
				{loadingMore ? 'Loading…' : 'Load More'}
			</button>
		</div>
	{/if}
</div>

<style>
	.page {
		max-width: 1200px;
		margin: 0 auto;
	}

	.load-more-row {
		display: flex;
		justify-content: center;
		margin-top: var(--spacing-xl);
	}

	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-lg);
		margin-bottom: var(--spacing-xl);
		flex-wrap: wrap;
	}

	.page-header h1 {
		font-size: 1.5rem;
		font-weight: 700;
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.search-input {
		width: 220px;
		max-width: 100%;
	}

	.channels-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.channel-list-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		cursor: pointer;
		text-align: left;
		color: inherit;
		font: inherit;
		min-height: unset;
		transition: border-color var(--transition-fast);
	}

	.channel-list-row:hover {
		border-color: var(--color-border-subtle);
		background: var(--color-bg-hover);
	}

	.channel-list-avatar {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		overflow: hidden;
		flex-shrink: 0;
	}

	.channel-list-name {
		flex: 1;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.channel-list-count {
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		flex-shrink: 0;
	}

	.avatar-placeholder.small {
		font-size: 0.875rem;
	}

	.channels-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: var(--spacing-md);
	}

	.channel-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--spacing-md);
		padding: var(--spacing-lg);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		cursor: pointer;
		text-align: center;
		transition:
			transform var(--transition-normal),
			box-shadow var(--transition-normal),
			border-color var(--transition-normal),
			background var(--transition-normal);
		min-height: unset;
		min-width: unset;
		color: inherit;
		font: inherit;
	}

	.channel-card:hover {
		border-color: var(--color-border-translucent-hover);
		background: var(--color-bg-tertiary);
		transform: translateY(-3px);
		box-shadow:
			var(--shadow-lg),
			0 0 0 1px rgba(59, 130, 246, 0.06);
	}

	.channel-avatar {
		width: 72px;
		height: 72px;
		border-radius: 50%;
		overflow: hidden;
		flex-shrink: 0;
	}

	.avatar-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.avatar-placeholder {
		width: 100%;
		height: 100%;
		background: var(--color-accent-primary);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.5rem;
		font-weight: 700;
		color: white;
	}

	.channel-info {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.channel-name {
		font-size: 0.9375rem;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 150px;
	}

	.channel-count {
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	@media (max-width: 640px) {
		.channels-grid {
			grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		}
	}
</style>
