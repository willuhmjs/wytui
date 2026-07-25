<script lang="ts">
	import { tick, onDestroy } from 'svelte';

	interface Props {
		value: string;
		placeholder?: string;
		id?: string;
		onchange?: (value: string) => void;
	}

	let { value = $bindable(), placeholder = '/media', id = '', onchange }: Props = $props();

	let dirs = $state<string[]>([]);
	let loading = $state(false);
	let open = $state(false);
	let focused = $state(false);
	let selectedIndex = $state(-1);
	let inputEl = $state<HTMLInputElement>();
	let dropdownEl = $state<HTMLElement>();
	let debounceTimer: ReturnType<typeof setTimeout>;
	let blurTimer: ReturnType<typeof setTimeout>;

	onDestroy(() => {
		clearTimeout(debounceTimer);
		clearTimeout(blurTimer);
	});

	async function browse(path: string) {
		loading = true;
		try {
			const res = await fetch(`/api/browse?path=${encodeURIComponent(path)}`);
			if (res.ok) {
				const data = await res.json();
				dirs = data.dirs;
				open = dirs.length > 0;
				selectedIndex = -1;
			}
		} catch {
			dirs = [];
		} finally {
			loading = false;
		}
	}

	function debouncedBrowse(path: string) {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => browse(path), 150);
	}

	function handleInput(e: Event) {
		const target = e.target as HTMLInputElement;
		value = target.value;
		onchange?.(value);
		if (value) {
			debouncedBrowse(value);
		} else {
			dirs = [];
			open = false;
		}
	}

	function selectDir(dir: string) {
		value = dir;
		onchange?.(value);
		browse(dir + '/');
		inputEl?.focus();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!open) {
			if (e.key === 'ArrowDown' && value) {
				e.preventDefault();
				browse(value);
			}
			return;
		}

		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				selectedIndex = Math.min(selectedIndex + 1, dirs.length - 1);
				scrollSelectedIntoView();
				break;
			case 'ArrowUp':
				e.preventDefault();
				selectedIndex = Math.max(selectedIndex - 1, -1);
				scrollSelectedIntoView();
				break;
			case 'Enter':
				e.preventDefault();
				if (selectedIndex >= 0 && selectedIndex < dirs.length) {
					selectDir(dirs[selectedIndex]);
				}
				break;
			case 'Escape':
				open = false;
				selectedIndex = -1;
				break;
			case 'Tab':
				if (selectedIndex >= 0 && selectedIndex < dirs.length) {
					e.preventDefault();
					selectDir(dirs[selectedIndex]);
				} else if (dirs.length === 1) {
					e.preventDefault();
					selectDir(dirs[0]);
				} else {
					open = false;
				}
				break;
		}
	}

	async function scrollSelectedIntoView() {
		await tick();
		dropdownEl?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
	}

	function handleFocus() {
		focused = true;
		if (value && dirs.length === 0) {
			browse(value);
		} else if (dirs.length > 0) {
			open = true;
		}
	}

	function handleBlur(e: FocusEvent) {
		const related = e.relatedTarget as HTMLElement | null;
		if (dropdownEl?.contains(related)) return;
		focused = false;
		clearTimeout(blurTimer);
		blurTimer = setTimeout(() => {
			if (!focused) {
				open = false;
				selectedIndex = -1;
			}
		}, 150);
	}

	function displayName(fullPath: string): string {
		const parts = fullPath.split('/');
		return parts[parts.length - 1] || fullPath;
	}
</script>

<div class="path-browser">
	<div class="input-wrapper">
		<input
			type="text"
			{id}
			{placeholder}
			{value}
			oninput={handleInput}
			onkeydown={handleKeydown}
			onfocus={handleFocus}
			onblur={handleBlur}
			bind:this={inputEl}
			autocomplete="off"
			spellcheck="false"
		/>
		{#if loading}
			<span class="spinner"></span>
		{/if}
	</div>

	{#if open && focused}
		<div class="dropdown" bind:this={dropdownEl}>
			{#each dirs as dir, i}
				<button
					class="dropdown-item"
					class:selected={i === selectedIndex}
					onmousedown={(e) => {
						e.preventDefault();
						selectDir(dir);
					}}
					type="button"
				>
					<span class="folder-icon">/</span>
					<span class="dir-name">{displayName(dir)}</span>
					<span class="dir-path">{dir}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.path-browser {
		position: relative;
	}

	.input-wrapper {
		position: relative;
	}

	.input-wrapper input {
		width: 100%;
		padding: var(--spacing-md);
		padding-right: 2.5rem;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-overlay-white-10);
		border-radius: var(--radius-md);
		color: var(--color-text-primary);
		font-size: 1rem;
		font-family: monospace;
	}

	.input-wrapper input:focus {
		outline: none;
		border-color: var(--color-accent-primary);
	}

	.spinner {
		position: absolute;
		right: 0.75rem;
		top: 50%;
		transform: translateY(-50%);
		width: 14px;
		height: 14px;
		border: 2px solid var(--color-overlay-white-20);
		border-top-color: var(--color-accent-primary);
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: translateY(-50%) rotate(360deg);
		}
	}

	.dropdown {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		z-index: 100;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-overlay-white-15);
		border-top: none;
		border-radius: 0 0 var(--radius-md) var(--radius-md);
		max-height: 240px;
		overflow-y: auto;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
	}

	.dropdown-item {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		background: none;
		border: none;
		color: var(--color-text-primary);
		font-size: 0.875rem;
		cursor: pointer;
		text-align: left;
		transition: background 0.1s;
	}

	.dropdown-item:hover,
	.dropdown-item.selected {
		background: var(--color-overlay-white-08);
	}

	.folder-icon {
		color: var(--color-accent-primary);
		font-weight: 700;
		font-family: monospace;
		flex-shrink: 0;
	}

	.dir-name {
		font-weight: 500;
		white-space: nowrap;
	}

	.dir-path {
		color: var(--color-text-tertiary);
		font-size: 0.75rem;
		margin-left: auto;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-family: monospace;
	}
</style>
