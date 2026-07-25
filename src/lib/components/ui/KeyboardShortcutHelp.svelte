<script lang="ts">
	import { trapFocus } from '$lib/utils/a11y';

	interface Props {
		open: boolean;
		onClose: () => void;
	}

	let { open, onClose }: Props = $props();

	let modalEl: HTMLDivElement | null = $state(null);

	$effect(() => {
		if (open && modalEl) {
			const release = trapFocus(modalEl);
			return release;
		}
	});

	const isMac =
		typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
	const modKey = isMac ? 'Cmd' : 'Ctrl';

	const shortcuts: { keys: string[]; description: string }[] = [
		{ keys: [`${modKey}`, 'K'], description: 'Focus search' },
		{ keys: ['G', 'then', 'D'], description: 'Go to downloads' },
		{ keys: ['G', 'then', 'S'], description: 'Go to subscriptions' },
		{ keys: ['G', 'then', 'M'], description: 'Go to monitors' },
		{ keys: ['G', 'then', 'P'], description: 'Go to playlists' },
		{ keys: ['N'], description: 'New download' },
		{ keys: ['?'], description: 'Show this help' },
	];

	function handleOverlayClick() {
		onClose();
	}

	function handleOverlayKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		}
	}

	function handleModalClick(e: MouseEvent) {
		e.stopPropagation();
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="overlay" onclick={handleOverlayClick} onkeydown={handleOverlayKeydown}>
		<div
			bind:this={modalEl}
			class="modal"
			onclick={handleModalClick}
			onkeydown={handleOverlayKeydown}
			role="dialog"
			aria-modal="true"
			aria-label="Keyboard shortcuts"
			tabindex="-1"
		>
			<div class="modal-header">
				<h3>Keyboard Shortcuts</h3>
				<button class="close-btn" onclick={handleOverlayClick} aria-label="Close">
					<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
						<path
							d="M4.646 4.646a.5.5 0 01.708 0L8 7.293l2.646-2.647a.5.5 0 01.708.708L8.707 8l2.647 2.646a.5.5 0 01-.708.708L8 8.707l-2.646 2.647a.5.5 0 01-.708-.708L7.293 8 4.646 5.354a.5.5 0 010-.708z"
						/>
					</svg>
				</button>
			</div>
			<div class="modal-body">
				<div class="shortcuts-list">
					{#each shortcuts as shortcut}
						<div class="shortcut-row">
							<div class="shortcut-keys">
								{#each shortcut.keys as key}
									{#if key === 'then'}
										<span class="key-separator">then</span>
									{:else}
										<kbd>{key}</kbd>
									{/if}
								{/each}
							</div>
							<span class="shortcut-desc">{shortcut.description}</span>
						</div>
					{/each}
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.overlay {
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
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--spacing-lg);
		border-bottom: 1px solid var(--color-border-default);
	}

	.modal-header h3 {
		margin: 0;
		font-size: var(--font-size-xl);
		color: var(--color-text-primary);
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-tertiary);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.close-btn:focus-visible {
		outline: none;
		box-shadow: 0 0 0 3px var(--color-focus-ring);
		color: var(--color-text-primary);
	}

	.close-btn:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-text-primary);
	}

	.modal-body {
		padding: var(--spacing-lg);
	}

	.shortcuts-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.shortcut-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--spacing-sm) 0;
	}

	.shortcut-keys {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	kbd {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 24px;
		height: 24px;
		padding: 0 6px;
		font-family: inherit;
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--color-text-primary);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-sm);
		box-shadow: 0 1px 0 rgba(0, 0, 0, 0.2);
	}

	.key-separator {
		font-size: var(--font-size-2xs);
		color: var(--color-text-tertiary);
		padding: 0 2px;
	}

	.shortcut-desc {
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
	}

	@media (prefers-reduced-motion: reduce) {
		.overlay,
		.modal {
			animation: none;
		}
	}

	@media (max-width: 768px) {
		.modal {
			width: 95%;
		}

		.modal-header,
		.modal-body {
			padding: var(--spacing-md);
		}
	}
</style>
