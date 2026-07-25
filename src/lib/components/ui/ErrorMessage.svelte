<script lang="ts">
	import XIcon from '$lib/components/icons/XIcon.svelte';
	import type { FetchError } from '$lib/utils/fetch';

	interface Props {
		error: FetchError | string | null;
		onRetry?: () => void;
		onDismiss?: () => void;
		retryLabel?: string;
		compact?: boolean;
	}

	let { error, onRetry, onDismiss, retryLabel = 'Retry', compact = false }: Props = $props();

	let message = $derived(typeof error === 'string' ? error : (error?.message ?? ''));
	let canRetry = $derived(
		typeof error === 'object' && error !== null ? error.canRetry && !!onRetry : !!onRetry,
	);
	let errorType = $derived(typeof error === 'object' && error !== null ? error.type : 'unknown');
</script>

{#if error}
	<div
		class="error-message"
		class:compact
		role="alert"
		aria-live="polite"
		data-error-type={errorType}
	>
		<span class="icon" aria-hidden="true">
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				width="20"
				height="20"
			>
				<circle cx="12" cy="12" r="10" />
				<line x1="12" y1="8" x2="12" y2="12" />
				<line x1="12" y1="16" x2="12.01" y2="16" />
			</svg>
		</span>
		<span class="text">{message}</span>
		{#if canRetry}
			<button type="button" class="retry-btn" onclick={onRetry}>
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					width="14"
					height="14"
					aria-hidden="true"
				>
					<polyline points="23 4 23 10 17 10" />
					<polyline points="1 20 1 14 7 14" />
					<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
				</svg>
				{retryLabel}
			</button>
		{/if}
		{#if onDismiss}
			<button type="button" class="dismiss-btn" aria-label="Dismiss error" onclick={onDismiss}>
				<XIcon width={14} height={14} />
			</button>
		{/if}
	</div>
{/if}

<style>
	.error-message {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-status-error-bg);
		border: 1px solid var(--color-status-error);
		border-left-width: 3px;
		border-radius: var(--radius-md);
		color: var(--color-text-primary);
		font-size: var(--font-size-sm);
		line-height: var(--line-height-base);
		animation: error-in var(--transition-normal);
	}

	.error-message.compact {
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: var(--font-size-xs);
	}

	@keyframes error-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.icon {
		display: inline-flex;
		align-items: center;
		color: var(--color-status-error);
		flex-shrink: 0;
	}

	.text {
		flex: 1;
		min-width: 0;
	}

	.retry-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		padding: var(--spacing-xs) var(--spacing-sm);
		background: transparent;
		border: 1px solid var(--color-status-error);
		border-radius: var(--radius-sm);
		color: var(--color-status-error);
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
		transition:
			background var(--transition-fast),
			color var(--transition-fast);
		flex-shrink: 0;
	}

	.retry-btn:hover {
		background: var(--color-status-error);
		color: var(--color-text-on-accent);
	}

	.retry-btn:focus-visible {
		outline: none;
		box-shadow: 0 0 0 3px var(--color-focus-ring);
	}

	.dismiss-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 2px;
		background: transparent;
		border: none;
		color: var(--color-text-tertiary);
		cursor: pointer;
		border-radius: var(--radius-sm);
		flex-shrink: 0;
		transition:
			color var(--transition-fast),
			background var(--transition-fast);
	}

	.dismiss-btn:hover {
		color: var(--color-text-primary);
		background: var(--color-overlay-hover);
	}

	.dismiss-btn:focus-visible {
		outline: none;
		box-shadow: 0 0 0 3px var(--color-focus-ring);
	}

	@media (prefers-reduced-motion: reduce) {
		.error-message {
			animation: none;
			opacity: 1;
			transform: none;
		}
	}
</style>
