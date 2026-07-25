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
		max-width: var(--container-max-width);
		margin: 0 auto;
		width: 100%;
	}

	h1 {
		margin-bottom: var(--spacing-lg);
	}

	.tabs {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid var(--color-border-default);
		margin-bottom: 1.25rem;
	}

	.tab {
		padding: 0.6rem 1.1rem;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--color-text-secondary);
		font-size: 0.9rem;
		font-weight: 500;
		cursor: pointer;
		transition:
			color 0.15s,
			border-color 0.15s;
	}

	.tab:hover {
		color: var(--color-text-primary);
	}

	.tab.active {
		color: var(--color-accent-primary);
		border-bottom-color: var(--color-accent-primary);
	}
</style>
