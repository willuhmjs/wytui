<script lang="ts">
	import DownloadCard from '$lib/components/download/DownloadCard.svelte';
	import ViewToggle from '$lib/components/ui/ViewToggle.svelte';
	import DownloadListRow from '$lib/components/download/DownloadListRow.svelte';
	let { data }: { data: any } = $props();
	let viewMode = $state<'grid' | 'list'>('grid');
	let sortOption = $state<'newest' | 'oldest' | 'largest' | 'smallest' | 'longest' | 'shortest'>(
		'newest',
	);

	let sortedDownloads = $derived.by(() => {
		const sorted = [...data.downloads];
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
		}
		return sorted;
	});
</script>

<svelte:head>
	<title>{data.channelName} - wytui</title>
</svelte:head>

<div class="page">
	<a href="/channels" class="back-link">
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
			<path
				d="M10 3L5 8L10 13"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
		Back to Channels
	</a>

	<div class="channel-header">
		<div class="channel-avatar">
			{#if data.channelThumbnail}
				<img src={data.channelThumbnail} alt={data.channelName} class="avatar-img" />
			{:else}
				<div class="avatar-placeholder">
					{data.channelName.slice(0, 2).toUpperCase()}
				</div>
			{/if}
		</div>
		<div class="channel-info">
			<h1>{data.channelName}</h1>
			<p class="channel-count">
				{data.downloads.length} video{data.downloads.length !== 1 ? 's' : ''}
			</p>
		</div>
	</div>

	<div class="section">
		<div class="section-header">
			<div class="section-header-left">
				<h2>Videos ({sortedDownloads.length})</h2>
				<ViewToggle bind:view={viewMode} />
			</div>
			<div class="section-header-right">
				<div class="sort-dropdown">
					<select class="sort-select" bind:value={sortOption}>
						<option value="newest">Newest first</option>
						<option value="oldest">Oldest first</option>
						<option value="largest">Largest first</option>
						<option value="smallest">Smallest first</option>
						<option value="longest">Longest first</option>
						<option value="shortest">Shortest first</option>
					</select>
				</div>
			</div>
		</div>

		{#if viewMode === 'grid'}
			<div class="downloads-grid">
				{#each sortedDownloads as download (download.id)}
					<DownloadCard {download} />
				{/each}
			</div>
		{:else}
			<div class="downloads-list">
				{#each sortedDownloads as download (download.id)}
					<DownloadListRow
						{download}
						onclick={() => {
							if (download.status === 'COMPLETED')
								window.location.href = `/downloads/${download.id}`;
						}}
					/>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.page {
		max-width: 1400px;
		margin: 0 auto;
		width: 100%;
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		color: var(--color-text-secondary);
		text-decoration: none;
		font-size: 0.875rem;
		margin-bottom: var(--spacing-xl);
		transition: color var(--transition-fast);
	}

	.back-link:hover {
		color: var(--color-text-primary);
	}

	.channel-header {
		display: flex;
		align-items: center;
		gap: var(--spacing-lg);
		margin-bottom: var(--spacing-2xl);
	}

	.channel-avatar {
		width: 80px;
		height: 80px;
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
		font-size: 1.75rem;
		font-weight: 700;
		color: white;
	}

	.channel-info h1 {
		font-size: 1.5rem;
		font-weight: 700;
		margin-bottom: 4px;
	}

	.channel-count {
		font-size: 0.9375rem;
		color: var(--color-text-secondary);
	}

	.section {
		margin-bottom: var(--spacing-xl);
		width: 100%;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-lg);
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

	.section-header h2 {
		margin: 0;
		line-height: 1;
		font-size: 1.25rem;
	}

	.sort-select {
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-overlay-white-10);
		border-radius: var(--radius-md);
		color: var(--color-text-primary);
		font-size: 0.8125rem;
		cursor: pointer;
	}

	.downloads-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
		gap: var(--spacing-lg);
		width: 100%;
	}

	.downloads-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		width: 100%;
	}

	@media (max-width: 768px) {
		.channel-header {
			flex-direction: column;
			text-align: center;
		}

		.downloads-grid {
			grid-template-columns: 1fr;
		}

		.section-header {
			flex-direction: column;
			align-items: stretch;
		}

		.section-header-left {
			justify-content: space-between;
		}
	}
</style>
