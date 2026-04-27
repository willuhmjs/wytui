<script lang="ts">
	import { onMount } from 'svelte';
	import { showAlert, showConfirm } from '$lib/stores/modal.svelte';

	interface Props {
		data: {
			session: {
				user: {
					id: string;
					email: string;
					isAdmin: boolean;
				};
			} | null;
		};
	}

	let { data }: Props = $props();

	let settings = $state<any>(null);
	let users = $state<any[]>([]);
	let loading = $state(true);
	let saving = $state(false);
	let activeTab = $state<'general' | 'users'>('general');

	// Create user form
	let showCreateUser = $state(false);
	let newUser = $state({ email: '', password: '', name: '', isAdmin: false });
	let createUserError = $state('');

	// Password change form
	let passwordChangeUserId = $state<string | null>(null);
	let passwordForm = $state({
		newPassword: '',
		confirmPassword: '',
	});
	let passwordError = $state('');

	onMount(async () => {
		await Promise.all([loadSettings(), loadUsers()]);
	});

	async function loadSettings() {
		loading = true;
		try {
			const res = await fetch('/api/settings');
			if (res.ok) {
				settings = await res.json();
			}
		} catch (e) {
			console.error('Failed to load settings:', e);
		} finally {
			loading = false;
		}
	}

	async function loadUsers() {
		try {
			const res = await fetch('/api/users');
			if (res.ok) {
				users = await res.json();
			}
		} catch (e) {
			console.error('Failed to load users:', e);
		}
	}

	async function saveSettings() {
		saving = true;
		try {
			const res = await fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(settings),
			});
			if (res.ok) {
				await showAlert('Success', 'Settings saved successfully!');
			}
		} catch (e) {
			console.error('Failed to save settings:', e);
			await showAlert('Error', 'Failed to save settings');
		} finally {
			saving = false;
		}
	}

	async function toggleAdmin(user: any) {
		const confirmed = await showConfirm(
			`${user.isAdmin ? 'Demote' : 'Promote'} User`,
			`Are you sure you want to ${user.isAdmin ? 'demote' : 'promote'} ${user.name}?`,
			user.isAdmin ? 'Demote' : 'Promote'
		);
		if (!confirmed) return;

		try {
			const res = await fetch(`/api/users/${user.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ isAdmin: !user.isAdmin }),
			});

			if (res.ok) {
				await loadUsers();
			} else {
				const data = await res.json();
				await showAlert('Error', data.message || 'Failed to update user');
			}
		} catch (e: any) {
			await showAlert('Error', e.message || 'Failed to update user');
		}
	}

	async function deleteUser(user: any) {
		const confirmed = await showConfirm(
			'Delete User',
			`Are you sure you want to delete ${user.name}? This action cannot be undone.`,
			'Delete',
			'Cancel'
		);
		if (!confirmed) return;

		try {
			const res = await fetch(`/api/users/${user.id}`, {
				method: 'DELETE',
			});

			if (res.ok) {
				await loadUsers();
			} else {
				const data = await res.json();
				await showAlert('Error', data.message || 'Failed to delete user');
			}
		} catch (e: any) {
			await showAlert('Error', e.message || 'Failed to delete user');
		}
	}

	async function createUser() {
		createUserError = '';

		if (!newUser.email || !newUser.password || !newUser.name) {
			createUserError = 'All fields are required';
			return;
		}

		if (newUser.password.length < 8) {
			createUserError = 'Password must be at least 8 characters';
			return;
		}

		try {
			const res = await fetch('/api/users', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(newUser),
			});

			if (res.ok) {
				await loadUsers();
				showCreateUser = false;
				newUser = { email: '', password: '', name: '', isAdmin: false };
			} else {
				const data = await res.json();
				createUserError = data.message || 'Failed to create user';
			}
		} catch (e: any) {
			createUserError = e.message || 'Failed to create user';
		}
	}

	function openPasswordChange(userId: string) {
		passwordChangeUserId = userId;
		passwordForm = {
			newPassword: '',
			confirmPassword: '',
		};
		passwordError = '';
	}

	function closePasswordChange() {
		passwordChangeUserId = null;
		passwordForm = {
			newPassword: '',
			confirmPassword: '',
		};
		passwordError = '';
	}

	async function changePassword() {
		passwordError = '';

		if (!passwordChangeUserId) return;

		// Validation
		if (!passwordForm.newPassword) {
			passwordError = 'New password is required';
			return;
		}

		if (passwordForm.newPassword !== passwordForm.confirmPassword) {
			passwordError = 'Passwords do not match';
			return;
		}

		try {
			const res = await fetch(`/api/users/${passwordChangeUserId}/password`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ newPassword: passwordForm.newPassword }),
			});

			if (res.ok) {
				await showAlert('Success', 'Password changed successfully!');
				closePasswordChange();
			} else {
				const data = await res.json();
				passwordError = data.message || 'Failed to change password';
			}
		} catch (e: any) {
			passwordError = e.message || 'Failed to change password';
		}
	}
</script>

<svelte:head>
	<title>Settings - wytui</title>
</svelte:head>

<div class="page">
	<div class="tabs">
		<button
			class="tab"
			class:active={activeTab === 'general'}
			onclick={() => (activeTab = 'general')}
		>
			General
		</button>
		<button
			class="tab"
			class:active={activeTab === 'users'}
			onclick={() => (activeTab = 'users')}
		>
			Users
		</button>
	</div>

	{#if loading}
		<div class="loading">Loading...</div>
	{:else}
		{#if activeTab === 'general' && settings}
			<form onsubmit={(e) => { e.preventDefault(); saveSettings(); }}>
				<div class="settings-section">
					<h2>Downloads</h2>
					<div class="form-group">
						<label for="maxConcurrent">Max Concurrent Downloads</label>
						<input
							type="number"
							id="maxConcurrent"
							bind:value={settings.maxConcurrentDownloads}
							min="1"
							max="10"
						/>
						<p class="help-text">Number of simultaneous downloads (1-10)</p>
					</div>

					<div class="form-group">
						<label for="downloadPath">Download Path</label>
						<input
							type="text"
							id="downloadPath"
							bind:value={settings.downloadPath}
							readonly
						/>
						<p class="help-text">Location where files are saved</p>
					</div>
				</div>

				<div class="settings-section">
					<h2>yt-dlp</h2>
					<div class="form-group">
						<label>
							<input
								type="checkbox"
								bind:checked={settings.autoUpdateYtdlp}
							/>
							Auto-update yt-dlp binary
						</label>
						<p class="help-text">Automatically update yt-dlp when new versions are available</p>
					</div>

					{#if settings.ytdlpVersion}
						<div class="info-box">
							<strong>Current version:</strong> {settings.ytdlpVersion}
						</div>
					{/if}
				</div>

				<div class="settings-section">
					<h2>Archive</h2>
					<div class="form-group">
						<label>
							<input
								type="checkbox"
								bind:checked={settings.enableArchive}
							/>
							Enable download archive
						</label>
						<p class="help-text">Track downloaded videos to prevent re-downloading</p>
					</div>
				</div>

				<button type="submit" class="btn-primary btn-lg" disabled={saving}>
					{#if saving}
						Saving...
					{:else}
						Save Settings
					{/if}
				</button>
			</form>
		{/if}

		{#if activeTab === 'users'}
			<div class="settings-section">
				<div class="section-header">
					<h2>User Management</h2>
					<button class="btn-secondary" onclick={() => (showCreateUser = !showCreateUser)}>
						{showCreateUser ? 'Cancel' : '+ Add User'}
					</button>
				</div>

				{#if showCreateUser}
					<div class="create-user-form">
						<h3>Create New User</h3>

						{#if createUserError}
							<div class="error-message">{createUserError}</div>
						{/if}

						<div class="form-group">
							<label for="new-name">Name</label>
							<input
								type="text"
								id="new-name"
								bind:value={newUser.name}
								placeholder="John Doe"
							/>
						</div>

						<div class="form-group">
							<label for="new-email">Email</label>
							<input
								type="email"
								id="new-email"
								bind:value={newUser.email}
								placeholder="user@example.com"
							/>
						</div>

						<div class="form-group">
							<label for="new-password">Password</label>
							<input
								type="password"
								id="new-password"
								bind:value={newUser.password}
								placeholder="At least 8 characters"
							/>
						</div>

						<div class="form-group">
							<label>
								<input type="checkbox" bind:checked={newUser.isAdmin} />
								Admin privileges
							</label>
						</div>

						<button class="btn-primary" onclick={createUser}>Create User</button>
					</div>
				{/if}

				<div class="users-list">
					{#each users as user}
						<div class="user-card">
							<div class="user-info">
								<div class="user-name">
									{user.name}
									{#if user.isAdmin}
										<span class="badge badge-admin">Admin</span>
									{/if}
									{#if user.id === data.session?.user?.id}
										<span class="badge badge-you">You</span>
									{/if}
								</div>
								<div class="user-email">{user.email}</div>
								<div class="user-stats">
									{user._count.downloads} downloads • {user._count.subscriptions} subscriptions
								</div>
							</div>
							<div class="user-actions">
								<!-- Password change button -->
								{#if user.id === data.session?.user?.id}
									<!-- User can always change their own password -->
									<button
										class="btn-secondary btn-sm"
										onclick={() => openPasswordChange(user.id)}
									>
										Change Password
									</button>
								{:else if data.session?.user?.isAdmin && !user.isAdmin}
									<!-- Admin can change non-admin users' passwords -->
									<button
										class="btn-secondary btn-sm"
										onclick={() => openPasswordChange(user.id)}
									>
										Change Password
									</button>
								{/if}

								<!-- Admin toggle (admin only) -->
								{#if data.session?.user?.isAdmin}
									<button
										class="btn-secondary btn-sm"
										onclick={() => toggleAdmin(user)}
									>
										{user.isAdmin ? 'Demote' : 'Promote'}
									</button>
								{/if}

								<!-- Delete (admin only) -->
								{#if data.session?.user?.isAdmin}
									<button
										class="btn-danger btn-sm"
										onclick={() => deleteUser(user)}
									>
										Delete
									</button>
								{/if}
							</div>
						</div>
					{/each}

					{#if users.length === 0}
						<div class="empty-state">No users found</div>
					{/if}
				</div>
			</div>
		{/if}
	{/if}
</div>

	<!-- Password Change Modal -->
	{#if passwordChangeUserId}
		<div class="modal-overlay" onclick={closePasswordChange}>
			<div class="modal-content" onclick={(e) => e.stopPropagation()}>
				<div class="modal-header">
					<h3>Change Password</h3>
					<button class="modal-close" onclick={closePasswordChange}>&times;</button>
				</div>

				<div class="modal-body">
					{#if passwordError}
						<div class="error-message">{passwordError}</div>
					{/if}

					<form onsubmit={(e) => { e.preventDefault(); changePassword(); }}>
						<div class="form-group">
							<label for="new-password">New Password</label>
							<input
								type="password"
								id="new-password"
								bind:value={passwordForm.newPassword}
								placeholder="Enter new password"
								required
							/>
							<p class="help-text">
								Recommended: at least 8 characters with uppercase, lowercase, number, and special character
							</p>
						</div>

						<div class="form-group">
							<label for="confirm-password">Confirm New Password</label>
							<input
								type="password"
								id="confirm-password"
								bind:value={passwordForm.confirmPassword}
								placeholder="Re-enter new password"
								required
							/>
						</div>

						<div class="modal-actions">
							<button type="button" class="btn-secondary" onclick={closePasswordChange}>
								Cancel
							</button>
							<button type="submit" class="btn-primary">
								Change Password
							</button>
						</div>
					</form>
				</div>
			</div>
		</div>
	{/if}

<style>
	.tabs {
		display: flex;
		gap: var(--spacing-sm);
		margin-bottom: var(--spacing-xl);
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	}

	.tab {
		background: transparent;
		border: none;
		padding: var(--spacing-md) var(--spacing-lg);
		color: var(--text-secondary);
		font-weight: 500;
		cursor: pointer;
		border-bottom: 2px solid transparent;
		transition: var(--transition-fast);
	}

	.tab:hover {
		color: var(--text-primary);
	}

	.tab.active {
		color: var(--accent-primary);
		border-bottom-color: var(--accent-primary);
	}

	.loading {
		text-align: center;
		padding: var(--spacing-2xl);
		color: var(--text-secondary);
	}

	form {
		max-width: 800px;
	}

	.settings-section {
		background: var(--bg-secondary);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: var(--border-radius-lg);
		padding: var(--spacing-xl);
		margin-bottom: var(--spacing-lg);
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-lg);
	}

	.settings-section h2 {
		font-size: 1.25rem;
		margin-bottom: var(--spacing-lg);
	}

	.form-group {
		margin-bottom: var(--spacing-lg);
	}

	.form-group:last-child {
		margin-bottom: 0;
	}

	label {
		display: block;
		margin-bottom: var(--spacing-sm);
		color: var(--text-primary);
		font-weight: 500;
	}

	label input[type='checkbox'] {
		width: auto;
		margin-right: var(--spacing-sm);
	}

	input[type='text'],
	input[type='number'],
	input[type='email'],
	input[type='password'] {
		width: 100%;
		padding: var(--spacing-md);
		background: var(--bg-tertiary);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: var(--border-radius-md);
		color: var(--text-primary);
		font-size: 1rem;
	}

	input:focus {
		outline: none;
		border-color: var(--accent-primary);
	}

	input[readonly] {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.help-text {
		margin-top: var(--spacing-xs);
		font-size: 0.875rem;
		color: var(--text-secondary);
	}

	.info-box {
		background: rgba(59, 130, 246, 0.1);
		border: 1px solid rgba(59, 130, 246, 0.3);
		border-radius: var(--border-radius-md);
		padding: var(--spacing-md);
		font-size: 0.875rem;
	}

	.create-user-form {
		background: var(--bg-tertiary);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: var(--border-radius-md);
		padding: var(--spacing-lg);
		margin-bottom: var(--spacing-xl);
	}

	.create-user-form h3 {
		font-size: 1.125rem;
		margin-bottom: var(--spacing-lg);
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

	.users-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	.user-card {
		background: var(--bg-tertiary);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: var(--border-radius-md);
		padding: var(--spacing-lg);
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.user-info {
		flex: 1;
	}

	.user-name {
		font-weight: 600;
		font-size: 1.125rem;
		margin-bottom: var(--spacing-xs);
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.user-email {
		color: var(--text-secondary);
		font-size: 0.875rem;
		margin-bottom: var(--spacing-xs);
	}

	.user-stats {
		color: var(--text-tertiary);
		font-size: 0.875rem;
	}

	.user-actions {
		display: flex;
		gap: var(--spacing-sm);
	}

	.badge {
		display: inline-block;
		padding: 2px 8px;
		border-radius: 4px;
		font-size: 0.75rem;
		font-weight: 500;
	}

	.badge-admin {
		background: var(--accent-primary);
		color: white;
	}

	.btn-primary,
	.btn-secondary,
	.btn-danger {
		padding: var(--spacing-md) var(--spacing-lg);
		border: none;
		border-radius: var(--border-radius-md);
		font-weight: 600;
		cursor: pointer;
		transition: var(--transition-fast);
	}

	.btn-primary {
		background: var(--accent-primary);
		color: white;
	}

	.btn-primary:hover:not(:disabled) {
		background: var(--accent-hover);
	}

	.btn-secondary {
		background: var(--bg-tertiary);
		color: var(--text-primary);
		border: 1px solid rgba(255, 255, 255, 0.2);
	}

	.btn-secondary:hover {
		background: var(--bg-elevated);
	}

	.btn-danger {
		background: transparent;
		color: var(--error);
		border: 1px solid var(--error);
	}

	.btn-danger:hover {
		background: rgba(239, 68, 68, 0.1);
	}

	.btn-sm {
		padding: var(--spacing-sm) var(--spacing-md);
		font-size: 0.875rem;
	}

	.btn-lg {
		padding: var(--spacing-md) var(--spacing-xl);
		margin-top: var(--spacing-xl);
	}

	.btn-primary:disabled,
	.btn-secondary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.empty-state {
		text-align: center;
		padding: var(--spacing-2xl);
		color: var(--text-secondary);
	}

	.badge-you {
		background: rgba(59, 130, 246, 0.2);
		color: var(--accent-primary);
		border: 1px solid var(--accent-primary);
	}

	/* Modal styles */
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: var(--spacing-lg);
	}

	.modal-content {
		background: var(--bg-secondary);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: var(--border-radius-lg);
		max-width: 500px;
		width: 100%;
		max-height: 90vh;
		overflow-y: auto;
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-lg);
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	}

	.modal-header h3 {
		margin: 0;
		font-size: 1.25rem;
	}

	.modal-close {
		background: transparent;
		border: none;
		color: var(--text-secondary);
		font-size: 2rem;
		line-height: 1;
		cursor: pointer;
		padding: 0;
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: var(--transition-fast);
	}

	.modal-close:hover {
		color: var(--text-primary);
	}

	.modal-body {
		padding: var(--spacing-lg);
	}

	.modal-actions {
		display: flex;
		gap: var(--spacing-md);
		justify-content: flex-end;
		margin-top: var(--spacing-lg);
	}
</style>
