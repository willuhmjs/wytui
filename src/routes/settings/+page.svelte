<script lang="ts">
	import { onMount } from 'svelte';
	import { showAlert, showConfirm } from '$lib/stores/modal.svelte';
	import PathBrowser from '$lib/components/ui/PathBrowser.svelte';

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
	let isAdmin = $derived(data.session?.user?.isAdmin ?? false);
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
		if (isAdmin) {
			await Promise.all([loadSettings(), loadUsers(), loadDiskInfo()]);
		}
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

	const SAVEABLE_FIELDS = ['maxConcurrentDownloads', 'downloadPath', 'ytdlpPath', 'autoUpdateYtdlp', 'updateCheckInterval', 'enableArchive', 'archivePath', 'authMode', 'libraryPath', 'musicLibraryPath', 'cacheQuotaBytes', 'jellyfinUrl', 'jellyfinApiKey'];

	let diskInfo = $state<{ totalBytes: string; availableBytes: string } | null>(null);
	let diskTotalGB = $derived(diskInfo ? Number(BigInt(diskInfo.totalBytes)) / (1024 * 1024 * 1024) : null);
	let cacheQuotaGB = $derived(settings ? Math.floor(Number(BigInt(settings.cacheQuotaBytes || '10737418240')) / (1024 * 1024 * 1024)) : 10);
	let cacheQuotaExceedsDisk = $derived(diskTotalGB !== null && cacheQuotaGB > diskTotalGB);
	let libraryEnabled = $derived(settings ? !!settings.libraryPath : false);
	let jellyfinEnabled = $derived(settings ? !!(settings.jellyfinUrl || settings.jellyfinApiKey) : false);

	async function loadDiskInfo() {
		try {
			const res = await fetch('/api/settings/disk');
			if (res.ok) {
				diskInfo = await res.json();
			}
		} catch {
			// disk info is best-effort
		}
	}

	function updateCacheQuota(gb: number) {
		if (settings) {
			settings.cacheQuotaBytes = String(Math.round(gb * 1024 * 1024 * 1024));
		}
	}

	function toggleLibrary(enabled: boolean) {
		if (!settings) return;
		if (enabled) {
			settings.libraryPath = settings.libraryPath || '/media';
		} else {
			settings.libraryPath = null;
			settings.musicLibraryPath = null;
		}
	}

	let testingJellyfin = $state(false);
	let jellyfinTestResult = $state<{ success: boolean; message: string } | null>(null);

	function toggleJellyfin(enabled: boolean) {
		if (!settings) return;
		jellyfinTestResult = null;
		if (enabled) {
			settings.jellyfinUrl = settings.jellyfinUrl || 'http://jellyfin:8096';
			settings.jellyfinApiKey = settings.jellyfinApiKey || '';
		} else {
			settings.jellyfinUrl = null;
			settings.jellyfinApiKey = null;
		}
	}

	async function testJellyfinConnection() {
		if (!settings?.jellyfinUrl || !settings?.jellyfinApiKey) return;
		testingJellyfin = true;
		jellyfinTestResult = null;
		try {
			const res = await fetch('/api/settings/jellyfin-test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: settings.jellyfinUrl, apiKey: settings.jellyfinApiKey }),
			});
			const data = await res.json();
			if (data.success) {
				jellyfinTestResult = { success: true, message: `Connected to ${data.serverName}` };
			} else {
				jellyfinTestResult = { success: false, message: data.error };
			}
		} catch {
			jellyfinTestResult = { success: false, message: 'Request failed' };
		} finally {
			testingJellyfin = false;
		}
	}

	async function saveSettings() {
		saving = true;
		try {
			const payload: Record<string, any> = {};
			for (const key of SAVEABLE_FIELDS) {
				if (key in settings) payload[key] = settings[key];
			}
			const res = await fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
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
	{#if isAdmin}
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
	{/if}

	{#if !isAdmin}
		<div class="settings-section">
			<h2>Account</h2>
			<p class="text-muted">Manage your account settings.</p>
			<button
				class="btn-primary"
				onclick={() => openPasswordChange(data.session?.user?.id || '')}
			>
				Change Password
			</button>
		</div>
	{:else if loading}
		<div class="loading">Loading...</div>
	{:else}
		{#if activeTab === 'general' && settings}
			<form onsubmit={(e) => { e.preventDefault(); saveSettings(); }}>
				<div class="settings-section">
					<h2>Storage</h2>

					<div class="form-row">
						<div class="form-group">
							<label for="downloadPath">Cache Path</label>
							<input
								type="text"
								id="downloadPath"
								bind:value={settings.downloadPath}
								readonly
							/>
							<p class="help-text">Temporary storage for downloads</p>
						</div>

						<div class="form-group">
							<label for="cacheQuota">Cache Quota (GB)</label>
							<input
								type="number"
								id="cacheQuota"
								value={cacheQuotaGB}
								oninput={(e) => updateCacheQuota(parseFloat(e.currentTarget.value) || 0)}
								min="1"
								max={diskTotalGB ? Math.floor(diskTotalGB) : undefined}
								step="1"
							/>
							{#if cacheQuotaExceedsDisk && diskTotalGB}
								<p class="help-text error-text">Exceeds total disk space ({diskTotalGB.toFixed(1)} GB)</p>
							{:else if diskTotalGB}
								<p class="help-text">{diskTotalGB.toFixed(1)} GB total on disk</p>
							{:else}
								<p class="help-text">Oldest downloads are auto-removed when exceeded</p>
							{/if}
						</div>
					</div>

					<div class="form-group">
						<label class="toggle-label">
							<input
								type="checkbox"
								checked={libraryEnabled}
								onchange={(e) => toggleLibrary(e.currentTarget.checked)}
							/>
							Enable Library
						</label>
						<p class="help-text">Save downloads permanently, organized by uploader</p>
					</div>

					{#if libraryEnabled}
						<div class="form-group nested-field">
							<label for="libraryPath">Video Library Path</label>
							<PathBrowser
								id="libraryPath"
								bind:value={settings.libraryPath}
								placeholder="/media"
							/>
						</div>

						<div class="form-group nested-field">
							<label for="musicLibraryPath">Music Library Path</label>
							<PathBrowser
								id="musicLibraryPath"
								bind:value={settings.musicLibraryPath}
								placeholder="/media/music"
							/>
							<p class="help-text">Audio-only downloads go here instead. Leave empty to use the video library path for everything.</p>
						</div>
					{/if}

					<div class="form-group">
						<label for="maxConcurrent">Max Concurrent Downloads</label>
						<input
							type="number"
							id="maxConcurrent"
							bind:value={settings.maxConcurrentDownloads}
							min="1"
							max="10"
						/>
					</div>

					<div class="form-group">
						<label>
							<input
								type="checkbox"
								bind:checked={settings.enableArchive}
							/>
							Deduplicate downloads
						</label>
						<p class="help-text">Track downloaded videos to prevent re-downloading the same content</p>
					</div>
				</div>

				<div class="settings-section">
					<h2>Jellyfin</h2>

					<div class="form-group">
						<label class="toggle-label">
							<input
								type="checkbox"
								checked={jellyfinEnabled}
								onchange={(e) => toggleJellyfin(e.currentTarget.checked)}
							/>
							Enable Jellyfin Integration
						</label>
						<p class="help-text">Triggers a library scan when downloads are saved to library</p>
					</div>

					{#if jellyfinEnabled}
						<div class="form-row nested-field">
							<div class="form-group">
								<label for="jellyfinUrl">Server URL</label>
								<input
									type="text"
									id="jellyfinUrl"
									bind:value={settings.jellyfinUrl}
									placeholder="http://jellyfin:8096"
								/>
							</div>

							<div class="form-group">
								<label for="jellyfinApiKey">API Key</label>
								<input
									type="password"
									id="jellyfinApiKey"
									bind:value={settings.jellyfinApiKey}
									placeholder="Enter API key"
								/>
								<p class="help-text">Dashboard > API Keys in Jellyfin</p>
							</div>
						</div>
						<div class="jellyfin-test nested-field">
							<button
								type="button"
								class="btn-secondary btn-sm"
								onclick={testJellyfinConnection}
								disabled={testingJellyfin || !settings.jellyfinUrl || !settings.jellyfinApiKey}
							>
								{testingJellyfin ? 'Testing...' : 'Test Connection'}
							</button>
							{#if jellyfinTestResult}
								<span class="test-result" class:success={jellyfinTestResult.success} class:error={!jellyfinTestResult.success}>
									{jellyfinTestResult.message}
								</span>
							{/if}
						</div>
					{/if}
				</div>

				<div class="settings-section">
					<h2>yt-dlp</h2>
					<div class="form-group">
						<label>
							<input
								type="checkbox"
								bind:checked={settings.autoUpdateYtdlp}
							/>
							Auto-update yt-dlp
						</label>
					</div>

					{#if settings.ytdlpVersion}
						<div class="info-box">
							<strong>Current version:</strong> {settings.ytdlpVersion}
						</div>
					{/if}
				</div>

				{#if settings.oidcConfigured}
					<div class="settings-section">
						<h2>Authentication</h2>
						<div class="form-group">
							<label for="authMode">Login Method</label>
							<select
								id="authMode"
								bind:value={settings.authMode}
							>
								<option value="password">Password Only</option>
								<option value="both">Password + {settings.oidcDisplayName || 'SSO'}</option>
								<option value="oidc">{settings.oidcDisplayName || 'SSO'} Only</option>
							</select>
							<p class="help-text">Choose which login methods are shown on the sign-in page</p>
						</div>

						{#if settings.authMode === 'oidc'}
							<div class="info-box warning-box">
								Password login will remain accessible at <code>/auth/signin?fallback=password</code> as a safety fallback in case SSO is unavailable.
							</div>
						{/if}
					</div>
				{/if}

				<button type="submit" class="btn-primary btn-lg" disabled={saving || cacheQuotaExceedsDisk}>
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
								placeholder="Enter a password"
							/>
							{#if newUser.password.length > 0}
								<div class="password-suggestions">
									<span class="suggestion" class:met={newUser.password.length >= 8}>8+ characters</span>
									<span class="suggestion" class:met={/[a-z]/.test(newUser.password)}>lowercase</span>
									<span class="suggestion" class:met={/[A-Z]/.test(newUser.password)}>uppercase</span>
									<span class="suggestion" class:met={/[0-9]/.test(newUser.password)}>number</span>
									<span class="suggestion" class:met={/[^a-zA-Z0-9]/.test(newUser.password)}>special character</span>
								</div>
							{/if}
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
		<div class="modal-overlay" role="button" tabindex="-1" onclick={closePasswordChange} onkeydown={(e) => { if (e.key === 'Escape') closePasswordChange(); }}>
			<div class="modal-content" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
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
							{#if passwordForm.newPassword.length > 0}
								<div class="password-suggestions">
									<span class="suggestion" class:met={passwordForm.newPassword.length >= 8}>8+ characters</span>
									<span class="suggestion" class:met={/[a-z]/.test(passwordForm.newPassword)}>lowercase</span>
									<span class="suggestion" class:met={/[A-Z]/.test(passwordForm.newPassword)}>uppercase</span>
									<span class="suggestion" class:met={/[0-9]/.test(passwordForm.newPassword)}>number</span>
									<span class="suggestion" class:met={/[^a-zA-Z0-9]/.test(passwordForm.newPassword)}>special character</span>
								</div>
							{/if}
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
	.page {
		max-width: 1400px;
		margin: 0 auto;
		width: 100%;
	}

	.tabs {
		display: flex;
		justify-content: center;
		gap: 4px;
		margin-bottom: var(--spacing-2xl);
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: 4px;
		width: fit-content;
		margin-left: auto;
		margin-right: auto;
	}

	.tab {
		padding: var(--spacing-sm) var(--spacing-xl);
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		font-weight: 500;
		font-size: 0.875rem;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.tab:hover:not(.active) {
		color: var(--text-primary);
		background: rgba(255, 255, 255, 0.05);
	}

	.tab.active {
		background: var(--accent-primary);
		color: #fff;
		font-weight: 600;
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

	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-lg);
	}

	@media (max-width: 600px) {
		.form-row {
			grid-template-columns: 1fr;
		}
	}

	.toggle-label {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		cursor: pointer;
		font-weight: 600;
	}

	.nested-field {
		margin-left: var(--spacing-xl);
		padding-left: var(--spacing-lg);
		border-left: 2px solid rgba(255, 255, 255, 0.1);
	}

	.jellyfin-test {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-lg);
	}

	.test-result {
		font-size: 0.8125rem;
		font-weight: 500;
	}

	.test-result.success {
		color: var(--success);
	}

	.test-result.error {
		color: var(--error);
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

	select {
		width: 100%;
		padding: var(--spacing-md);
		background: var(--bg-tertiary);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: var(--border-radius-md);
		color: var(--text-primary);
		font-size: 1rem;
	}

	select:focus,
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

	.error-text {
		color: var(--error);
	}

	.info-box {
		background: rgba(59, 130, 246, 0.1);
		border: 1px solid rgba(59, 130, 246, 0.3);
		border-radius: var(--border-radius-md);
		padding: var(--spacing-md);
		font-size: 0.875rem;
	}

	.warning-box {
		background: rgba(245, 158, 11, 0.1);
		border-color: rgba(245, 158, 11, 0.4);
		color: var(--text-primary);
	}

	.warning-box code {
		background: rgba(255, 255, 255, 0.1);
		padding: 2px 6px;
		border-radius: 4px;
		font-size: 0.8125rem;
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

	.password-suggestions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: var(--spacing-xs);
	}

	.suggestion {
		font-size: 0.75rem;
		color: var(--text-secondary);
		opacity: 0.6;
		transition: all var(--transition-fast);
	}

	.suggestion.met {
		color: var(--success, #22c55e);
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

	@media (max-width: 768px) {
		.page {
			padding: 0 var(--spacing-sm);
		}

		.tabs {
			width: 100%;
			flex-wrap: nowrap;
			overflow-x: auto;
			-webkit-overflow-scrolling: touch;
			scrollbar-width: none;
			margin-bottom: var(--spacing-lg);
		}

		.tabs::-webkit-scrollbar {
			display: none;
		}

		.tab {
			padding: var(--spacing-sm) var(--spacing-md);
			font-size: 0.8125rem;
			white-space: nowrap;
			flex-shrink: 0;
		}

		.settings-section {
			padding: var(--spacing-md);
		}

		.settings-section h2 {
			font-size: 1.25rem;
		}

		.form-group input[type='text'],
		.form-group input[type='number'],
		.form-group input[type='email'],
		.form-group input[type='password'],
		.form-group select {
			font-size: 1rem;
		}

		.section-header {
			flex-direction: column;
			gap: var(--spacing-md);
		}

		.section-header .btn-secondary {
			width: 100%;
		}

		.create-user-form {
			padding: var(--spacing-md);
		}

		.user-card {
			flex-direction: column;
			align-items: flex-start;
			padding: var(--spacing-md);
		}

		.user-actions {
			width: 100%;
			flex-wrap: wrap;
		}

		.user-actions button {
			flex: 1;
			min-width: 0;
		}

		.btn-lg {
			width: 100%;
		}

		.modal-content {
			margin: var(--spacing-sm);
		}

		.modal-header,
		.modal-body {
			padding: var(--spacing-md);
		}
	}
</style>
