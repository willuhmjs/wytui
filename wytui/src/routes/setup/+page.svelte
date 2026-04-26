<script lang="ts">
	import { goto } from '$app/navigation';

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

		if (password.length < 8) {
			error = 'Password must be at least 8 characters long';
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

			// Redirect to signin
			goto('/auth/signin?setup=complete');
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

		<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
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
				<input
					id="password"
					type="password"
					bind:value={password}
					placeholder="At least 8 characters"
					disabled={loading}
					required
				/>
				<small>Use a strong password with at least 8 characters</small>
			</div>

			<div class="form-group">
				<label for="confirm-password">Confirm Password</label>
				<input
					id="confirm-password"
					type="password"
					bind:value={confirmPassword}
					placeholder="Re-enter your password"
					disabled={loading}
					required
				/>
			</div>

			<button type="submit" class="btn-primary" disabled={loading}>
				{loading ? 'Creating Account...' : 'Create Admin Account'}
			</button>
		</form>

		<div class="info-box">
			<strong>Note:</strong> This will be the primary admin account with full access to wytui.
			You can create additional users later from the settings page.
		</div>
	</div>
</div>

<style>
	.setup-container {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-lg);
		background: linear-gradient(135deg, var(--bg-primary) 0%, var(--bg-secondary) 100%);
	}

	.setup-card {
		background: var(--bg-elevated);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: var(--border-radius-lg);
		padding: var(--spacing-xl);
		max-width: 480px;
		width: 100%;
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

	h1 {
		font-size: 1.75rem;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: var(--spacing-sm);
		text-align: center;
	}

	.subtitle {
		color: var(--text-secondary);
		text-align: center;
		margin-bottom: var(--spacing-xl);
	}

	.form-group {
		margin-bottom: var(--spacing-lg);
	}

	label {
		display: block;
		color: var(--text-primary);
		font-weight: 500;
		margin-bottom: var(--spacing-sm);
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

	small {
		display: block;
		color: var(--text-tertiary);
		font-size: 0.75rem;
		margin-top: var(--spacing-xs);
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
		margin-top: var(--spacing-md);
	}

	.btn-primary:hover:not(:disabled) {
		background: var(--accent-hover);
		transform: translateY(-1px);
	}

	.btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.error-message {
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid var(--error);
		color: var(--error);
		padding: var(--spacing-md);
		border-radius: var(--border-radius-md);
		margin-bottom: var(--spacing-lg);
		font-size: 0.875rem;
	}

	.info-box {
		margin-top: var(--spacing-lg);
		padding: var(--spacing-md);
		background: rgba(59, 130, 246, 0.1);
		border: 1px solid rgba(59, 130, 246, 0.3);
		border-radius: var(--border-radius-md);
		font-size: 0.875rem;
		color: var(--text-secondary);
	}

	.info-box strong {
		color: var(--accent-primary);
	}
</style>
