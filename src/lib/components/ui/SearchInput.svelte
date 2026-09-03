<script lang="ts">
	interface Props {
		placeholder?: string;
		/** Accessible name for the input. */
		label?: string;
		value?: string;
		class?: string;
	}

	let {
		placeholder = 'Search...',
		label = 'Search',
		value = $bindable(''),
		class: extraClass = '',
	}: Props = $props();
</script>

<div class="search-input-wrapper {extraClass}">
	<svg
		class="search-icon"
		width="20"
		height="20"
		viewBox="0 0 16 16"
		fill="none"
		aria-hidden="true"
	>
		<circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5" />
		<path d="M11 11l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
	</svg>
	<input type="text" class="search-field" {placeholder} aria-label={label} bind:value />
	{#if value}
		<button class="clear-btn" type="button" aria-label="Clear search" onclick={() => (value = '')}>
			<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
				><path
					d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
				/></svg
			>
		</button>
	{/if}
</div>

<style>
	.search-input-wrapper {
		position: relative;
		display: flex;
		align-items: center;
		flex: 1;
		min-width: 220px;
	}

	.search-icon {
		position: absolute;
		left: var(--spacing-md);
		color: var(--color-text-tertiary);
		pointer-events: none;
		z-index: 1;
	}

	.search-field {
		width: 100%;
		height: var(--control-height);
		padding: 0 var(--spacing-xl) 0 calc(var(--spacing-md) + 28px);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		color: var(--color-text-primary);
		font-size: var(--font-size-sm);
		transition: border-color var(--transition-fast);
	}

	.search-field:focus {
		outline: none;
		border-color: var(--color-accent-primary);
		box-shadow: 0 0 0 3px var(--color-focus-ring-search);
	}

	.search-field::placeholder {
		color: var(--color-text-tertiary);
	}

	.clear-btn {
		position: absolute;
		right: var(--spacing-sm);
		display: flex;
		align-items: center;
		padding: 4px;
		background: transparent;
		border: none;
		color: var(--color-text-tertiary);
		cursor: pointer;
		border-radius: var(--radius-sm);
		z-index: 1;
	}

	.clear-btn:hover {
		color: var(--color-text-primary);
		background: var(--color-overlay-hover);
	}
</style>
