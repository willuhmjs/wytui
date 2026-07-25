<script lang="ts">
	import type { Snippet } from 'svelte';
	import { uniqueId } from '$lib/utils/a11y';

	interface Option<T = string> {
		value: T;
		label: string;
		disabled?: boolean;
	}

	interface Props<T = string> {
		options: Option<T>[];
		value: T;
		onChange: (next: T) => void;
		label: string;
		placeholder?: string;
		searchable?: boolean;
		searchPlaceholder?: string;
		disabled?: boolean;
		align?: 'left' | 'right';
		minWidth?: string;
		triggerClass?: string;
		menuClass?: string;
		emptyLabel?: string;
		trigger?: Snippet<[{ open: boolean; selectedLabel: string }]>;
	}

	let {
		options,
		value,
		onChange,
		label,
		placeholder = 'Select…',
		searchable = false,
		searchPlaceholder = 'Search…',
		disabled = false,
		align = 'left',
		minWidth = '180px',
		triggerClass = '',
		menuClass = '',
		emptyLabel = 'No options',
		trigger,
	}: Props = $props();

	let open = $state(false);
	let search = $state('');
	let triggerEl: HTMLButtonElement | null = $state(null);
	let menuEl: HTMLDivElement | null = $state(null);
	let searchEl: HTMLInputElement | null = $state(null);
	let activeIndex = $state(-1);

	const triggerId = uniqueId('dropdown-trigger');
	const menuId = uniqueId('dropdown-menu');

	let selectedOption = $derived(options.find((o) => o.value === value) ?? null);
	let selectedLabel = $derived(selectedOption?.label ?? placeholder);

	let filteredOptions = $derived(
		searchable && search
			? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
			: options,
	);

	$effect(() => {
		if (open && searchable && searchEl) {
			searchEl.focus();
		}
	});

	$effect(() => {
		if (!open) {
			search = '';
			activeIndex = -1;
		}
	});

	function toggle() {
		if (disabled) return;
		open = !open;
	}

	function close() {
		open = false;
		triggerEl?.focus();
	}

	function select(option: Option) {
		if (option.disabled) return;
		onChange(option.value);
		open = false;
		triggerEl?.focus();
	}

	function handleTriggerKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			open = true;
			activeIndex = Math.max(
				0,
				filteredOptions.findIndex((o) => o.value === value),
			);
		} else if (e.key === 'Escape' && open) {
			e.preventDefault();
			close();
		}
	}

	function handleMenuKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			close();
			return;
		}
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			activeIndex = (activeIndex + 1) % Math.max(filteredOptions.length, 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			activeIndex =
				(activeIndex - 1 + filteredOptions.length) % Math.max(filteredOptions.length, 1);
		} else if (e.key === 'Home') {
			e.preventDefault();
			activeIndex = 0;
		} else if (e.key === 'End') {
			e.preventDefault();
			activeIndex = filteredOptions.length - 1;
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const opt = filteredOptions[activeIndex];
			if (opt) select(opt);
		} else if (e.key === 'Tab') {
			open = false;
		}
	}

	function handleDocumentClick(e: MouseEvent) {
		if (!open) return;
		const target = e.target as Node;
		if (triggerEl?.contains(target)) return;
		if (menuEl?.contains(target)) return;
		open = false;
	}

	$effect(() => {
		if (open) {
			document.addEventListener('mousedown', handleDocumentClick);
			return () => document.removeEventListener('mousedown', handleDocumentClick);
		}
	});
</script>

<div class="dropdown">
	<button
		bind:this={triggerEl}
		type="button"
		id={triggerId}
		class="dropdown-trigger {triggerClass}"
		aria-label={label}
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-controls={menuId}
		{disabled}
		onclick={toggle}
		onkeydown={handleTriggerKeydown}
	>
		{#if trigger}
			{@render trigger({ open, selectedLabel })}
		{:else}
			<span class="dropdown-trigger-label">{selectedLabel}</span>
			<svg
				width="12"
				height="12"
				viewBox="0 0 12 12"
				fill="none"
				class="dropdown-chevron"
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
		{/if}
	</button>

	{#if open}
		<div
			bind:this={menuEl}
			id={menuId}
			role="listbox"
			aria-labelledby={triggerId}
			class="dropdown-menu {menuClass}"
			class:align-right={align === 'right'}
			style:min-width={minWidth}
			tabindex="-1"
			onkeydown={handleMenuKeydown}
		>
			{#if searchable}
				<input
					bind:this={searchEl}
					type="text"
					class="dropdown-search"
					placeholder={searchPlaceholder}
					aria-label={searchPlaceholder}
					bind:value={search}
				/>
			{/if}
			<div class="dropdown-options">
				{#each filteredOptions as option, i (option.value)}
					<button
						type="button"
						role="option"
						aria-selected={option.value === value}
						class="dropdown-option"
						class:selected={option.value === value}
						class:active={i === activeIndex}
						disabled={option.disabled}
						onclick={() => select(option)}
						onmouseenter={() => (activeIndex = i)}
					>
						{option.label}
					</button>
				{/each}
				{#if filteredOptions.length === 0}
					<div class="dropdown-empty">{emptyLabel}</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.dropdown {
		position: relative;
		display: inline-block;
	}

	.dropdown-trigger {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border-translucent);
		border-radius: var(--radius-md);
		color: var(--color-text-primary);
		font-size: var(--font-size-control);
		cursor: pointer;
		white-space: nowrap;
		transition: border-color var(--transition-fast);
	}

	.dropdown-trigger:hover:not(:disabled) {
		border-color: var(--color-border-translucent-hover);
	}

	.dropdown-trigger:focus-visible {
		outline: none;
		border-color: var(--color-accent-primary);
		box-shadow: 0 0 0 3px var(--color-focus-ring);
	}

	.dropdown-trigger:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.dropdown-chevron {
		transition: transform var(--transition-fast);
	}

	.dropdown-chevron.open {
		transform: rotate(180deg);
	}

	.dropdown-menu {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border-translucent);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-dropdown);
		z-index: var(--z-dropdown);
		overflow: hidden;
		animation: fadeIn var(--transition-fast);
	}

	.dropdown-menu.align-right {
		left: auto;
		right: 0;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.dropdown-search {
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--color-border-translucent);
		border-radius: 0;
		color: var(--color-text-primary);
		font-size: var(--font-size-sm);
		outline: none;
	}

	.dropdown-search::placeholder {
		color: var(--color-text-secondary);
	}

	.dropdown-options {
		max-height: 240px;
		overflow-y: auto;
		padding: var(--spacing-xs) 0;
	}

	.dropdown-option {
		display: block;
		width: 100%;
		padding: var(--spacing-xs) var(--spacing-md);
		background: transparent;
		border: none;
		color: var(--color-text-primary);
		font-size: var(--font-size-sm);
		text-align: left;
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.dropdown-option:hover:not(:disabled),
	.dropdown-option.active {
		background: var(--color-overlay-hover);
	}

	.dropdown-option:focus-visible {
		outline: none;
		background: var(--color-overlay-hover);
		box-shadow: inset 0 0 0 2px var(--color-accent-primary);
	}

	.dropdown-option.selected {
		color: var(--color-accent-primary);
	}

	.dropdown-option:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.dropdown-empty {
		padding: var(--spacing-sm) var(--spacing-md);
		color: var(--color-text-secondary);
		font-size: var(--font-size-sm);
	}
</style>
