<script lang="ts">
	import { enhance } from '$app/forms';
	import Input from '$lib/components/ui/Input.svelte';
	import FormField from '$lib/components/ui/FormField.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let loading = $state(false);
	let email = $state<string>(form?.email || '');
	let password = $state<string>('');

	let showOidc = $derived(
		data.oidcConfigured && (data.authMode === 'oidc' || data.authMode === 'both'),
	);
	let showPassword = $derived(data.authMode !== 'oidc' || data.fallback);
	let ldapEnabled = $derived(data.ldapEnabled ?? false);

	const oidcErrors: Record<string, string> = {
		invalid_state: 'Login session expired. Please try again.',
		oidc_failed: 'Authentication failed. Please try again.',
		no_email: 'Your identity provider did not return an email address.',
	};
</script>

<svelte:head>
	<title>Sign In - wytui</title>
</svelte:head>

<div class="signin-page">
	<div class="signin-card">
		<div class="logo">
			<div class="logo-gradient">wytui</div>
		</div>
		<p class="subtitle">Sign in to continue{ldapEnabled ? ' (LDAP enabled)' : ''}</p>

		{#if data.setupComplete}
			<div class="success-message">Admin account created successfully! Please sign in.</div>
		{/if}

		{#if data.error}
			<div class="error-message">{oidcErrors[data.error] || 'An error occurred.'}</div>
		{/if}

		{#if form?.error}
			<div class="error-message">{form.error}</div>
		{/if}

		{#if showOidc}
			<a href="/auth/oidc" class="btn-oidc">
				Sign in with {data.oidcDisplayName}
			</a>
		{/if}

		{#if showOidc && showPassword}
			<div class="divider">
				<span>or</span>
			</div>
		{/if}

		{#if showPassword}
			<form
				method="POST"
				use:enhance={() => {
					loading = true;
					return async ({ update }) => {
						await update();
						loading = false;
					};
				}}
			>
				<FormField label="Username or email" for="email" required>
					<Input
						type="text"
						id="email"
						name="email"
						bind:value={email}
						placeholder="you@example.com or username"
						required
						disabled={loading}
						autocomplete="username"
					/>
				</FormField>

				<FormField label="Password" for="password" required>
					<Input
						type="password"
						id="password"
						name="password"
						bind:value={password}
						placeholder="••••••••"
						required
						disabled={loading}
						autocomplete="current-password"
						showSuccess={false}
					/>
				</FormField>

				<button type="submit" class="btn btn-primary" disabled={loading}>
					{#if loading}
						Signing in...
					{:else}
						Sign In
					{/if}
				</button>
			</form>
		{/if}
	</div>
</div>

<style>
	.signin-page {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-bg-secondary);
		padding: var(--spacing-lg);
		z-index: 200;
	}

	.signin-card {
		width: 100%;
		max-width: var(--signin-card-max-width);
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border-translucent);
		border-radius: var(--radius-lg);
		padding: var(--spacing-lg);
		box-shadow: var(--shadow-card);
	}

	.logo {
		text-align: center;
		margin-bottom: var(--spacing-sm);
	}

	.logo-gradient {
		font-size: var(--font-size-3xl);
		font-weight: var(--font-weight-bold);
		background: linear-gradient(
			135deg,
			var(--color-accent-primary) 0%,
			var(--color-accent-secondary) 100%
		);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.subtitle {
		text-align: center;
		color: var(--color-text-secondary);
		margin-bottom: var(--spacing-lg);
		font-size: 0.875rem;
	}

	.success-message {
		background: var(--color-status-success-subtle);
		border: 1px solid var(--color-status-success);
		border-radius: var(--radius-md);
		padding: var(--spacing-sm) var(--spacing-md);
		color: var(--color-status-success);
		font-size: 0.8125rem;
		margin-bottom: var(--spacing-md);
	}

	.error-message {
		background: var(--color-status-error-bg);
		border: 1px solid var(--color-status-error);
		border-radius: var(--radius-md);
		padding: var(--spacing-sm) var(--spacing-md);
		color: var(--color-status-error);
		font-size: 0.8125rem;
		margin-bottom: var(--spacing-md);
	}

	/* Appearance + hover come from the global .btn system (src/app.css);
	   only the full-width form layout is page-specific. */
	.btn-primary {
		width: 100%;
	}

	.btn-oidc {
		display: block;
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg-secondary);
		color: var(--color-text-primary);
		border: 1px solid var(--color-border-translucent-hover);
		border-radius: var(--radius-md);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-semibold);
		text-align: center;
		text-decoration: none;
		cursor: pointer;
		transition: var(--transition-fast);
	}

	.btn-oidc:hover {
		background: var(--color-bg-tertiary);
		border-color: var(--color-accent-primary);
	}

	.divider {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		margin: var(--spacing-md) 0;
		color: var(--color-text-secondary);
		font-size: 0.8125rem;
	}

	.divider::before,
	.divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--color-border-translucent);
	}
</style>
