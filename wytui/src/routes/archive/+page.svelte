<script lang="ts">
	import { onMount } from 'svelte';
	import DownloadCard from '$lib/components/download/DownloadCard.svelte';
	import { getSSEState } from '$lib/stores/sse.svelte';

	let downloads = $state<any[]>([]);
	let loading = $state(true);
	let sseState = getSSEState();

	onMount(async () => {
		await loadArchive();

		// Listen for download events via SSE
		const eventSource = new EventSource('/api/sse');

		eventSource.addEventListener('download:deleted', (e) => {
			const { id } = JSON.parse(e.data);
			console.log('[Archive] Download deleted:', id);
			// Remove from archive list
			downloads = downloads.filter((d) => d.id !== id);
		});

		eventSource.addEventListener('download:complete', (e) => {
			const { download } = JSON.parse(e.data);
			console.log('[Archive] Download completed:', download.id);
			// Add to archive list
			const exists = downloads.find((d) => d.id === download.id);
			if (!exists) {
				downloads = [download, ...downloads];
			}
		});

		return () => {
			eventSource.close();
		};
	});

	async function loadArchive() {
		loading = true;
		try {
			const res = await fetch('/api/downloads?status=COMPLETED&limit=50');
			if (res.ok) {
				downloads = await res.json();
			}
		} catch (e) {
			console.error('Failed to load archive:', e);
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Archive - wytui</title>
</svelte:head>

<div class="page">
	<div class="page-header">
		<h1>Archive</h1>
		<p class="text-muted">Completed downloads</p>
	</div>

	{#if loading}
		<div class="loading">Loading...</div>
	{:else if downloads.length === 0}
		<div class="empty-state">
			<p>No completed downloads yet</p>
			<a href="/" class="btn btn-primary">Start Downloading</a>
		</div>
	{:else}
		<div class="downloads-grid">
			{#each downloads as download (download.id)}
				<DownloadCard {download} />
			{/each}
		</div>
	{/if}
</div>

<style>
	.page-header {
		margin-bottom: var(--spacing-xl);
	}

	.page-header p {
		margin-top: var(--spacing-sm);
	}

	.loading {
		text-align: center;
		padding: var(--spacing-2xl);
		color: var(--text-secondary);
	}

	.empty-state {
		text-align: center;
		padding: var(--spacing-2xl);
		background: var(--bg-secondary);
		border: 1px dashed var(--border);
		border-radius: var(--radius-lg);
	}

	.empty-state p {
		margin-bottom: var(--spacing-lg);
	}

	.downloads-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
		gap: var(--spacing-lg);
	}

	@media (max-width: 768px) {
		.downloads-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
