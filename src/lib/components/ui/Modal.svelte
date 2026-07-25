<script lang="ts">
	import { getModalState } from '$lib/stores/modal.svelte';
	import { trapFocus, uniqueId } from '$lib/utils/a11y';

	let modalState = getModalState();

	const titleId = uniqueId('modal-title');
	const bodyId = uniqueId('modal-body');

	let dialogEl: HTMLDivElement | null = $state(null);

	$effect(() => {
		if (modalState.isOpen && dialogEl) {
			const release = trapFocus(dialogEl);
			return release;
		}
	});

	function handleOverlayClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			modalState.cancel();
		}
	}

	function handleDialogKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			modalState.cancel();
		}
	}
</script>

{#if modalState.isOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={handleOverlayClick}>
		<div
			bind:this={dialogEl}
			class="modal"
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
			aria-describedby={bodyId}
			tabindex="-1"
			onkeydown={handleDialogKeydown}
		>
			<div class="modal-header">
				<h3 id={titleId}>{modalState.title}</h3>
			</div>
			<div class="modal-body" id={bodyId}>
				<p>{modalState.message}</p>
			</div>
			<div class="modal-footer">
				{#if modalState.type === 'confirm'}
					<button class="btn btn-secondary" onclick={modalState.cancel}>
						{modalState.cancelText}
					</button>
				{/if}
				<button class="btn btn-primary" onclick={modalState.confirm}>
					{modalState.confirmText}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: var(--color-overlay-medium);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: var(--z-modal);
		animation: fadeIn var(--transition-fast);
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.modal {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		max-width: var(--modal-max-width);
		width: 90%;
		box-shadow: var(--shadow-xl);
		animation: slideUp 200ms ease;
		outline: none;
	}

	.modal:focus-visible {
		box-shadow:
			var(--shadow-xl),
			0 0 0 3px var(--color-focus-ring);
	}

	@keyframes slideUp {
		from {
			transform: translateY(20px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	.modal-header {
		padding: var(--spacing-lg);
		border-bottom: 1px solid var(--color-border-default);
	}

	.modal-header h3 {
		margin: 0;
		font-size: var(--font-size-xl);
		color: var(--color-text-primary);
	}

	.modal-body {
		padding: var(--spacing-lg);
	}

	.modal-body p {
		margin: 0;
		color: var(--color-text-secondary);
		line-height: var(--line-height-relaxed);
	}

	.modal-footer {
		padding: var(--spacing-lg);
		border-top: 1px solid var(--color-border-default);
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-md);
	}

	/* Buttons use the global .btn / .btn-primary / .btn-secondary styles from app.css
	   for consistency with the rest of the app (gradient primary, etc.). */

	@media (max-width: 768px) {
		.modal {
			width: 95%;
		}

		.modal-header,
		.modal-body,
		.modal-footer {
			padding: var(--spacing-md);
		}

		.modal-footer {
			flex-direction: column-reverse;
		}

		.modal-footer button {
			width: 100%;
		}
	}
</style>
