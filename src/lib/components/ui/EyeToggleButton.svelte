<script lang="ts">
	// Reveal/hide toggle for password & secret fields. The parent owns `revealed`
	// (bindable) so it can swap the input's type between 'password' and 'text'.
	let {
		revealed = $bindable(false),
		disabled = false,
	}: { revealed?: boolean; disabled?: boolean } = $props();
</script>

<button
	type="button"
	class="eye-toggle"
	{disabled}
	onclick={() => (revealed = !revealed)}
	aria-label={revealed ? 'Hide' : 'Show'}
	aria-pressed={revealed}
	title={revealed ? 'Hide' : 'Show'}
>
	{#if revealed}
		<svg
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
			<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
			<path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
			<line x1="1" y1="1" x2="23" y2="23" />
		</svg>
	{:else}
		<svg
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
			<circle cx="12" cy="12" r="3" />
		</svg>
	{/if}
</button>

<style>
	.eye-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		padding: var(--spacing-xs);
		margin: 0;
		width: auto;
		color: var(--color-text-tertiary);
		cursor: pointer;
		border-radius: var(--radius-sm);
		flex-shrink: 0;
		transition:
			color var(--transition-fast),
			background var(--transition-fast);
	}

	.eye-toggle:hover:not(:disabled) {
		color: var(--color-text-primary);
	}

	.eye-toggle:focus-visible {
		outline: none;
		color: var(--color-accent-primary);
		box-shadow: 0 0 0 3px var(--color-focus-ring);
	}

	.eye-toggle:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
