<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		view: 'grid' | 'list';
		onchange?: (view: 'grid' | 'list') => void;
	}

	let { view = $bindable('grid'), onchange }: Props = $props();

	onMount(() => {
		const stored = localStorage.getItem('wytui-view-mode');
		if (stored === 'grid' || stored === 'list') {
			view = stored;
		}
	});

	function setView(mode: 'grid' | 'list') {
		view = mode;
		localStorage.setItem('wytui-view-mode', mode);
		onchange?.(mode);
	}
</script>

<div class="view-toggle" role="radiogroup" aria-label="View mode">
	<button
		class="toggle-btn"
		class:active={view === 'grid'}
		onclick={() => setView('grid')}
		aria-label="Grid view"
		aria-checked={view === 'grid'}
		role="radio"
	>
		<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
			<rect x="1" y="1" width="6" height="6" rx="1.5" />
			<rect x="9" y="1" width="6" height="6" rx="1.5" />
			<rect x="1" y="9" width="6" height="6" rx="1.5" />
			<rect x="9" y="9" width="6" height="6" rx="1.5" />
		</svg>
	</button>
	<button
		class="toggle-btn"
		class:active={view === 'list'}
		onclick={() => setView('list')}
		aria-label="List view"
		aria-checked={view === 'list'}
		role="radio"
	>
		<svg
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
		>
			<path d="M2 3h12" />
			<path d="M2 8h12" />
			<path d="M2 13h12" />
		</svg>
	</button>
</div>

<style>
	.view-toggle {
		display: inline-flex;
		align-items: stretch;
		height: var(--control-height);
		box-sizing: border-box;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border-translucent);
		border-radius: var(--radius-md);
		padding: 3px;
	}

	.toggle-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		padding: 0;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-tertiary);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.toggle-btn:hover {
		color: var(--color-text-primary);
	}

	.toggle-btn:focus-visible {
		outline: none;
		box-shadow: 0 0 0 3px var(--color-focus-ring);
		color: var(--color-text-primary);
	}

	.toggle-btn.active {
		background: var(--color-status-info-bg);
		color: var(--color-accent-primary);
	}
</style>
