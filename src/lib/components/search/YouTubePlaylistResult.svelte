<script lang="ts">
	interface PlaylistResult {
		type: 'playlist';
		id: string;
		title: string;
		url: string;
		thumbnail?: string;
		uploader?: string;
		channelId?: string;
	}

	interface Props {
		result: PlaylistResult;
		onImport: (result: PlaylistResult) => void;
		busy: boolean;
		disabled: boolean;
	}

	let { result, onImport, busy, disabled }: Props = $props();
</script>

<div class="row">
	{#if result.thumbnail}
		<img class="thumb" src={result.thumbnail} alt="" loading="lazy" />
	{:else}
		<div class="thumb thumb-empty"></div>
	{/if}

	<div class="body">
		<a class="title" href={result.url} target="_blank" rel="noopener noreferrer">
			{result.title}
		</a>
		{#if result.uploader}
			<div class="meta">{result.uploader}</div>
		{/if}
		<!-- Video count is deliberately absent: yt-dlp's flat output does not
		     carry it, and fetching it would cost one extra yt-dlp run per row. -->
	</div>

	<div class="actions">
		<button class="btn-row" onclick={() => onImport(result)} disabled={busy || disabled}>
			{busy ? '...' : '+ Import'}
		</button>
	</div>
</div>

<style>
	.row {
		display: grid;
		grid-template-columns: 168px 1fr auto;
		gap: 0.75rem;
		align-items: center;
		padding: 0.75rem;
		border-radius: 8px;
	}
	.row:hover {
		background: var(--color-bg-hover);
	}
	.thumb {
		width: 168px;
		aspect-ratio: 16 / 9;
		object-fit: cover;
		border-radius: 6px;
		display: block;
	}
	.thumb-empty {
		background: var(--color-bg-secondary);
	}
	.body {
		min-width: 0;
	}
	.title {
		font-weight: 500;
		color: var(--color-text-primary);
		text-decoration: none;
	}
	.title:hover {
		text-decoration: underline;
	}
	.meta {
		margin-top: 0.2rem;
		font-size: 0.82rem;
		color: var(--color-text-secondary);
	}
	.btn-row {
		padding: 0.35rem 0.7rem;
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		background: var(--color-bg-secondary);
		color: var(--color-text-primary);
		font-size: 0.82rem;
		white-space: nowrap;
		cursor: pointer;
	}
	.btn-row:hover:not(:disabled) {
		background: var(--color-bg-hover);
	}
	.btn-row:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
</style>
