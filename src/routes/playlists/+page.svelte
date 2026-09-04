<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { addToast } from '$lib/stores/toast.svelte';
	import { showConfirm } from '$lib/stores/modal.svelte';
	import { csrfFetch } from '$lib/utils/fetch';
	import { trapFocus } from '$lib/utils/a11y';
	import { onSSEEvent } from '$lib/stores/sse.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ViewToggle from '$lib/components/ui/ViewToggle.svelte';
	import FilterDropdown from '$lib/components/ui/FilterDropdown.svelte';
	import SearchInput from '$lib/components/ui/SearchInput.svelte';
	import SyncPlaylistsModal from '$lib/components/youtube/SyncPlaylistsModal.svelte';

	let playlists = $state<any[]>([]);
	let loading = $state(true);
	let viewMode = $state<'grid' | 'list'>('grid');
	let youtubeLinked = $state(false);
	let showSyncModal = $state(false);

	// List filters (client-side)
	let playlistsSearch = $state('');
	let playlistsSort = $state<'name' | 'itemCount' | 'updatedAt'>('name');

	let visiblePlaylists = $derived.by(() => {
		const query = playlistsSearch.trim().toLowerCase();
		const filtered = playlists.filter(
			(p) =>
				!query ||
				p.name?.toLowerCase().includes(query) ||
				p.description?.toLowerCase().includes(query),
		);
		const sorted = [...filtered];
		switch (playlistsSort) {
			case 'itemCount':
				sorted.sort((a, b) => (b.itemCount ?? 0) - (a.itemCount ?? 0));
				break;
			case 'updatedAt':
				sorted.sort(
					(a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime(),
				);
				break;
			default:
				sorted.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
		}
		return sorted;
	});

	let showCreateForm = $state(false);
	let formName = $state('');
	let formDescription = $state('');
	let formError = $state('');
	let creating = $state(false);

	let editingPlaylist = $state<any>(null);
	let editFormName = $state('');
	let editFormDescription = $state('');
	let editFormError = $state('');
	let updating = $state(false);
	let editModalEl: HTMLDivElement | null = $state(null);

	$effect(() => {
		if (editingPlaylist && editModalEl) {
			const release = trapFocus(editModalEl);
			return release;
		}
	});

	let unsubs: Array<() => void> = [];

	onMount(() => {
		loadPlaylists();
		checkYoutubeLink();

		const refresh = () => loadPlaylists();
		unsubs.push(onSSEEvent('playlist:sync:progress', refresh));
		unsubs.push(onSSEEvent('playlist:sync:complete', refresh));
		unsubs.push(onSSEEvent('download:complete', refresh));
		unsubs.push(onSSEEvent('download:deleted', refresh));
	});

	onDestroy(() => {
		unsubs.forEach(unsub => unsub());
	});

	async function checkYoutubeLink() {
		try {
			const res = await fetch('/api/youtube/link');
			if (res.ok) {
				const data = await res.json();
				youtubeLinked = !!data.linked;
			}
		} catch {
			youtubeLinked = false;
		}
	}

	async function loadPlaylists() {
		loading = true;
		try {
			const res = await fetch('/api/playlists');
			if (res.ok) {
				playlists = await res.json();
			}
		} catch (e) {
			console.error('Failed to load playlists:', e);
		} finally {
			loading = false;
		}
	}

	async function handleCreate(e: Event) {
		e.preventDefault();
		formError = '';
		creating = true;

		try {
			const res = await csrfFetch('/api/playlists', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: formName, description: formDescription || undefined }),
			});

			if (res.ok) {
				formName = '';
				formDescription = '';
				showCreateForm = false;
				addToast('success', 'Playlist created');
				await loadPlaylists();
			} else {
				const data = await res.json().catch(() => null);
				formError = data?.message || `Failed to create playlist (${res.status})`;
			}
		} catch {
			formError = 'Failed to create playlist';
		} finally {
			creating = false;
		}
	}

	function startEdit(playlist: any) {
		editingPlaylist = playlist;
		editFormName = playlist.name;
		editFormDescription = playlist.description || '';
		editFormError = '';
	}

	function cancelEdit() {
		editingPlaylist = null;
		editFormName = '';
		editFormDescription = '';
		editFormError = '';
	}

	async function handleUpdate(e: Event) {
		e.preventDefault();
		editFormError = '';
		updating = true;

		try {
			const res = await csrfFetch(`/api/playlists/${editingPlaylist.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: editFormName, description: editFormDescription || undefined }),
			});

			if (res.ok) {
				cancelEdit();
				addToast('success', 'Playlist updated');
				await loadPlaylists();
			} else {
				const data = await res.json().catch(() => null);
				editFormError = data?.message || `Failed to update playlist (${res.status})`;
			}
		} catch {
			editFormError = 'Failed to update playlist';
		} finally {
			updating = false;
		}
	}

	async function deletePlaylist(playlist: any) {
		const confirmed = await showConfirm(
			'Delete Playlist',
			`Delete "${playlist.name}"? This cannot be undone.`,
			'Delete',
		);
		if (!confirmed) return;

		try {
			const res = await csrfFetch(`/api/playlists/${playlist.id}`, { method: 'DELETE' });
			if (res.ok) {
				addToast('success', 'Playlist deleted');
				await loadPlaylists();
			} else {
				addToast('error', 'Failed to delete playlist');
			}
		} catch {
			addToast('error', 'Failed to delete playlist');
		}
	}

	function formatDate(date: string | Date): string {
		return new Date(date).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		});
	}
</script>

<svelte:head>
	<title>Playlists - wytui</title>
</svelte:head>

<div class="page">
	<div class="page-content">
		<div class="page-header">
			<div>
				<h2>Playlists</h2>
				<p class="text-muted">Organize your downloads into playlists</p>
			</div>
			<div class="header-right">
				<ViewToggle bind:view={viewMode} />
				{#if youtubeLinked}
					<button class="btn btn-secondary" onclick={() => (showSyncModal = true)}>
						Sync with YouTube
					</button>
				{/if}
				<button class="btn btn-primary" onclick={() => (showCreateForm = !showCreateForm)}>
					{showCreateForm ? 'Cancel' : 'Create Playlist'}
				</button>
			</div>
		</div>

		{#if showCreateForm}
			<form class="form-card" onsubmit={handleCreate}>
				<div class="form-group">
					<label for="playlist-name">Name</label>
					<input
						type="text"
						id="playlist-name"
						bind:value={formName}
						required
						placeholder="My Playlist"
					/>
				</div>
				<div class="form-group">
					<label for="playlist-desc">Description (optional)</label>
					<input
						type="text"
						id="playlist-desc"
						bind:value={formDescription}
						placeholder="A collection of..."
					/>
				</div>
				{#if formError}
					<p class="form-error">{formError}</p>
				{/if}
				<button type="submit" class="btn btn-primary" disabled={creating}>
					{creating ? 'Creating...' : 'Create'}
				</button>
			</form>
		{/if}

		{#if editingPlaylist}
			<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
			<div class="modal-backdrop" onclick={cancelEdit}>
				<div
					bind:this={editModalEl}
					class="modal"
					role="dialog"
					aria-modal="true"
					aria-label="Edit playlist"
					tabindex="-1"
					onclick={(e) => e.stopPropagation()}
					onkeydown={(e) => {
						if (e.key === 'Escape') cancelEdit();
					}}
				>
					<div class="modal-header">
						<h3>Edit Playlist</h3>
						<button class="modal-close" onclick={cancelEdit} aria-label="Close">
							<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
								<path
									d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
								/>
							</svg>
						</button>
					</div>
					<form onsubmit={handleUpdate}>
						<div class="form-group">
							<label for="edit-playlist-name">Name</label>
							<input
								type="text"
								id="edit-playlist-name"
								bind:value={editFormName}
								required
								placeholder="My Playlist"
							/>
						</div>
						<div class="form-group">
							<label for="edit-playlist-desc">Description (optional)</label>
							<input
								type="text"
								id="edit-playlist-desc"
								bind:value={editFormDescription}
								placeholder="A collection of..."
							/>
						</div>
						{#if editFormError}
							<p class="form-error">{editFormError}</p>
						{/if}
						<div class="modal-actions">
							<button type="button" class="btn btn-secondary" onclick={cancelEdit}>Cancel</button>
							<button type="submit" class="btn btn-primary" disabled={updating}>
								{updating ? 'Updating...' : 'Update'}
							</button>
						</div>
					</form>
				</div>
			</div>
		{/if}

		{#if playlists.length > 0}
			<div class="list-filters">
				<SearchInput
					bind:value={playlistsSearch}
					placeholder="Search playlists..."
					label="Search playlists"
				/>
				<FilterDropdown
					label="Sort playlists"
					bind:value={playlistsSort}
					options={[
						{ value: 'name', label: 'Name A–Z' },
						{ value: 'itemCount', label: 'Most videos' },
						{ value: 'updatedAt', label: 'Recently updated' },
					]}
				>
					{#snippet icon()}
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
							<path
								d="M2 4h10M4 7h6M6 10h2"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
							/>
						</svg>
					{/snippet}
				</FilterDropdown>
			</div>
		{/if}

		{#if loading && playlists.length === 0}
			<Skeleton count={4} variant="card" />
		{:else if playlists.length === 0}
			<EmptyState
				title="No playlists yet"
				description="Create a playlist to organize your downloads"
			/>
		{:else if viewMode === 'list'}
			<div class="content-list">
				{#if visiblePlaylists.length === 0}
					<p class="no-match-text">No playlists match your filters.</p>
				{/if}
				{#each visiblePlaylists as playlist (playlist.id)}
					<div class="list-row">
						<button class="list-row-main" onclick={() => goto(`/playlists/${playlist.id}`)}>
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<path d="M3 12h18M3 6h18M3 18h18" />
							</svg>
							<div class="list-row-info">
								<span class="list-row-name">{playlist.name}</span>
								{#if playlist.description}
									<span class="list-row-desc">{playlist.description}</span>
								{/if}
							</div>
							<span class="list-row-count"
								>{playlist.itemCount} item{playlist.itemCount !== 1 ? 's' : ''}</span
							>
							<span class="list-row-date">{formatDate(playlist.updatedAt)}</span>
						</button>
						<div class="list-row-actions">
							<button
								class="btn btn-sm btn-secondary"
								onclick={(e) => {
									e.stopPropagation();
									startEdit(playlist);
								}}
								title="Edit playlist"
								aria-label="Edit playlist"
							>
								<svg
									width="15"
									height="15"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path
										d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
									/></svg
								>
								Edit
							</button>
							<button
								class="btn btn-sm btn-danger"
								onclick={(e) => {
									e.stopPropagation();
									deletePlaylist(playlist);
								}}
								title="Delete playlist"
								aria-label="Delete playlist"
							>
								<svg
									width="15"
									height="15"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									><path
										d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
									/></svg
								>
								Delete
							</button>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<div class="content-grid">
				{#if visiblePlaylists.length === 0}
					<p class="no-match-text">No playlists match your filters.</p>
				{/if}
				{#each visiblePlaylists as playlist (playlist.id)}
					<div class="content-card">
						<button class="card-main" onclick={() => goto(`/playlists/${playlist.id}`)}>
							<div class="card-icon">
								<svg
									width="24"
									height="24"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<path d="M3 12h18M3 6h18M3 18h18" />
								</svg>
								<span class="icon-count">{playlist.itemCount}</span>
							</div>
							<div class="card-content">
								<h3 class="card-title">{playlist.name}</h3>
								{#if playlist.description}
									<p class="card-description">{playlist.description}</p>
								{:else}
									<p class="card-description empty">No description</p>
								{/if}
								<div class="card-footer">
									<span class="card-meta">Created {formatDate(playlist.createdAt)}</span>
									{#if playlist.updatedAt && playlist.updatedAt !== playlist.createdAt}
										<span class="card-meta">• Updated {formatDate(playlist.updatedAt)}</span>
									{/if}
								</div>
							</div>
						</button>
						<div class="card-actions">
							<button
								class="btn btn-sm btn-secondary"
								onclick={(e) => {
									e.stopPropagation();
									startEdit(playlist);
								}}
								title="Edit playlist"
								aria-label="Edit playlist"
							>
								<svg
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
									<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
								</svg>
								Edit
							</button>
							<button
								class="btn btn-sm btn-danger"
								onclick={(e) => {
									e.stopPropagation();
									deletePlaylist(playlist);
								}}
								title="Delete playlist"
								aria-label="Delete playlist"
							>
								<svg
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<path
										d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
									/>
								</svg>
								Delete
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<SyncPlaylistsModal bind:open={showSyncModal} onSynced={loadPlaylists} />

<style>
	.page {
		max-width: 1400px;
		margin: 0 auto;
		width: 100%;
	}

	.page-content {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-2xl);
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: var(--spacing-lg);
	}

	.page-header h2 {
		margin-bottom: var(--spacing-xs);
	}

	.page-header p {
		margin-top: var(--spacing-xs);
	}

	.form-card {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		padding: var(--spacing-xl);
		margin-bottom: var(--spacing-xl);
	}

	.form-group {
		display: flex;
		flex-direction: column;
		margin-bottom: var(--spacing-lg);
	}

	label {
		margin-bottom: var(--spacing-sm);
		color: var(--color-text-secondary);
		font-size: 0.875rem;
		font-weight: 500;
	}

	.form-error {
		color: var(--color-status-error, #ef4444);
		font-size: 0.85rem;
		margin: var(--spacing-xs) 0 var(--spacing-md);
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.content-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
		gap: var(--spacing-lg);
		width: 100%;
	}

	.list-filters {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		flex-wrap: wrap;
		margin-bottom: var(--spacing-lg);
	}

	.no-match-text {
		grid-column: 1 / -1;
		color: var(--color-text-secondary);
		text-align: center;
		padding: var(--spacing-xl) 0;
	}

	.content-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.list-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		padding: var(--spacing-sm) var(--spacing-md);
		transition: border-color var(--transition-fast);
	}

	.list-row:hover {
		border-color: var(--color-border-subtle);
		background: var(--color-bg-hover);
	}

	.list-row-main {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		flex: 1;
		min-width: 0;
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		padding: 0;
		min-height: unset;
	}

	.list-row-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.list-row-name {
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.list-row-desc {
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.list-row-count,
	.list-row-date {
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.list-row-actions {
		display: flex;
		gap: 4px;
		flex-shrink: 0;
	}

	.content-card {
		position: relative;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		overflow: hidden;
		transition: all var(--transition-normal);
	}

	.content-card:hover {
		border-color: var(--color-border-translucent-hover);
		transform: translateY(-3px);
		box-shadow:
			var(--shadow-lg),
			0 0 0 1px rgba(59, 130, 246, 0.05);
	}

	.content-card:hover .card-actions {
		opacity: 1;
		pointer-events: all;
	}

	.card-main {
		display: flex;
		gap: var(--spacing-lg);
		padding: var(--spacing-lg);
		width: 100%;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
		color: inherit;
		font: inherit;
		transition: background var(--transition-fast);
	}

	.card-main:hover {
		background: var(--color-bg-hover);
	}

	.card-icon {
		position: relative;
		flex-shrink: 0;
		width: 56px;
		height: 56px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%);
		border-radius: var(--radius-md);
		color: var(--color-accent-primary);
	}

	.icon-count {
		position: absolute;
		bottom: -4px;
		right: -4px;
		min-width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 6px;
		background: var(--color-accent-primary);
		color: white;
		font-size: 0.6875rem;
		font-weight: 700;
		border-radius: 12px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	}

	.card-content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.card-title {
		font-size: 1.0625rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.card-description {
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		line-height: 1.5;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		margin: 0;
	}

	.card-description.empty {
		color: var(--color-text-tertiary);
		font-style: italic;
	}

	.card-footer {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-xs);
		margin-top: auto;
		padding-top: var(--spacing-xs);
	}

	.card-meta {
		font-size: 0.6875rem;
		color: var(--color-text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		font-weight: 500;
	}

	.card-actions {
		position: absolute;
		top: var(--spacing-sm);
		right: var(--spacing-sm);
		display: flex;
		gap: var(--spacing-xs);
		opacity: 0;
		pointer-events: none;
		transition: opacity var(--transition-fast);
	}

	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: var(--color-overlay-medium);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: var(--z-modal);
		padding: var(--spacing-lg);
	}

	.modal {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		padding: var(--spacing-xl);
		max-width: var(--modal-max-width);
		width: 100%;
		box-shadow: var(--shadow-xl);
		outline: none;
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-lg);
	}

	.modal-header h3 {
		margin: 0;
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.modal-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.modal-close:hover {
		background: var(--color-bg-hover);
		color: var(--color-text-primary);
	}

	.modal-actions {
		display: flex;
		gap: var(--spacing-sm);
		justify-content: flex-end;
		margin-top: var(--spacing-lg);
	}

	@media (max-width: 768px) {
		.page {
			padding: 0 var(--spacing-sm);
		}

		.page-header {
			flex-direction: column;
			gap: var(--spacing-md);
		}

		.page-header .btn {
			width: 100%;
		}

		.content-grid {
			grid-template-columns: 1fr;
		}

		.form-card {
			padding: var(--spacing-md);
		}

		.card-main {
			padding: var(--spacing-md);
			gap: var(--spacing-md);
		}

		.card-icon {
			width: 48px;
			height: 48px;
		}

		.card-title {
			font-size: 1rem;
		}

		.card-actions {
			opacity: 1;
			pointer-events: all;
		}
	}
</style>
