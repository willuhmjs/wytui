<script lang="ts">
	import { formatDuration, formatCount } from '$lib/utils/format';

	interface VideoResult {
		type: 'video';
		id: string;
		title: string;
		url: string;
		uploader?: string;
		channelId?: string;
		channelUrl?: string;
		thumbnail?: string;
		duration?: number;
		viewCount?: number;
		verified: boolean;
		description?: string;
		existingDownload: { id: string; status: string } | null;
	}

	interface Props {
		result: VideoResult;
		selected: boolean;
		onToggle: (id: string) => void;
		onDownload: (result: VideoResult) => void;
		busy: boolean;
		disabled: boolean;
	}

	let { result, selected, onToggle, onDownload, busy, disabled }: Props = $props();
</script>

<div class="row" class:selected>
	<input
		type="checkbox"
		class="row-check"
		checked={selected}
		onchange={() => onToggle(result.id)}
		aria-label="Select {result.title}"
	/>

	<div class="thumb-wrap">
		{#if result.thumbnail}
			<img class="thumb" src={result.thumbnail} alt="" loading="lazy" />
		{:else}
			<div class="thumb thumb-empty"></div>
		{/if}
		{#if result.duration}
			<span class="duration">{formatDuration(result.duration)}</span>
		{/if}
	</div>

	<div class="body">
		<a class="title" href={result.url} target="_blank" rel="noopener noreferrer">
			{result.title}
		</a>
		<div class="meta">
			{#if result.uploader}
				<span class="uploader">
					{result.uploader}{#if result.verified}<span class="verified" title="Verified">✓</span
						>{/if}
				</span>
			{/if}
			{#if result.viewCount}
				<span class="dot">·</span><span>{formatCount(result.viewCount)} views</span>
			{/if}
		</div>
		{#if result.description}
			<p class="desc">{result.description}</p>
		{/if}
	</div>

	<div class="actions">
		{#if result.existingDownload}
			<a class="downloaded" href="/downloads/{result.existingDownload.id}">✓ Downloaded</a>
		{:else}
			<button class="btn-row" onclick={() => onDownload(result)} disabled={busy || disabled}>
				{busy ? '...' : '↓ Download'}
			</button>
		{/if}
	</div>
</div>

<style>
	.row {
		display: grid;
		grid-template-columns: auto 168px 1fr auto;
		gap: 0.75rem;
		align-items: start;
		padding: 0.75rem;
		border-radius: 8px;
	}
	.row:hover {
		background: var(--color-bg-hover);
	}
	.row.selected {
		background: var(--color-bg-hover);
	}
	.row-check {
		margin-top: 0.4rem;
		cursor: pointer;
	}
	.thumb-wrap {
		position: relative;
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
	.duration {
		position: absolute;
		right: 4px;
		bottom: 4px;
		padding: 1px 4px;
		border-radius: 3px;
		background: rgba(0, 0, 0, 0.8);
		color: #fff;
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
	}
	.body {
		min-width: 0;
	}
	.title {
		display: block;
		font-weight: 500;
		color: var(--color-text-primary);
		text-decoration: none;
		line-height: 1.35;
	}
	.title:hover {
		text-decoration: underline;
	}
	.meta {
		margin-top: 0.25rem;
		font-size: 0.82rem;
		color: var(--color-text-secondary);
	}
	.verified {
		margin-left: 0.2rem;
	}
	.dot {
		margin: 0 0.35rem;
	}
	.desc {
		margin: 0.35rem 0 0;
		font-size: 0.8rem;
		color: var(--color-text-secondary);
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}
	.actions {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		align-items: flex-end;
	}
	.downloaded {
		font-size: 0.8rem;
		color: var(--color-status-success);
		text-decoration: none;
		white-space: nowrap;
	}
	.downloaded:hover {
		text-decoration: underline;
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
