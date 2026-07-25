<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	let {
		tags = [],
		onUpdate,
	}: {
		tags: string[];
		onUpdate: (tags: string[]) => void;
	} = $props();

	let input = $state('');
	let allTags = $state<string[]>([]);
	let showSuggestions = $state(false);
	let blurTimer: ReturnType<typeof setTimeout>;

	onMount(() => {
		fetch('/api/tags')
			.then((r) => (r.ok ? r.json() : []))
			.then((data) => {
				allTags = data;
			})
			.catch(() => {});
	});

	onDestroy(() => clearTimeout(blurTimer));

	let filtered = $derived(
		input.trim()
			? allTags.filter((t) => t.toLowerCase().includes(input.toLowerCase()) && !tags.includes(t))
			: [],
	);

	function addTag(tag: string) {
		const trimmed = tag.trim();
		if (!trimmed || tags.includes(trimmed)) return;
		const next = [...tags, trimmed];
		onUpdate(next);
		input = '';
		showSuggestions = false;
	}

	function removeTag(tag: string) {
		onUpdate(tags.filter((t) => t !== tag));
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && input.trim()) {
			e.preventDefault();
			addTag(input);
		} else if (e.key === 'Backspace' && !input && tags.length > 0) {
			removeTag(tags[tags.length - 1]);
		} else if (e.key === 'Escape') {
			showSuggestions = false;
		}
	}
</script>

<div class="tag-editor">
	<div class="tag-chips">
		{#each tags as tag (tag)}
			<span class="tag-chip">
				{tag}
				<button
					type="button"
					class="tag-remove"
					onclick={() => removeTag(tag)}
					aria-label="Remove tag {tag}"
				>
					<svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"
						><path
							d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
						/></svg
					>
				</button>
			</span>
		{/each}
		<div class="tag-input-wrapper">
			<input
				type="text"
				class="tag-input"
				placeholder={tags.length === 0 ? 'Add tags...' : ''}
				bind:value={input}
				onkeydown={handleKeydown}
				onfocus={() => (showSuggestions = true)}
				onblur={() => {
					clearTimeout(blurTimer);
					blurTimer = setTimeout(() => (showSuggestions = false), 150);
				}}
			/>
			{#if showSuggestions && filtered.length > 0}
				<div class="tag-suggestions">
					{#each filtered.slice(0, 8) as suggestion (suggestion)}
						<button type="button" class="tag-suggestion" onmousedown={() => addTag(suggestion)}>
							{suggestion}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.tag-editor {
		width: 100%;
	}

	.tag-chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-xs);
		padding: var(--spacing-sm);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		min-height: 38px;
		align-items: center;
	}

	.tag-chips:focus-within {
		border-color: var(--color-accent-primary);
	}

	.tag-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px var(--spacing-sm);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		font-size: var(--font-size-control);
		color: var(--color-text-secondary);
	}

	.tag-remove {
		display: flex;
		background: none;
		border: none;
		color: var(--color-text-tertiary);
		cursor: pointer;
		padding: 0;
		border-radius: 50%;
	}

	.tag-remove:hover {
		color: var(--color-status-error);
	}

	.tag-input-wrapper {
		position: relative;
		flex: 1;
		min-width: 80px;
	}

	.tag-input {
		width: 100%;
		background: transparent;
		border: none;
		color: var(--color-text-primary);
		font-size: var(--font-size-control);
		outline: none;
		padding: 2px 0;
	}

	.tag-input::placeholder {
		color: var(--color-text-tertiary);
	}

	.tag-suggestions {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		margin-top: var(--spacing-xs);
		z-index: var(--z-dropdown);
		max-height: 200px;
		overflow-y: auto;
		box-shadow: var(--shadow-lg);
	}

	.tag-suggestion {
		display: block;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		padding: var(--spacing-xs) var(--spacing-sm);
		color: var(--color-text-secondary);
		font-size: var(--font-size-control);
		cursor: pointer;
	}

	.tag-suggestion:hover,
	.tag-suggestion:focus-visible {
		background: var(--color-overlay-hover);
		color: var(--color-text-primary);
		outline: none;
	}

	.tag-remove:focus-visible {
		outline: none;
		color: var(--color-status-error);
		box-shadow: 0 0 0 3px var(--color-focus-ring);
	}
</style>
