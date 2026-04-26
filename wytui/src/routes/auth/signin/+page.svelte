<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let loading = $state(false);
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

		<form method="POST" use:enhance={() => {
			loading = true;
			return async ({ update }) => {
				await update();
				loading = false;
			};
		}}>
			{#if data.setupComplete}
				<div class="success-message">Admin account created successfully! Please sign in.</div>
			{/if}

			{#if form?.error}
				<div class="error-message">{form.error}</div>
			{/if}

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
	</div>
</div>

<style>
	.signin-page {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(135deg, var(--bg-primary) 0%, var(--bg-secondary) 100%);
		padding: var(--spacing-lg);
	}

	.signin-card {
		width: 100%;
		max-width: 420px;
		background: var(--bg-elevated);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: var(--border-radius-lg);
		padding: var(--spacing-xl);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
	}

	.logo {
		text-align: center;
		margin-bottom: var(--spacing-lg);
	}

	.logo-gradient {
		font-size: 3rem;
		font-weight: 700;
		background: linear-gradient(135deg, var(--accent-primary) 0%, #8b5cf6 100%);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.subtitle {
		text-align: center;
		color: var(--text-secondary);
		margin-bottom: var(--spacing-xl);
		font-size: 1rem;
	}

	.form-group {
		margin-bottom: var(--spacing-lg);
	}

	label {
		display: block;
		margin-bottom: var(--spacing-sm);
		color: var(--text-primary);
		font-weight: 500;
		font-size: 0.875rem;
	}

	input {
		width: 100%;
		padding: var(--spacing-md);
		background: var(--bg-secondary);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: var(--border-radius-md);
		color: var(--text-primary);
		font-size: 1rem;
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
		padding: var(--spacing-md);
		color: var(--success);
		font-size: 0.875rem;
		margin-bottom: var(--spacing-lg);
	}

	.error-message {
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid var(--error);
		border-radius: var(--border-radius-md);
		padding: var(--spacing-md);
		color: var(--error);
		font-size: 0.875rem;
		margin-bottom: var(--spacing-lg);
	}

	.btn-primary {
		width: 100%;
		padding: var(--spacing-md);
		background: var(--accent-primary);
		color: white;
		border: none;
		border-radius: var(--border-radius-md);
		font-size: 1rem;
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
</style>
