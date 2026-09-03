<script module lang="ts">
	export interface FilterOption<T extends string = string> {
		value: T;
		label: string;
		/** Shorter label for the closed trigger; falls back to `label`. */
		short?: string;
	}
</script>

<script lang="ts" generics="T extends string">
	import { focusOnMount, uniqueId } from '$lib/utils/a11y';
	import type { Snippet } from 'svelte';

	interface Props {
		/** Accessible name for the trigger button, e.g. "Sort downloads". */
		label: string;
		options: FilterOption<T>[];
		value: T;
		icon?: Snippet;
		searchable?: boolean;
		searchPlaceholder?: string;
		emptyText?: string;
		menuAlign?: 'left' | 'right';
	}

	let {
		label,
		options,
		value = $bindable(),
		icon,
		searchable = false,
		searchPlaceholder = 'Search...',
		emptyText = 'No results',
		menuAlign = 'right',
	}: Props = $props();

	let open = $state(false);
	let search = $state('');

	const baseId = uniqueId('filter');
	const triggerId = `${baseId}-trigger`;
	const menuId = `${baseId}-menu`;

	const selected = $derived(options.find((option) => option.value === value));
	const triggerLabel = $derived(selected?.short ?? selected?.label ?? '');
	const visibleOptions = $derived(
		searchable && search.trim()
			? options.filter((option) => option.label.toLowerCase().includes(search.trim().toLowerCase()))
			: options,
	);

	function toggle() {
		open = !open;
		if (open) search = '';
	}

	function select(next: T) {
		value = next;
		open = false;
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="filter-dropdown"
	onkeydown={(e) => {
		if (e.key === 'Escape') open = false;
	}}
>
	<button
		id={triggerId}
		type="button"
		class="trigger"
		aria-label={label}
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-controls={menuId}
		onclick={(e) => {
			e.stopPropagation();
			toggle();
		}}
	>
		{#if icon}
			{@render icon()}
		{/if}
		<span class="trigger-label">{triggerLabel}</span>
		<svg
			width="12"
			height="12"
			viewBox="0 0 12 12"
			fill="none"
			class="chevron"
			class:open
			aria-hidden="true"
		>
			<path
				d="M3 4.5L6 7.5L9 4.5"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	</button>
	{#if open}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			id={menuId}
			role="listbox"
			aria-labelledby={triggerId}
			class="menu"
			class:align-left={menuAlign === 'left'}
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
		>
			{#if searchable}
				<input
					type="text"
					class="menu-search"
					placeholder={searchPlaceholder}
					aria-label={searchPlaceholder}
					bind:value={search}
					use:focusOnMount
				/>
			{/if}
			<div class="options">
				{#each visibleOptions as option (option.value)}
					<button
						type="button"
						role="option"
						aria-selected={value === option.value}
						class="option"
						class:selected={value === option.value}
						onclick={(e) => {
							e.stopPropagation();
							select(option.value);
						}}>{option.label}</button
					>
				{/each}
				{#if visibleOptions.length === 0}
					<div class="empty">{emptyText}</div>
				{/if}
			</div>
		</div>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="backdrop" onclick={() => (open = false)}></div>
	{/if}
</div>

<style>
	.filter-dropdown {
		position: relative;
	}

	.trigger {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		height: var(--control-height);
		padding: 0 var(--spacing-md);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border-translucent);
		border-radius: var(--radius-md);
		color: var(--color-text-primary);
		font-size: 0.8125rem;
		cursor: pointer;
		white-space: nowrap;
		transition: border-color 0.15s;
	}

	.trigger:hover {
		border-color: var(--color-border-translucent-hover);
	}

	.trigger-label {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.chevron {
		transition: transform 0.15s;
		flex-shrink: 0;
	}

	.chevron.open {
		transform: rotate(180deg);
	}

	.menu {
		position: absolute;
		top: calc(100% + 4px);
		right: 0;
		min-width: 220px;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border-translucent);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-dropdown);
		z-index: 100;
		overflow: hidden;
		transform-origin: top right;
		animation: dropdown-in 160ms cubic-bezier(0.2, 0.8, 0.3, 1.1) both;
	}

	.menu.align-left {
		left: 0;
		right: auto;
		transform-origin: top left;
	}

	@keyframes dropdown-in {
		from {
			opacity: 0;
			transform: translateY(-6px) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.menu {
			animation: none;
		}
	}

	.menu-search {
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--color-border-translucent);
		color: var(--color-text-primary);
		font-size: 0.85rem;
		outline: none;
	}

	.menu-search::placeholder {
		color: var(--color-text-secondary);
	}

	.options {
		max-height: 200px;
		overflow-y: auto;
		padding: var(--spacing-xs) 0;
	}

	.option {
		display: block;
		width: 100%;
		padding: var(--spacing-xs) var(--spacing-md);
		background: transparent;
		border: none;
		color: var(--color-text-primary);
		font-size: 0.85rem;
		text-align: left;
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.option:hover {
		background: var(--color-overlay-hover);
	}

	.option.selected {
		color: var(--color-accent-primary);
	}

	.empty {
		padding: var(--spacing-sm) var(--spacing-md);
		color: var(--color-text-secondary);
		font-size: 0.85rem;
	}

	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 99;
	}

	@media (max-width: 768px) {
		.trigger {
			width: 100%;
			justify-content: space-between;
			min-height: 44px;
			padding: var(--spacing-sm) var(--spacing-md);
			font-size: var(--font-size-sm);
		}

		.trigger-label {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			flex: 1;
			text-align: left;
		}

		.menu {
			left: 0;
			right: 0;
			min-width: unset;
			max-width: calc(100vw - var(--spacing-md) * 2);
		}

		.menu-search {
			min-height: 44px;
			font-size: 1rem;
		}

		.option {
			padding: var(--spacing-sm) var(--spacing-md);
			min-height: 44px;
			display: flex;
			align-items: center;
		}
	}
</style>
