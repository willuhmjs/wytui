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

{#if activeSection() === 'user-management'}
<div class="settings-section" id="user-management" >
						<div class="section-header">
							<h2>User Management</h2>
							<button class="btn btn-secondary" onclick={() => (s.showCreateUser = !s.showCreateUser)}>
								{s.showCreateUser ? 'Cancel' : '+ Add User'}
							</button>
						</div>

						{#if s.showCreateUser}
							<div class="create-user-form">
								<h3>Create New User</h3>

								{#if s.createUserError}
									<div class="error-message">{s.createUserError}</div>
								{/if}

								<div class="form-group">
									<label for="new-name">Name</label>
									<input
										type="text"
										id="new-name"
										bind:value={s.newUser.name}
										placeholder="John Doe"
									/>
								</div>

								<div class="form-group">
									<label for="new-email">Email</label>
									<input
										type="email"
										id="new-email"
										bind:value={s.newUser.email}
										placeholder="user@example.com"
									/>
								</div>

								<div class="form-group">
									<label for="new-password">Password</label>
									<PasswordInput
										id="new-password"
										bind:value={s.newUser.password}
										placeholder="Enter a password"
									/>
									{#if s.newUser.password.length > 0}
										<div class="password-suggestions">
											<span class="suggestion" class:met={s.newUser.password.length >= 8}
												>8+ characters</span
											>
											<span class="suggestion" class:met={/[a-z]/.test(s.newUser.password)}
												>lowercase</span
											>
											<span class="suggestion" class:met={/[A-Z]/.test(s.newUser.password)}
												>uppercase</span
											>
											<span class="suggestion" class:met={/[0-9]/.test(s.newUser.password)}
												>number</span
											>
											<span class="suggestion" class:met={/[^a-zA-Z0-9]/.test(s.newUser.password)}
												>special character</span
											>
										</div>
									{/if}
								</div>

								<div class="form-group">
									<label>
										<input type="checkbox" bind:checked={s.newUser.isAdmin} />
										Admin privileges
									</label>
								</div>

								<button class="btn btn-primary" onclick={s.createUser}>Create User</button>
							</div>
						{/if}

						<div class="users-search">
							<input
								type="text"
								placeholder="Search users by email or name"
								value={s.userSearch}
								oninput={(e) => s.onUserSearchInput(e.currentTarget.value)}
							/>
						</div>

						<div class="users-list">
							{#each s.users as user}
								<div class="user-card">
									<div class="user-info">
										<div class="user-name">
											{user.name}
											{#if user.isAdmin}
												<span class="badge badge-admin">Admin</span>
											{/if}
											{#if user.id === s.data.session?.user?.id}
												<span class="badge badge-you">You</span>
											{/if}
										</div>
										<div class="user-email">{user.email}</div>
										<div class="user-stats">
											{user._count.downloads} downloads • {user._count.subscriptions} subscriptions
										</div>
										<div class="user-overrides">
											<div class="user-override">
												<label for={`access-${user.id}`}>Library Access</label>
												<select
													id={`access-${user.id}`}
													value={s.userAccessValue(user)}
													onchange={(e) => s.updateUserLibraryAccess(user, e.currentTarget.value)}
												>
													<option value="default">Default</option>
													<option value="allowed">Allowed</option>
													<option value="denied">Denied</option>
												</select>
											</div>
											<div class="user-override">
												<label for={`quota-${user.id}`}>Cache Override (GB)</label>
												<div class="user-quota-input">
													<input
														type="number"
														id={`quota-${user.id}`}
														min="0"
														step="1"
														placeholder="Default"
														value={s.userQuotaDisplay(user)}
														oninput={(e) => (s.userQuotaDrafts[user.id] = e.currentTarget.value)}
													/>
													<button
														class="btn btn-secondary btn-sm"
														onclick={() => s.saveUserQuota(user)}>Save</button
													>
												</div>
											</div>
										</div>
									</div>
									<div class="user-actions">
										{#if user.id === s.data.session?.user?.id}
											<button
												class="btn btn-secondary btn-sm btn-with-icon"
												onclick={() => s.openPasswordChange(user.id)}
											>
												<LockIcon width={14} height={14} />
												Change Password
											</button>
										{:else if s.data.session?.user?.isAdmin && !user.isAdmin}
											<button
												class="btn btn-secondary btn-sm btn-with-icon"
												onclick={() => s.openPasswordChange(user.id)}
											>
												<LockIcon width={14} height={14} />
												Change Password
											</button>
										{/if}

										{#if s.data.session?.user?.isAdmin}
											<button
												class="btn btn-secondary btn-sm btn-with-icon"
												onclick={() => s.toggleAdmin(user)}
											>
												<ShieldIcon width={14} height={14} />
												{user.isAdmin ? 'Demote' : 'Promote'}
											</button>
										{/if}

										{#if s.data.session?.user?.isAdmin && user._count.downloads > 0}
											<button
												class="btn btn-danger btn-sm btn-with-icon"
												onclick={() => s.clearUserDownloads(user)}
											>
												<TrashIcon width={14} height={14} />
												Clear Downloads
											</button>
										{/if}

										{#if s.data.session?.user?.isAdmin}
											<button
												class="btn btn-danger btn-sm btn-with-icon"
												onclick={() => s.deleteUser(user)}
											>
												<TrashIcon width={14} height={14} />
												Delete
											</button>
										{/if}
									</div>
								</div>
							{/each}

							{#if s.users.length === 0}
								<EmptyState
									title={s.userSearch.trim() ? 'No users match your search' : 'No users found'}
									variant="subtle"
									size="sm"
								/>
							{/if}
						</div>

						{#if s.usersTotal > 0}
							<div class="users-pagination">
								<span class="users-pagination-info">
									{s.usersOffset + 1}–{Math.min(s.usersOffset + s.USERS_PAGE_SIZE, s.usersTotal)} of {s.usersTotal}
								</span>
								<div class="users-pagination-controls">
									<button
										class="btn btn-secondary btn-sm"
										onclick={s.usersPrevPage}
										disabled={s.usersOffset === 0 || s.usersLoading}
									>
										Prev
									</button>
									<button
										class="btn btn-secondary btn-sm"
										onclick={s.usersNextPage}
										disabled={s.usersOffset + s.USERS_PAGE_SIZE >= s.usersTotal || s.usersLoading}
									>
										Next
									</button>
								</div>
							</div>
						{/if}
					</div>
{/if}

{#if activeSection() === 'library-requests'}
<div class="settings-section" id="library-requests" >
						<div class="section-header">
							<h2>Library Requests</h2>
							<button
								class="btn btn-secondary btn-sm btn-with-icon"
								onclick={s.loadLibraryRequests}
								disabled={s.loadingRequests}
							>
								<RefreshIcon width={14} height={14} />
								Refresh
							</button>
						</div>
						<p class="text-muted">
							Pending requests from users to add downloads to the permanent library.
						</p>

						{#if s.libraryRequests.length > 0}
							<div class="requests-list">
								{#each s.libraryRequests as req}
									<div class="request-card">
										{#if req.download?.thumbnail}
											<img
												class="request-thumb"
												src={req.download.thumbnail}
												alt=""
												loading="lazy"
											/>
										{:else}
											<div class="request-thumb request-thumb-placeholder"></div>
										{/if}
										<div class="request-info">
											<span class="request-title">{req.download?.title || 'Untitled'}</span>
											{#if req.download?.uploader}
												<span class="request-uploader">{req.download.uploader}</span>
											{/if}
											<span class="request-meta">
												Requested by {req.user?.name || req.user?.email || 'Unknown'}
												· {new Date(req.createdAt).toLocaleDateString()}
											</span>
										</div>
										<div class="request-actions">
											<button
												class="btn btn-primary btn-sm"
												onclick={() => s.handleLibraryRequest(req.id, 'approve')}
												disabled={s.processingRequestId === req.id}
											>
												Approve
											</button>
											<button
												class="btn btn-danger btn-sm"
												onclick={() => s.handleLibraryRequest(req.id, 'deny')}
												disabled={s.processingRequestId === req.id}
											>
												Deny
											</button>
										</div>
									</div>
								{/each}
							</div>
						{:else}
							<EmptyState title="No pending requests" variant="subtle" size="sm" />
						{/if}
					</div>

					{/if}
					{#if activeSection() === 'danger-zone'}
					<div class="settings-section danger-zone" id="danger-zone">
						<h2>Danger Zone</h2>
						<div class="danger-row">
							<div class="danger-info">
								<div class="danger-title">Clear all downloads</div>
								<p class="help-text">
									Permanently delete every user’s downloads and remove the files from disk. This
									cannot be undone.
								</p>
							</div>
							<button
								class="btn btn-danger btn-with-icon"
								onclick={s.clearAllDownloads}
								disabled={s.clearingDownloads}
							>
								<TrashIcon width={16} height={16} />
								{s.clearingDownloads ? 'Clearing…' : 'Clear All Downloads'}
							</button>
						</div>
					</div>

{/if}
