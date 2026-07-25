<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { uniqueId } from '$lib/utils/a11y';
	import EyeToggleButton from './EyeToggleButton.svelte';

	interface Props extends Omit<HTMLInputAttributes, 'class' | 'value'> {
		value?: string;
		error?: string;
		helperText?: string;
		required?: boolean;
		maxLength?: number;
		validate?: (value: string) => string | null;
		showSuccess?: boolean;
		id?: string;
		type?: string;
		class?: string;
	}

	let {
		value = $bindable(''),
		error = $bindable(''),
		helperText = '',
		required = false,
		maxLength,
		validate,
		showSuccess = true,
		id,
		type = 'text',
		class: extraClass = '',
		oninput,
		onblur,
		onfocus,
		...rest
	}: Props = $props();

	let focused = $state(false);
	let touched = $state(false);
	let internalError = $state('');
	let revealed = $state(false);

	// Password fields get a reveal toggle; revealing swaps the rendered type to
	// 'text' without touching the caller's `type` prop.
	const isPassword = $derived(type === 'password');
	const effectiveType = $derived(isPassword && revealed ? 'text' : type);

	const displayError = $derived(error || internalError);
	const charCount = $derived(value?.length ?? 0);
	const showCharCount = $derived(maxLength !== undefined && maxLength > 0);
	const isOverLimit = $derived(maxLength !== undefined && charCount > maxLength);
	const isValid = $derived(touched && !displayError && value && value.length > 0);
	const showSuccessState = $derived(showSuccess && isValid && !focused);

	const generatedId = uniqueId('input');
	const inputId = $derived(id ?? generatedId);
	const errorId = $derived(`${inputId}-error`);
	const helperId = $derived(`${inputId}-helper`);
	const countId = $derived(`${inputId}-count`);

	const describedBy = $derived(
		[
			displayError ? errorId : null,
			helperText && !displayError ? helperId : null,
			showCharCount ? countId : null,
		]
			.filter(Boolean)
			.join(' ') || undefined,
	);

	function runValidation(): string {
		if (required && (!value || value.trim().length === 0)) {
			return 'This field is required';
		}
		if (maxLength !== undefined && value && value.length > maxLength) {
			return `Must be ${maxLength} characters or less`;
		}
		if (type === 'email' && value) {
			const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
			if (!emailRegex.test(value)) {
				return 'Enter a valid email address';
			}
		}
		if (type === 'url' && value) {
			try {
				const url = new URL(value);
				if (!['http:', 'https:'].includes(url.protocol)) {
					return 'URL must start with http:// or https://';
				}
			} catch {
				return 'Enter a valid URL';
			}
		}
		if (validate) {
			const result = validate(value);
			if (result) return result;
		}
		return '';
	}

	function handleBlur(e: FocusEvent & { currentTarget: EventTarget & HTMLInputElement }) {
		focused = false;
		touched = true;
		internalError = runValidation();
		onblur?.(e);
	}

	function handleFocus(e: FocusEvent & { currentTarget: EventTarget & HTMLInputElement }) {
		focused = true;
		onfocus?.(e);
	}

	function handleInput(e: Event & { currentTarget: EventTarget & HTMLInputElement }) {
		value = e.currentTarget.value;
		if (internalError && touched) {
			const result = runValidation();
			if (!result) internalError = '';
		}
		oninput?.(e as InputEvent & { currentTarget: EventTarget & HTMLInputElement });
	}
</script>

<div class="input-wrapper {extraClass}">
	<div
		class="input-container"
		class:focused
		class:has-error={!!displayError}
		class:has-success={showSuccessState}
	>
		<input
			{...rest}
			type={effectiveType}
			id={inputId}
			{value}
			{required}
			maxlength={maxLength}
			aria-invalid={!!displayError}
			aria-describedby={describedBy}
			oninput={handleInput}
			onblur={handleBlur}
			onfocus={handleFocus}
		/>
		{#if isPassword}
			<EyeToggleButton bind:revealed disabled={!!rest.disabled} />
		{/if}
		{#if showSuccessState}
			<span class="status-icon success-icon" aria-hidden="true">
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="3"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<polyline points="20 6 9 17 4 12"></polyline>
				</svg>
			</span>
		{:else if displayError}
			<span class="status-icon error-icon" aria-hidden="true">
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<circle cx="12" cy="12" r="10"></circle>
					<line x1="12" y1="8" x2="12" y2="12"></line>
					<line x1="12" y1="16" x2="12.01" y2="16"></line>
				</svg>
			</span>
		{/if}
	</div>

	<div class="input-footer">
		<div class="message-area">
			{#if displayError}
				<p id={errorId} class="error-message" role="alert">{displayError}</p>
			{:else if helperText}
				<p id={helperId} class="helper-text">{helperText}</p>
			{/if}
		</div>
		{#if showCharCount}
			<span id={countId} class="char-count" class:over-limit={isOverLimit}>
				{charCount}{maxLength ? `/${maxLength}` : ''}
			</span>
		{/if}
	</div>
</div>

<style>
	.input-wrapper {
		display: flex;
		flex-direction: column;
		width: 100%;
	}

	.input-container {
		position: relative;
		display: flex;
		align-items: center;
		width: 100%;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-translucent);
		border-radius: var(--radius-md);
		transition: var(--transition-fast);
	}

	.input-container.focused {
		border-color: var(--color-accent-primary);
		box-shadow: 0 0 0 3px var(--color-focus-ring);
	}

	.input-container.has-error {
		border-color: var(--color-status-error);
	}

	.input-container.has-error.focused {
		box-shadow: 0 0 0 3px var(--color-status-error-bg);
	}

	.input-container.has-success {
		border-color: var(--color-status-success);
	}

	input {
		flex: 1;
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--color-text-primary);
		font-size: var(--font-size-sm);
		font-family: inherit;
	}

	input:focus {
		outline: none;
	}

	input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	input::placeholder {
		color: var(--color-text-tertiary);
	}

	.status-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		padding-right: var(--spacing-sm);
		flex-shrink: 0;
	}

	.success-icon {
		color: var(--color-status-success);
		animation: pop-in var(--transition-fast) ease;
	}

	.error-icon {
		color: var(--color-status-error);
	}

	@keyframes pop-in {
		from {
			transform: scale(0.6);
			opacity: 0;
		}
		to {
			transform: scale(1);
			opacity: 1;
		}
	}

	.input-footer {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--spacing-sm);
		margin-top: var(--spacing-xs);
		min-height: 1rem;
	}

	.message-area {
		flex: 1;
		min-width: 0;
	}

	.error-message {
		margin: 0;
		color: var(--color-status-error);
		font-size: var(--font-size-xs);
		line-height: var(--line-height-base);
	}

	.helper-text {
		margin: 0;
		color: var(--color-text-secondary);
		font-size: var(--font-size-xs);
		line-height: var(--line-height-base);
	}

	.char-count {
		color: var(--color-text-tertiary);
		font-size: var(--font-size-xs);
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
	}

	.char-count.over-limit {
		color: var(--color-status-error);
	}

	@media (prefers-reduced-motion: reduce) {
		.success-icon {
			animation: none;
			transform: none;
			opacity: 1;
		}
	}
</style>
