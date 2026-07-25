<script lang="ts">
	import { goto } from '$app/navigation';
	import PasswordInput from '$lib/components/ui/PasswordInput.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let name = $state('');
	let error = $state('');
	let loading = $state(false);

	async function handleSubmit() {
		error = '';

		// Validation
		if (!email || !password || !name) {
			error = 'All fields are required';
			return;
		}

		if (password !== confirmPassword) {
			error = 'Passwords do not match';
			return;
		}

		loading = true;

		try {
			const response = await fetch('/api/setup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password, name }),
			});

			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.message || 'Failed to create admin account');
			}

			// Account created and session set by /api/setup — go straight to home
			goto('/', { invalidateAll: true });
		} catch (e: any) {
			error = e.message;
		} finally {
			loading = false;
		}
	}
</script>

<div class="setup-container">
	<div class="setup-card">
		<div class="logo">
			<div class="logo-gradient">wytui</div>
		</div>

		<h1>Welcome to wytui</h1>
		<p class="subtitle">Let's create your admin account to get started</p>

		<form
			onsubmit={(e) => {
				e.preventDefault();
				handleSubmit();
			}}
		>
			{#if error}
				<div class="error-message">{error}</div>
			{/if}

			<div class="form-group">
				<label for="name">Name</label>
				<input
					id="name"
					type="text"
					bind:value={name}
					placeholder="Your name"
					disabled={loading}
					required
				/>
			</div>

			<div class="form-group">
				<label for="email">Email</label>
				<input
					id="email"
					type="email"
					bind:value={email}
					placeholder="admin@example.com"
					disabled={loading}
					required
				/>
			</div>

			<div class="form-group">
				<label for="password">Password</label>
				<PasswordInput
					id="password"
					bind:value={password}
					placeholder="Enter a password"
					disabled={loading}
					required
				/>
				{#if password.length > 0}
					<div class="password-suggestions">
						<span class="suggestion" class:met={password.length >= 8}>8+ characters</span>
						<span class="suggestion" class:met={/[a-z]/.test(password)}>lowercase</span>
						<span class="suggestion" class:met={/[A-Z]/.test(password)}>uppercase</span>
						<span class="suggestion" class:met={/[0-9]/.test(password)}>number</span>
						<span class="suggestion" class:met={/[^a-zA-Z0-9]/.test(password)}
							>special character</span
						>
					</div>
				{/if}
			</div>

			<div class="form-group">
				<label for="confirm-password">Confirm Password</label>
				<PasswordInput
					id="confirm-password"
					bind:value={confirmPassword}
					placeholder="Re-enter your password"
					disabled={loading}
					required
				/>
			</div>

			<button type="submit" class="btn btn-primary" disabled={loading}>
				{loading ? 'Creating Account...' : 'Create Admin Account'}
			</button>
		</form>

		{#if data.oidcConfigured}
			<div class="divider">
				<span>or</span>
			</div>

			<a href="/auth/oidc" class="btn-oidc">
				Set up with {data.oidcDisplayName}
			</a>

			<p class="oidc-note">The first user to sign in becomes the admin.</p>
		{/if}

		<div class="info-box">
			<strong>Note:</strong> This will be the primary admin account with full access to wytui. You can
			create additional users later from the settings page.
		</div>
	</div>
</div>

<style>
	.setup-container {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-lg);
		background: var(--color-bg-secondary);
		z-index: 200;
		overflow-y: auto;
	}

	.setup-card {
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-overlay-white-10);
		border-radius: var(--radius-lg);
		padding: var(--spacing-lg);
		max-width: 380px;
		width: 100%;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
	}

	.logo {
		text-align: center;
		margin-bottom: var(--spacing-md);
	}

	.logo-gradient {
		font-size: 2rem;
		font-weight: 700;
		background: linear-gradient(135deg, var(--color-accent-primary) 0%, #8b5cf6 100%);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	h1 {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin-bottom: var(--spacing-xs);
		text-align: center;
	}

	.subtitle {
		color: var(--color-text-secondary);
		text-align: center;
		margin-bottom: var(--spacing-lg);
		font-size: 0.875rem;
	}

	.form-group {
		margin-bottom: var(--spacing-md);
	}

	label {
		display: block;
		color: var(--color-text-primary);
		font-weight: 500;
		margin-bottom: var(--spacing-xs);
		font-size: 0.8125rem;
	}

	input {
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-overlay-white-10);
		border-radius: var(--radius-md);
		color: var(--color-text-primary);
		font-size: 0.875rem;
		transition: var(--transition-fast);
	}

	input:focus {
		outline: none;
		border-color: var(--color-accent-primary);
		box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
	}

	input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	small {
		display: block;
		color: var(--color-text-tertiary);
		font-size: 0.6875rem;
		margin-top: var(--spacing-xs);
	}

	/* Appearance + hover come from the global .btn system (src/app.css);
	   only the full-width form layout is page-specific. */
	.btn-primary {
		width: 100%;
		margin-top: var(--spacing-sm);
	}

	.password-suggestions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: var(--spacing-xs);
	}

	.suggestion {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		opacity: 0.6;
		transition: all var(--transition-fast);
	}

	.suggestion.met {
		color: var(--color-status-success, #22c55e);
		opacity: 1;
	}

	.suggestion::before {
		content: '○ ';
	}

	.suggestion.met::before {
		content: '● ';
	}

	.error-message {
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid var(--color-status-error);
		color: var(--color-status-error);
		padding: var(--spacing-sm) var(--spacing-md);
		border-radius: var(--radius-md);
		margin-bottom: var(--spacing-md);
		font-size: 0.8125rem;
	}

	.info-box {
		margin-top: var(--spacing-md);
		padding: var(--spacing-sm) var(--spacing-md);
		background: rgba(59, 130, 246, 0.1);
		border: 1px solid rgba(59, 130, 246, 0.3);
		border-radius: var(--radius-md);
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		line-height: 1.5;
	}

	.info-box strong {
		color: var(--color-accent-primary);
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
		background: var(--color-overlay-white-10);
	}

	.btn-oidc {
		display: block;
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg-secondary);
		color: var(--color-text-primary);
		border: 1px solid var(--color-overlay-white-20);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-weight: 600;
		text-align: center;
		text-decoration: none;
		cursor: pointer;
		transition: var(--transition-fast);
	}

	.btn-oidc:hover {
		background: var(--color-bg-tertiary);
		border-color: var(--color-accent-primary);
	}

	.oidc-note {
		text-align: center;
		color: var(--color-text-tertiary);
		font-size: 0.75rem;
		margin-top: var(--spacing-sm);
	}
</style>
