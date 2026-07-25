<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import EyeToggleButton from './EyeToggleButton.svelte';

	// Lightweight password/secret field with a reveal toggle for contexts that use
	// raw <input> markup (settings, setup) rather than the richer Input component.
	// The <input> inherits the global input styling from app.css.
	interface Props extends Omit<HTMLInputAttributes, 'class' | 'value' | 'type'> {
		value?: string;
		class?: string;
	}

	let { value = $bindable(''), class: extraClass = '', disabled, ...rest }: Props = $props();

	let revealed = $state(false);
</script>

<div class="password-input {extraClass}">
	<input {...rest} {disabled} type={revealed ? 'text' : 'password'} bind:value />
	<EyeToggleButton bind:revealed disabled={!!disabled} />
</div>

<style>
	.password-input {
		position: relative;
		display: flex;
		align-items: center;
		width: 100%;
	}

	.password-input input {
		/* leave room for the toggle button on the right */
		padding-right: 2.75rem;
	}

	.password-input :global(.eye-toggle) {
		position: absolute;
		right: var(--spacing-xs);
		top: 50%;
		transform: translateY(-50%);
	}
</style>
