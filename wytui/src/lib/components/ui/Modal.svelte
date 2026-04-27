<script lang="ts">
	import { getModalState } from '$lib/stores/modal.svelte';

	let modalState = getModalState();

	function handleOverlayKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			modalState.cancel();
		}
	}

	function handleModalKeydown(e: KeyboardEvent) {
		e.stopPropagation();
	}
</script>

{#if modalState.isOpen}
	<div class="modal-overlay" onclick={modalState.cancel} onkeydown={handleOverlayKeydown} role="button" tabindex="0">
		<div class="modal" onclick={(e) => e.stopPropagation()} onkeydown={handleModalKeydown} role="dialog" aria-modal="true" tabindex="-1">
			<div class="modal-header">
				<h3>{modalState.title}</h3>
			</div>
			<div class="modal-body">
				<p>{modalState.message}</p>
			</div>
			<div class="modal-footer">
				{#if modalState.type === 'confirm'}
					<button class="btn-secondary" onclick={modalState.cancel}>
						{modalState.cancelText}
					</button>
				{/if}
				<button class="btn-primary" onclick={modalState.confirm}>
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
		background: rgba(0, 0, 0, 0.7);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		animation: fadeIn 150ms ease;
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
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		max-width: 500px;
		width: 90%;
		box-shadow: var(--shadow-xl);
		animation: slideUp 200ms ease;
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
		border-bottom: 1px solid var(--border);
	}

	.modal-header h3 {
		margin: 0;
		font-size: 1.25rem;
		color: var(--text-primary);
	}

	.modal-body {
		padding: var(--spacing-lg);
	}

	.modal-body p {
		margin: 0;
		color: var(--text-secondary);
		line-height: 1.6;
	}

	.modal-footer {
		padding: var(--spacing-lg);
		border-top: 1px solid var(--border);
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-md);
	}

	.btn-primary,
	.btn-secondary {
		padding: var(--spacing-sm) var(--spacing-lg);
		border: none;
		border-radius: var(--radius-md);
		font-weight: 600;
		cursor: pointer;
		transition: var(--transition-fast);
	}

	.btn-primary {
		background: var(--accent-primary);
		color: white;
	}

	.btn-primary:hover {
		background: var(--accent-hover);
	}

	.btn-secondary {
		background: var(--bg-tertiary);
		color: var(--text-primary);
		border: 1px solid var(--border);
	}

	.btn-secondary:hover {
		background: var(--bg-hover);
	}
</style>
