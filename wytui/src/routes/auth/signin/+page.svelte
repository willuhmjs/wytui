<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let loading = $state(false);

	let showOidc = $derived(data.oidcConfigured && (data.authMode === 'oidc' || data.authMode === 'both'));
	let showPassword = $derived(data.authMode !== 'oidc' || data.fallback);

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
		<p class="subtitle">Sign in to continue</p>

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
			<form method="POST" use:enhance={() => {
				loading = true;
				return async ({ update }) => {
					await update();
					loading = false;
				};
			}}>
				<div class="form-group">
					<label for="email">Email</label>
					<input
						type="email"
						id="email"
						name="email"
						value={form?.email || ''}
						placeholder="you@example.com"
						required
						disabled={loading}
					/>
				</div>

				<div class="form-group">
					<label for="password">Password</label>
					<input
						type="password"
						id="password"
						name="password"
						placeholder="••••••••"
						required
						disabled={loading}
					/>
				</div>

				<button type="submit" class="btn-primary" disabled={loading}>
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
		background: var(--bg-secondary);
		padding: var(--spacing-lg);
		z-index: 200;
	}

	.signin-card {
		width: 100%;
		max-width: 360px;
		background: var(--bg-elevated);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: var(--border-radius-lg);
		padding: var(--spacing-lg);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
	}

	.logo {
		text-align: center;
		margin-bottom: var(--spacing-sm);
	}

	.logo-gradient {
		font-size: 2rem;
		font-weight: 700;
		background: linear-gradient(135deg, var(--accent-primary) 0%, #8b5cf6 100%);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.subtitle {
		text-align: center;
		color: var(--text-secondary);
		margin-bottom: var(--spacing-lg);
		font-size: 0.875rem;
	}

	.form-group {
		margin-bottom: var(--spacing-md);
	}

	label {
		display: block;
		margin-bottom: var(--spacing-xs);
		color: var(--text-primary);
		font-weight: 500;
		font-size: 0.8125rem;
	}

	input {
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--bg-secondary);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: var(--border-radius-md);
		color: var(--text-primary);
		font-size: 0.875rem;
		transition: var(--transition-fast);
	}

	input:focus {
		outline: none;
		border-color: var(--accent-primary);
		box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
	}

	input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.success-message {
		background: rgba(16, 185, 129, 0.1);
		border: 1px solid var(--success);
		border-radius: var(--border-radius-md);
		padding: var(--spacing-sm) var(--spacing-md);
		color: var(--success);
		font-size: 0.8125rem;
		margin-bottom: var(--spacing-md);
	}

	.error-message {
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid var(--error);
		border-radius: var(--border-radius-md);
		padding: var(--spacing-sm) var(--spacing-md);
		color: var(--error);
		font-size: 0.8125rem;
		margin-bottom: var(--spacing-md);
	}

	.btn-primary {
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--accent-primary);
		color: white;
		border: none;
		border-radius: var(--border-radius-md);
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		transition: var(--transition-fast);
	}

	.btn-primary:hover:not(:disabled) {
		background: var(--accent-hover);
		transform: translateY(-1px);
	}

	.btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.btn-oidc {
		display: block;
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--bg-secondary);
		color: var(--text-primary);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: var(--border-radius-md);
		font-size: 0.875rem;
		font-weight: 600;
		text-align: center;
		text-decoration: none;
		cursor: pointer;
		transition: var(--transition-fast);
	}

	.btn-oidc:hover {
		background: var(--bg-tertiary);
		border-color: var(--accent-primary);
	}

	.divider {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		margin: var(--spacing-md) 0;
		color: var(--text-secondary);
		font-size: 0.8125rem;
	}

	.divider::before,
	.divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: rgba(255, 255, 255, 0.1);
	}
</style>
