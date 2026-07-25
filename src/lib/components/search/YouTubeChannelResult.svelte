<script lang="ts">
	import { formatCount } from '$lib/utils/format';

	interface ChannelResult {
		type: 'channel';
		id: string;
		title: string;
		url: string;
		thumbnail?: string;
		subscriberCount?: number;
		description?: string;
	}

	interface Props {
		result: ChannelResult;
		onSubscribe: (result: ChannelResult) => void;
		busy: boolean;
		disabled: boolean;
	}

	let { result, onSubscribe, busy, disabled }: Props = $props();
</script>

<div class="row">
	{#if result.thumbnail}
		<img class="avatar" src={result.thumbnail} alt="" loading="lazy" />
	{:else}
		<div class="avatar avatar-empty"></div>
	{/if}

	<div class="body">
		<a class="title" href={result.url} target="_blank" rel="noopener noreferrer">
			{result.title.trim()}
		</a>
		{#if result.subscriberCount}
			<div class="meta">{formatCount(result.subscriberCount)} subscribers</div>
		{/if}
		{#if result.description}
			<p class="desc">{result.description}</p>
		{/if}
	</div>

	<div class="actions">
		<button class="btn-row" onclick={() => onSubscribe(result)} disabled={busy || disabled}>
			{busy ? '...' : '+ Subscribe'}
		</button>
	</div>
</div>

<style>
	.row {
		display: grid;
		grid-template-columns: 88px 1fr auto;
		gap: 0.75rem;
		align-items: center;
		padding: 0.75rem;
		border-radius: 8px;
	}
	.row:hover {
		background: var(--color-bg-hover);
	}
	.avatar {
		width: 88px;
		height: 88px;
		border-radius: 50%;
		object-fit: cover;
		display: block;
	}
	.avatar-empty {
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
