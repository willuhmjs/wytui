<script lang="ts">
	import { trapFocus, uniqueId } from '$lib/utils/a11y';

	interface Props {
		open: boolean;
		/** Subscription display name, shown so the user knows what they're deleting. */
		name?: string;
		/** The caller runs the DELETE request and flips this while it is in flight. */
		deleting?: boolean;
		onConfirm: (options: { deleteCache: boolean; deleteLibrary: boolean }) => void | Promise<void>;
	}

	let { open = $bindable(), name = '', deleting = false, onConfirm }: Props = $props();

	// Both unchecked by default. Deleting media is the destructive outcome of a
	// button labelled "Delete" on a subscription, so it has to be opted into.
	let deleteCache = $state(false);
	let deleteLibrary = $state(false);

	let dialogEl: HTMLDivElement | null = $state(null);

	const titleId = uniqueId('delete-subscription-title');

	$effect(() => {
		if (open) {
			deleteCache = false;
			deleteLibrary = false;
		}
	});

	$effect(() => {
		if (open && dialogEl) {
			const release = trapFocus(dialogEl);
			return release;
		}
	});

	function close() {
		if (deleting) return;
		open = false;
	}

	function handleOverlayClick(e: MouseEvent) {
		if (e.target === e.currentTarget) close();
	}

	function handleDialogKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			close();
		}
	}

	// The caller closes us on success; staying open on failure keeps the choices
	// so the user can retry without re-ticking the boxes.
	async function confirm() {
		if (deleting) return;
		await onConfirm({ deleteCache, deleteLibrary });
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={handleOverlayClick}>
		<div
			bind:this={dialogEl}
			class="modal"
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
			tabindex="-1"
			onkeydown={handleDialogKeydown}
		>
			<div class="modal-header">
				<div class="header-text">
					<h3 id={titleId}>Delete Subscription</h3>
					<p class="hint">
						{name
							? `“${name}” will stop being checked for new videos.`
							: 'This subscription will stop being checked for new videos.'}
					</p>
				</div>
				<button class="btn-icon-close" onclick={close} aria-label="Close" disabled={deleting}>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<line x1="18" y1="6" x2="6" y2="18" />
						<line x1="6" y1="6" x2="18" y2="18" />
					</svg>
				</button>
			</div>

			<div class="modal-body">
				<label class="option">
					<input type="checkbox" bind:checked={deleteCache} disabled={deleting} />
					<span class="option-text">
						<span class="option-title">Also delete cached videos</span>
						<span class="option-hint"
							>Videos still sitting in the download cache, with their sidecars.</span
						>
					</span>
				</label>
				<label class="option">
					<input type="checkbox" bind:checked={deleteLibrary} disabled={deleting} />
					<span class="option-text">
						<span class="option-title">Also delete library videos</span>
						<span class="option-hint"
							>Promoted media in the library folder, with artwork and .nfo sidecars.</span
						>
					</span>
				</label>
				<p class="warning">
					Removed videos stay re-downloadable — their archive entries are cleared too. Pinned videos
					are never deleted here.
				</p>
			</div>

			<div class="modal-footer">
				<button class="btn btn-secondary" onclick={close} disabled={deleting}>Cancel</button>
				<button class="btn btn-danger" onclick={confirm} disabled={deleting}>
					{deleting ? 'Deleting…' : 'Delete'}
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
		max-width: 480px;
		width: 90%;
		max-height: 90vh;
		display: flex;
		flex-direction: column;
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
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--spacing-md);
	}

	.header-text {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		min-width: 0;
	}

	.modal-header h3 {
		margin: 0;
		font-size: var(--font-size-xl);
		color: var(--color-text-primary);
	}

	.hint {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
	}

	.btn-icon-close {
		background: none;
		border: none;
		padding: var(--spacing-xs);
		cursor: pointer;
		color: var(--color-text-secondary);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
		transition: background var(--transition-fast);
	}

	.btn-icon-close:hover {
		background: var(--color-overlay-white-10);
		color: var(--color-text-primary);
	}

	.modal-body {
		padding: var(--spacing-lg);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
		overflow-y: auto;
	}

	.option {
		display: flex;
		align-items: flex-start;
		gap: var(--spacing-sm);
		cursor: pointer;
	}

	.option input[type='checkbox'] {
		margin-top: 0.15rem;
		flex: none;
	}

	.option-text {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		min-width: 0;
	}

	.option-title {
		color: var(--color-text-primary);
	}

	.option-hint,
	.warning {
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
		margin: 0;
	}

	.modal-footer {
		padding: var(--spacing-lg);
		border-top: 1px solid var(--color-border-default);
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-md);
	}

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
