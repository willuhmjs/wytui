<script lang="ts">
	import { getToasts, removeToast } from '$lib/stores/toast.svelte';

	let toastState = getToasts();
	let expanded = $state<Set<string>>(new Set());

	function toggleDetails(id: string) {
		const next = new Set(expanded);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expanded = next;
	}
</script>

{#if toastState.list.length > 0}
	<div class="toast-container">
		{#each toastState.list as toast (toast.id)}
			<div class="toast toast-{toast.type}" class:has-progress={toast.progress !== undefined}>
				<div class="toast-row">
					<span class="toast-icon">
						{#if toast.progress !== undefined}
							<span class="toast-spinner" aria-hidden="true"></span>
						{:else if toast.type === 'success'}
							<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"
								><path
									fill-rule="evenodd"
									d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
									clip-rule="evenodd"
								/></svg
							>
						{:else if toast.type === 'error'}
							<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"
								><path
									fill-rule="evenodd"
									d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
									clip-rule="evenodd"
								/></svg
							>
						{:else}
							<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"
								><path
									fill-rule="evenodd"
									d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
									clip-rule="evenodd"
								/></svg
							>
						{/if}
					</span>
					<div class="toast-content">
						<span class="toast-message">{toast.message}</span>
						{#if toast.details && toast.details.length > 0}
							<button
								type="button"
								class="toast-details-toggle"
								aria-expanded={expanded.has(toast.id)}
								onclick={() => toggleDetails(toast.id)}
							>
								{expanded.has(toast.id) ? 'Hide' : 'Show'} details ({toast.details.length})
							</button>
						{/if}
					</div>
					{#if !toast.sticky}
						<button
							type="button"
							class="toast-close"
							aria-label="Dismiss"
							onclick={() => removeToast(toast.id)}
						>
							<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"
								><path
									d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
								/></svg
							>
						</button>
					{/if}
				</div>
				{#if toast.progress !== undefined}
					<div
						class="toast-progress"
						role="progressbar"
						aria-valuemin="0"
						aria-valuemax="100"
						aria-valuenow={toast.progress}
					>
						<div class="toast-progress-fill" style:width="{toast.progress}%"></div>
					</div>
				{/if}
				{#if toast.details && toast.details.length > 0 && expanded.has(toast.id)}
					<ul class="toast-details-list">
						{#each toast.details as detail}
							<li>{detail}</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<style>
	.toast-container {
		position: fixed;
		bottom: var(--spacing-xl);
		right: var(--spacing-xl);
		display: flex;
		flex-direction: column-reverse;
		gap: var(--spacing-sm);
		z-index: var(--z-toast);
		pointer-events: none;
	}

	.toast {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border-translucent);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-dropdown);
		color: var(--color-text-primary);
		font-size: var(--font-size-sm);
		pointer-events: auto;
		animation: toast-in 0.25s ease-out;
		max-width: 400px;
	}

	.toast-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.toast-content {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.toast-spinner {
		display: inline-block;
		width: 14px;
		height: 14px;
		border: 2px solid currentColor;
		border-top-color: transparent;
		border-radius: 50%;
		animation: toast-spin 0.7s linear infinite;
	}

	@keyframes toast-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.toast-progress {
		height: 4px;
		background: var(--color-bg-secondary);
		border-radius: var(--radius-full);
		overflow: hidden;
	}

	.toast-progress-fill {
		height: 100%;
		background: var(--color-accent-primary);
		border-radius: var(--radius-full);
		transition: width var(--transition-snappy);
	}

	.toast-info .toast-progress-fill {
		background: var(--color-accent-primary);
	}

	.toast-success .toast-progress-fill {
		background: var(--color-status-success);
	}

	.toast-error .toast-progress-fill {
		background: var(--color-status-error);
	}

	.toast-details-toggle {
		background: transparent;
		border: none;
		padding: 0;
		color: var(--color-text-secondary);
		font-size: var(--font-size-xs);
		cursor: pointer;
		text-align: left;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.toast-details-toggle:hover {
		color: var(--color-text-primary);
	}

	.toast-details-list {
		margin: 0;
		padding: var(--spacing-xs) 0 0 var(--spacing-md);
		list-style: disc;
		font-size: var(--font-size-xs);
		color: var(--color-text-secondary);
		max-height: 160px;
		overflow-y: auto;
	}

	.toast-details-list li {
		margin-bottom: 2px;
		line-height: var(--line-height-base);
	}

	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.toast-success {
		border-left: 3px solid var(--color-status-success);
	}

	.toast-success .toast-icon {
		color: var(--color-status-success);
	}

	.toast-error {
		border-left: 3px solid var(--color-status-error);
	}

	.toast-error .toast-icon {
		color: var(--color-status-error);
	}

	.toast-info {
		border-left: 3px solid var(--color-accent-primary);
	}

	.toast-info .toast-icon {
		color: var(--color-accent-primary);
	}

	.toast-icon {
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	.toast-message {
		flex: 1;
		line-height: 1.4;
	}

	.toast-close {
		display: flex;
		align-items: center;
		padding: 2px;
		background: transparent;
		border: none;
		color: var(--color-text-tertiary);
		cursor: pointer;
		flex-shrink: 0;
		border-radius: var(--radius-sm);
	}

	.toast-close:hover {
		color: var(--color-text-primary);
		background: var(--color-overlay-hover);
	}

	@media (max-width: 768px) {
		.toast-container {
			left: var(--spacing-md);
			right: var(--spacing-md);
			bottom: var(--spacing-md);
		}

		.toast {
			max-width: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.toast {
			animation: none;
			opacity: 1;
			transform: none;
		}

		.toast-spinner {
			animation: none;
		}

		.toast-progress-fill {
			transition: none;
		}
	}
</style>
