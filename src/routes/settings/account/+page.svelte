<script lang="ts">
	import { getContext } from 'svelte';
	import PathBrowser from '$lib/components/ui/PathBrowser.svelte';
	import PasswordInput from '$lib/components/ui/PasswordInput.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import RefreshIcon from '$lib/components/icons/RefreshIcon.svelte';
	import ZapIcon from '$lib/components/icons/ZapIcon.svelte';
	import BellIcon from '$lib/components/icons/BellIcon.svelte';
	import UsersIcon from '$lib/components/icons/UsersIcon.svelte';
	import LockIcon from '$lib/components/icons/LockIcon.svelte';
	import ShieldIcon from '$lib/components/icons/ShieldIcon.svelte';
	import TrashIcon from '$lib/components/icons/TrashIcon.svelte';
	import ExternalLinkIcon from '$lib/components/icons/ExternalLinkIcon.svelte';
	import ImportSubscriptionsModal from '$lib/components/youtube/ImportSubscriptionsModal.svelte';
	import ExtensionMenu from '$lib/components/ExtensionMenu.svelte';

	const s = getContext<any>('settingsState');

	const activeSection = getContext<() => string>('activeSection');
</script>

{#if activeSection() === 'account'}
<div class="settings-section" id="account" >
					<h2>User Settings</h2>
					<p class="text-muted">Manage your account password.</p>
					<button
						class="btn btn-primary"
						onclick={() => s.openPasswordChange(s.data.session?.user?.id || '')}
					>
						Change Password
					</button>
				</div>
{/if}
{#if activeSection() === 'api-keys'}
				<div class="settings-section api-keys-section" id="api-keys">
					<h2>API Keys</h2>
					<p class="text-muted">
						Create keys for programmatic access. Use as <code
							>Authorization: Bearer &lt;key&gt;</code
						>
					</p>

					{#if s.newKeyResult}
						<div class="info-box warning-box">
							<strong>Copy your key now — it won't be shown again:</strong>
							<code class="api-key-display">{s.newKeyResult}</code>
							<button
								class="btn btn-secondary btn-sm btn-icon"
								onclick={() => {
									navigator.clipboard.writeText(s.newKeyResult!);
									s.addToast('success', 'Copied');
								}}
								aria-label="Copy key"
								title="Copy key"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path
										d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
									/></svg
								>
							</button>
							<button
								class="btn btn-secondary btn-sm btn-icon"
								onclick={() => (s.newKeyResult = null)}
								aria-label="Dismiss"
								title="Dismiss"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg
								>
							</button>
						</div>
					{/if}

					<div class="create-key-form">
						<input type="text" bind:value={s.newKeyName} placeholder="Key name (e.g. CI/CD)" />
						<button
							class="btn btn-primary btn-sm"
							onclick={s.createApiKey}
							disabled={!s.newKeyName.trim()}>Create Key</button
						>
					</div>

					{#if s.apiKeys.length > 0}
						<div class="api-keys-list">
							{#each s.apiKeys as key}
								<div class="api-key-item">
									<div class="api-key-info">
										<span class="api-key-name">{key.name}</span>
										<code class="api-key-prefix">{key.keyPrefix}...</code>
										<span class="api-key-meta">
											Created {new Date(key.createdAt).toLocaleDateString()}
											{#if key.lastUsedAt}
												· Last used {new Date(key.lastUsedAt).toLocaleDateString()}
											{/if}
										</span>
									</div>
									<button
										class="btn btn-danger btn-sm btn-icon"
										onclick={() => s.revokeApiKey(key.id)}
										aria-label="Revoke key"
										title="Revoke key"
									>
										<svg
											xmlns="http://www.w3.org/2000/svg"
											width="16"
											height="16"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
											><polyline points="3 6 5 6 21 6" /><path
												d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
											/></svg
										>
									</button>
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-muted">No API keys yet.</p>
					{/if}
				</div>
{/if}

{#if activeSection() === 'youtube'}
<div class="settings-section" id="youtube" >
					<h2>YouTube</h2>
					<p class="text-muted">
						Link your YouTube account to sync watch history, subscriptions, and playlists.
					</p>

					{#if s.youtubeLoading}
						<p class="text-muted">Loading YouTube status...</p>
					{:else if s.youtubeLink?.linked}
						<div class="youtube-status">
							<p class="youtube-link-info">
								Linked as <strong>{s.youtubeLink.channelName}</strong> · updated {new Date(
									s.youtubeLink.cookieUpdatedAt,
								).toLocaleDateString()}
								{#if s.youtubeLink.lastHistorySync}
									· last history sync {new Date(s.youtubeLink.lastHistorySync).toLocaleString()}
								{/if}
							</p>
						</div>

						{#if s.youtubeLink.lastError}
							<div class="info-box error-box">
								<strong>Session problem:</strong> your YouTube cookies are expired or authentication
								failed. Re-link your account using the wytui browser extension to keep syncing.
								<span class="error-detail">({s.youtubeLink.lastError})</span>
							</div>
						{/if}

						<h3>Sync</h3>
						<div class="youtube-toggles">
							<label>
								<input
									type="checkbox"
									checked={s.youtubeLink.toggles?.syncWatchedToYouTube ?? false}
									onchange={(e) =>
										s.updateYouTubeToggle('syncWatchedToYouTube', e.currentTarget.checked)}
								/>
								Sync watched status to YouTube
							</label>
							<label>
								<input
									type="checkbox"
									checked={s.youtubeLink.toggles?.syncHistoryToWytui ?? false}
									onchange={(e) =>
										s.updateYouTubeToggle('syncHistoryToWytui', e.currentTarget.checked)}
								/>
								Sync YouTube history to wytui
							</label>
							<label>
								<input
									type="checkbox"
									checked={s.youtubeLink.toggles?.syncWatchLater ?? false}
									onchange={(e) => s.updateYouTubeToggle('syncWatchLater', e.currentTarget.checked)}
								/>
								Sync Watch Later
							</label>
							<label>
								<input
									type="checkbox"
									checked={s.youtubeLink.toggles?.useFeedForNewVideos ?? false}
									onchange={(e) =>
										s.updateYouTubeToggle('useFeedForNewVideos', e.currentTarget.checked)}
								/>
								Use feed for new videos
							</label>
						</div>

						{#if s.jellyfinUsers.length > 1}
							<div class="form-group">
								<label for="jellyfin-user-select">Mark history as watched for (Jellyfin user)</label
								>
								<select
									id="jellyfin-user-select"
									value={s.jellyfinUserChoice}
									onchange={(e) => s.updateJellyfinUser((e.currentTarget as HTMLSelectElement).value)}
								>
									<option value="">Not set (sync skips Jellyfin)</option>
									{#each s.jellyfinUsers as u (u.id)}
										<option value={u.id}>{u.name}</option>
									{/each}
								</select>
								<p class="help-text">
									Used by "Sync YouTube history to wytui" to mark the matching library videos played
									in Jellyfin.
								</p>
							</div>
						{/if}

						<h3>Per-account overrides</h3>
						<p class="help-text">
							These replace the server-wide defaults for every download, subscription check, and
							sync made as this YouTube account.
						</p>

						<div class="form-group">
							<label for="accountProxyUrl">yt-dlp proxy URL</label>
							<input
								type="text"
								id="accountProxyUrl"
								bind:value={s.accountProxyUrl}
								placeholder="socks5://host:port (empty = server default)"
								class:invalid={!!s.accountProxyUrlError}
								aria-invalid={s.accountProxyUrlError ? 'true' : undefined}
							/>
							{#if s.accountProxyUrlError}
								<p class="help-text error-text" role="alert">{s.accountProxyUrlError}</p>
							{:else}
								<p class="help-text">
									Keep one stable egress IP per account — rotating IPs can trip YouTube's bot
									detection. SOCKS proxies automatically skip aria2c.
								</p>
							{/if}
						</div>

						<div class="form-group">
							<label for="accountExtraFlags">yt-dlp extra flags</label>
							<textarea
								id="accountExtraFlags"
								rows="3"
								bind:value={s.accountExtraFlagsText}
								placeholder={'--extractor-args youtube:player_client=web_safari\n--sleep-requests 1'}
							></textarea>
							<p class="help-text">
								One token per line — a flag and its value go on separate lines. Empty = server
								default.
							</p>
						</div>

						<h3>Notifications</h3>
						<div class="form-group">
							<label for="accountAppriseUrl">Apprise URL</label>
							<input
								type="text"
								id="accountAppriseUrl"
								bind:value={s.accountAppriseUrl}
								placeholder="http://apprise:8000 (empty = server default)"
							/>
							<p class="help-text">
								Set your own Apprise endpoint and this account's downloads notify it instead of the
								server-wide one. The toggles below then pick which events are sent.
							</p>
						</div>
						<div class="youtube-toggles">
							<label>
								<input type="checkbox" bind:checked={s.accountNotifyOnComplete} />
								Notify on download complete
							</label>
							<label>
								<input type="checkbox" bind:checked={s.accountNotifyOnFail} />
								Notify on download failure
							</label>
						</div>
						<div class="youtube-actions">
							<button
								class="btn btn-secondary"
								onclick={s.saveAccountSettings}
								disabled={s.savingAccountSettings || !!s.accountProxyUrlError}
							>
								{s.savingAccountSettings ? 'Saving…' : 'Save account settings'}
							</button>
							<button
								class="btn btn-secondary"
								onclick={s.testAccountNotifications}
								disabled={!s.accountAppriseUrl.trim()}
							>
								Send test notification
							</button>
							{#if s.accountSettingsResult}
								<span
									class="test-result"
									class:success={s.accountSettingsResult.success}
									class:error={!s.accountSettingsResult.success}
								>
									{s.accountSettingsResult.message}
								</span>
							{/if}
						</div>

						<h3>Actions</h3>
						<div class="youtube-actions">
							<button class="btn btn-primary" onclick={() => (s.showImportModal = true)}>
								Import Subscriptions
							</button>
							<button
								class="btn btn-secondary"
								onclick={() => s.exportSubscriptions('opml')}
								disabled={s.exportingOPML}
							>
								{s.exportingOPML ? 'Exporting…' : 'Export OPML'}
							</button>
							<button
								class="btn btn-secondary"
								onclick={() => s.exportSubscriptions('csv')}
								disabled={s.exportingCSV}
							>
								{s.exportingCSV ? 'Exporting…' : 'Export CSV'}
							</button>
							<button
								class="btn btn-secondary"
								onclick={s.syncWatchLater}
								disabled={s.syncingWatchLater}
							>
								{s.syncingWatchLater ? 'Syncing…' : 'Sync Watch Later'}
							</button>
							<button class="btn btn-secondary" onclick={s.syncHistory} disabled={s.syncingHistory}>
								{s.syncingHistory ? 'Syncing…' : 'Sync History Now'}
							</button>
							<button class="btn btn-danger" onclick={s.unlinkYouTube}> Unlink </button>
						</div>
					{:else}
						<p class="text-muted">
							Not linked — use the wytui browser extension to link your YouTube account.
						</p>
					{/if}

					<div class="youtube-links">
						<h3>Links</h3>
						<div class="link-buttons">
							<ExtensionMenu label="Browser extension" variant="button" />
							<a
								class="btn btn-secondary"
								href={s.REPO_URL}
								target="_blank"
								rel="noopener noreferrer"
							>
								Source code
								<ExternalLinkIcon width={14} height={14} />
							</a>
						</div>
					</div>
				</div>
{/if}

{#if activeSection() === 'jellyfin'}
<div class="settings-section" id="jellyfin" >
						<h2>Jellyfin</h2>
						<p class="text-muted">
							User-based rules for the Jellyfin integration — which users' watched status drives
							auto-cleanup. The server connection itself lives in App Settings → Jellyfin.
						</p>

						{#if s.jellyfinEnabled}
							<div class="cleanup-section">
								<div class="form-group">
									<label class="toggle-label">
										<input
											type="checkbox"
											bind:checked={s.settings.cleanupEnabled}
											onchange={() => {
												if (s.settings.cleanupEnabled && s.jellyfinUsers.length === 0) {
													s.loadJellyfinUsers();
												}
											}}
										/>
										Auto-Cleanup Watched Items
									</label>
									<p class="help-text">
										Automatically delete library items after all selected users have watched them
									</p>
								</div>

								{#if s.cleanupEnabled}
									<div class="form-group nested-field">
										<label>Watch Users</label>
										{#if s.loadingJellyfinUsers}
											<p class="text-muted">Loading users...</p>
										{:else if s.jellyfinUsers.length === 0}
											<button
												class="btn btn-secondary btn-sm btn-with-icon"
												onclick={s.loadJellyfinUsers}
											>
												<UsersIcon width={14} height={14} />
												{s.jellyfinUsersError ? 'Retry' : 'Load Jellyfin Users'}
											</button>
											{#if s.jellyfinUsersError}
												<span class="test-result error">{s.jellyfinUsersError}</span>
											{/if}
										{:else}
											<div class="user-checkboxes">
												{#each s.jellyfinUsers as user}
													<label class="checkbox-label">
														<input
															type="checkbox"
															checked={(s.settings.cleanupUserIds || []).includes(user.id)}
															onchange={() => s.toggleCleanupUser(user.id)}
														/>
														{user.name}
													</label>
												{/each}
											</div>
											<button
												class="btn btn-secondary btn-sm btn-with-icon"
												onclick={s.loadJellyfinUsers}
												style="margin-top: var(--spacing-sm); align-self: flex-start;"
											>
												<RefreshIcon width={14} height={14} />
												Refresh
											</button>
										{/if}
										<p class="help-text">
											Item is deleted only when ALL selected users have watched it
										</p>
									</div>

									<div class="form-row nested-field">
										<div class="form-group">
											<label for="cleanupInterval">Check Interval (hours)</label>
											<input
												type="number"
												id="cleanupInterval"
												value={s.settings.cleanupIntervalSeconds
													? Math.round(s.settings.cleanupIntervalSeconds / 3600)
													: 1}
												oninput={(e) => {
													const hours = parseFloat(e.currentTarget.value) || 1;
													s.settings.cleanupIntervalSeconds = Math.round(hours * 3600);
												}}
												min="1"
												max="24"
												step="1"
											/>
										</div>

										<div class="form-group">
											<label for="cleanupGraceHours">Grace Period (hours)</label>
											<input
												type="number"
												id="cleanupGraceHours"
												bind:value={s.settings.cleanupGraceHours}
												min="0"
												max="720"
												step="1"
											/>
											<p class="help-text">Wait time after all users watched before deleting</p>
										</div>
									</div>

									<div class="form-group nested-field">
										<label>Profile Types</label>
										<div class="user-checkboxes">
											<label class="checkbox-label">
												<input
													type="checkbox"
													checked={(s.settings.cleanupProfileTypes || []).includes('video')}
													onchange={() => {
														const types: string[] = s.settings.cleanupProfileTypes || [];
														s.settings.cleanupProfileTypes = types.includes('video')
															? types.filter((t: string) => t !== 'video')
															: [...types, 'video'];
													}}
												/>
												Video
											</label>
											<label class="checkbox-label">
												<input
													type="checkbox"
													checked={(s.settings.cleanupProfileTypes || []).includes('music')}
													onchange={() => {
														const types: string[] = s.settings.cleanupProfileTypes || [];
														s.settings.cleanupProfileTypes = types.includes('music')
															? types.filter((t: string) => t !== 'music')
															: [...types, 'music'];
													}}
												/>
												Music
											</label>
										</div>
										<p class="help-text">Which download types to auto-clean</p>
									</div>
								{/if}
							</div>
						{/if}
					</div>
{/if}
