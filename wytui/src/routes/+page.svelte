<script lang="ts">
	import DownloadForm from '$lib/components/download/DownloadForm.svelte';
	import DownloadCard from '$lib/components/download/DownloadCard.svelte';
	import { getSSEState } from '$lib/stores/sse.svelte';

	let sseState = getSSEState();
</script>

<svelte:head>
	<title>wytui - YouTube Downloader</title>
</svelte:head>

<div class="page">
	<div class="page-header">
		<h1>Downloads</h1>
		<div class="status">
			{#if sseState.connected}
				<span class="status-indicator connected"></span>
				<span class="status-text">Connected</span>
			{:else}
				<span class="status-indicator disconnected"></span>
				<span class="status-text">Connecting...</span>
			{/if}
		</div>
	</div>

	<div class="layout">
		<div class="form-section">
			<DownloadForm />
		</div>

		<div class="downloads-section">
			<h2>Downloads ({sseState.downloads.length})</h2>

			{#if sseState.downloads.length === 0}
				<div class="empty-state">
					<p>No downloads</p>
					<p class="text-muted">Paste a URL above to get started</p>
				</div>
			{:else}
				<div class="downloads-grid">
					{#each sseState.downloads as download (download.id)}
						<DownloadCard {download} />
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.page {
		max-width: 1400px;
		margin: 0 auto;
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-xl);
	}

	.status {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.status-indicator {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}

	.status-indicator.connected {
		background: var(--success);
		animation: pulse 2s infinite;
	}

	.status-indicator.disconnected {
		background: var(--error);
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}

	.status-text {
		font-size: 0.875rem;
		color: var(--text-secondary);
	}

	.layout {
		display: grid;
		gap: var(--spacing-2xl);
	}

	.form-section {
		position: sticky;
		top: calc(60px + var(--spacing-md));
		align-self: start;
	}

	.downloads-section h2 {
		margin-bottom: var(--spacing-lg);
	}

	.empty-state {
		text-align: center;
		padding: var(--spacing-2xl);
		background: var(--bg-secondary);
		border: 1px dashed var(--border);
		border-radius: var(--radius-lg);
	}

	.empty-state p {
		margin-bottom: var(--spacing-sm);
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
