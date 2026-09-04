<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { onSSEEvent } from "$lib/stores/sse.svelte";

	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { showConfirm } from '$lib/stores/modal.svelte';
	import { addToast } from '$lib/stores/toast.svelte';
	import { csrfFetch } from '$lib/utils/fetch';
	import { formatDuration, formatBytes } from '$lib/utils/format';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';

	interface Profile {
		id: string;
		name: string;
	}

	let playlist = $state<any>(null);
	let loading = $state(true);
	let loadError = $state('');

	let editing = $state(false);
	let editName = $state('');
	let editDescription = $state('');
	let saving = $state(false);
	let deleting = $state(false);

	let profiles = $state<Profile[]>([]);
	let selectedProfile = $state('');
	let downloadingItems = $state(new Set<string>());
	let downloadingAll = $state(false);

	let playlistId = $derived($page.params.id);
	let pendingCount = $derived(playlist?.items?.filter((i: any) => !i.download).length ?? 0);
	let hasDownloaded = $derived(playlist?.items?.some((i: any) => i.downloadId) ?? false);



	let unsubs: Array<() => void> = [];

	onMount(() => {
		loadPlaylist();
		loadProfiles();
		
		const refresh = () => loadPlaylist();
		unsubs.push(onSSEEvent('playlist:sync:progress', refresh));
		unsubs.push(onSSEEvent('playlist:sync:complete', refresh));
		unsubs.push(onSSEEvent('download:complete', refresh));
		unsubs.push(onSSEEvent('download:deleted', refresh));
	});

	onDestroy(() => {
		unsubs.forEach(unsub => unsub());
	});

	async function loadPlaylist() {
		loading = true;
		loadError = '';
		try {
			const res = await fetch(`/api/playlists/${playlistId}`);
			if (res.ok) {
				playlist = await res.json();
			} else if (res.status === 404) {
				loadError = 'Playlist not found';
			} else {
				loadError = 'Failed to load playlist';
			}
		} catch {
			loadError = 'Failed to load playlist';
		} finally {
			loading = false;
		}
	}

	async function loadProfiles() {
		try {
			const res = await fetch('/api/profiles');
			if (res.ok) {
				profiles = await res.json();
				if (!selectedProfile && profiles.length > 0) selectedProfile = profiles[0].id;
			}
		} catch {
			profiles = [];
		}
	}

	async function downloadItem(item: any) {
		if (!selectedProfile) {
			addToast('error', 'Select a download profile first');
			return;
		}
		downloadingItems.add(item.id);
		downloadingItems = downloadingItems;
		try {
			const res = await csrfFetch(`/api/playlists/${playlistId}/download`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ profileId: selectedProfile, itemIds: [item.id] }),
			});
			if (res.ok) {
				const data = await res.json();
				if (data.started > 0) {
					addToast('success', 'Download started');
					await loadPlaylist();
				} else {
					addToast('error', data.errors?.[0] || 'Failed to start download');
				}
			} else {
				addToast('error', 'Failed to start download');
			}
		} catch {
			addToast('error', 'Failed to start download');
		} finally {
			downloadingItems.delete(item.id);
			downloadingItems = downloadingItems;
		}
	}

	async function downloadAll() {
		if (!selectedProfile) {
			addToast('error', 'Select a download profile first');
			return;
		}
		downloadingAll = true;
		try {
			const res = await csrfFetch(`/api/playlists/${playlistId}/download`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ profileId: selectedProfile }),
			});
			if (res.ok) {
				const data = await res.json();
				addToast('success', `Started ${data.started} download(s)`);
				if (data.errors?.length) addToast('error', `${data.errors.length} failed to start`);
				await loadPlaylist();
			} else {
				addToast('error', 'Failed to start downloads');
			}
		} catch {
			addToast('error', 'Failed to start downloads');
		} finally {
			downloadingAll = false;
		}
	}

	function startEdit() {
		editName = playlist.name;
		editDescription = playlist.description || '';
		editing = true;
	}

	function cancelEdit() {
		editing = false;
	}

	async function saveEdit() {
		saving = true;
		try {
			const res = await csrfFetch(`/api/playlists/${playlistId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: editName, description: editDescription || null }),
			});
			if (res.ok) {
				playlist.name = editName;
				playlist.description = editDescription || null;
				editing = false;
				addToast('success', 'Playlist updated');
			} else {
				const data = await res.json().catch(() => null);
				addToast('error', data?.message || 'Failed to update playlist');
			}
		} catch {
			addToast('error', 'Failed to update playlist');
		} finally {
			saving = false;
		}
	}

	async function handleDelete() {
		const confirmed = await showConfirm(
			'Delete Playlist',
			`Delete "${playlist.name}"? This cannot be undone.`,
			'Delete',
		);
		if (!confirmed) return;

		deleting = true;
		try {
			const res = await csrfFetch(`/api/playlists/${playlistId}`, { method: 'DELETE' });
			if (res.ok) {
				addToast('success', 'Playlist deleted');
				goto('/playlists');
			} else {
				addToast('error', 'Failed to delete playlist');
			}
		} catch {
			addToast('error', 'Failed to delete playlist');
		} finally {
			deleting = false;
		}
	}

	async function removeItem(item: any) {
		const title = item.download?.title || item.title || 'this item';
		const confirmed = await showConfirm(
			'Remove Item',
			`Remove "${title}" from the playlist?`,
			'Remove',
		);
		if (!confirmed) return;

		// Downloaded items are keyed by downloadId; pending items only have their own id.
		const body = item.downloadId ? { downloadId: item.downloadId } : { itemId: item.id };

		try {
			const res = await csrfFetch(`/api/playlists/${playlistId}/items`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			if (res.ok) {
				playlist.items = playlist.items.filter((i: any) => i.id !== item.id);
				addToast('success', 'Item removed');
			} else {
				addToast('error', 'Failed to remove item');
			}
		} catch {
			addToast('error', 'Failed to remove item');
		}
	}

	let reordering = $state(false);

	async function moveItem(index: number, direction: 'top' | 'up' | 'down' | 'bottom') {
		const items = [...playlist.items];
		let targetIndex: number;
		if (direction === 'top') targetIndex = 0;
		else if (direction === 'up') targetIndex = index - 1;
		else if (direction === 'down') targetIndex = index + 1;
		else targetIndex = items.length - 1;

		const [moved] = items.splice(index, 1);
		items.splice(targetIndex, 0, moved);

		const previous = playlist.items;
		playlist.items = items;
		reordering = true;

		try {
			const res = await csrfFetch(`/api/playlists/${playlistId}/items`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ itemIds: items.map((i: any) => i.id) }),
			});
			if (!res.ok) {
				playlist.items = previous;
				addToast('error', 'Failed to reorder items');
			}
		} catch {
			playlist.items = previous;
			addToast('error', 'Failed to reorder items');
		} finally {
			reordering = false;
		}
	}

	function formatDate(date: string | Date): string {
		return new Date(date).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		});
	}

	function playPlaylist() {
		const firstDownloaded = playlist?.items?.find((i: any) => i.downloadId);
		if (!firstDownloaded) return;
		goto(`/downloads/${firstDownloaded.downloadId}?playlist=${playlistId}`);
	}
</script>

<svelte:head>
	<title>{playlist?.name || 'Playlist'} - wytui</title>
</svelte:head>

<div class="page">
	<a href="/playlists" class="back-link">
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
			<path
				d="M10 3L5 8L10 13"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
		Back to Playlists
	</a>

	{#if loading}
		<Skeleton count={4} variant="row" />
	{:else if loadError}
		<div class="empty-state">
			<p>{loadError}</p>
		</div>
	{:else if playlist}
		<div class="playlist-header">
			{#if editing}
				<div class="edit-form">
					<div class="form-group">
						<label for="edit-name">Name</label>
						<input type="text" id="edit-name" bind:value={editName} required />
					</div>
					<div class="form-group">
						<label for="edit-desc">Description</label>
						<input
							type="text"
							id="edit-desc"
							bind:value={editDescription}
							placeholder="Optional description"
						/>
					</div>
					<div class="edit-actions">
						<button class="btn btn-sm btn-primary" onclick={saveEdit} disabled={saving}>
							{saving ? 'Saving...' : 'Save'}
						</button>
						<button class="btn btn-sm btn-secondary" onclick={cancelEdit}>Cancel</button>
					</div>
				</div>
			{:else}
				<div class="header-info">
					<h2>{playlist.name}</h2>
					{#if playlist.description}
						<p class="text-muted">{playlist.description}</p>
					{/if}
					<p class="meta">
						{playlist.items.length} item{playlist.items.length !== 1 ? 's' : ''} · Created {formatDate(
							playlist.createdAt,
						)}
					</p>
				</div>
				<div class="header-actions">
					{#if hasDownloaded}
						<button
							class="btn btn-sm btn-primary"
							onclick={playPlaylist}
							aria-label="Play playlist"
							title="Play playlist"
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
							>
								<polygon points="5 3 19 12 5 21 5 3" />
							</svg>
							<span>Play Playlist</span>
						</button>
					{/if}
					<button
						class="btn btn-sm btn-icon btn-secondary"
						onclick={startEdit}
						aria-label="Edit playlist"
						title="Edit playlist"
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
							><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path
								d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
							/></svg
						>
					</button>
					<button
						class="btn btn-sm btn-icon btn-danger"
						onclick={handleDelete}
						disabled={deleting}
						aria-label="Delete playlist"
						title="Delete playlist"
					>
						{#if deleting}
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
								class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg
							>
						{:else}
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
						{/if}
					</button>
				</div>
			{/if}
		</div>

		{#if pendingCount > 0}
			<div class="pending-bar">
				<span class="pending-info">
					{pendingCount} video{pendingCount !== 1 ? 's' : ''} not downloaded yet
				</span>
				<div class="pending-controls">
					{#if profiles.length === 0}
						<span class="hint">
							<a href="/settings">Create a download profile</a> to download these.
						</span>
					{:else}
						<select bind:value={selectedProfile} aria-label="Download profile">
							{#each profiles as profile}
								<option value={profile.id}>{profile.name}</option>
							{/each}
						</select>
						<button
							class="btn btn-sm btn-primary"
							onclick={downloadAll}
							disabled={!selectedProfile || downloadingAll}
						>
							{downloadingAll ? 'Starting…' : 'Download All'}
						</button>
					{/if}
				</div>
			</div>
		{/if}

		{#if playlist.items.length === 0}
			<div class="empty-state">
				<p>This playlist is empty</p>
				<p class="text-muted">Add downloads to this playlist from the downloads page</p>
			</div>
		{:else}
			<div class="items-list">
				{#each playlist.items as item, index}
					<div class="item-card">
						<span class="item-position">{index + 1}</span>
						<div class="reorder-controls">
							<button
								class="reorder-btn"
								onclick={() => moveItem(index, 'top')}
								disabled={index === 0 || reordering}
								title="Move to top"
							>
								<svg
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2.5"
									><polyline points="17 11 12 6 7 11" /><polyline points="17 18 12 13 7 18" /></svg
								>
							</button>
							<button
								class="reorder-btn"
								onclick={() => moveItem(index, 'up')}
								disabled={index === 0 || reordering}
								title="Move up"
							>
								<svg
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2.5"><polyline points="18 15 12 9 6 15" /></svg
								>
							</button>
							<button
								class="reorder-btn"
								onclick={() => moveItem(index, 'down')}
								disabled={index === playlist.items.length - 1 || reordering}
								title="Move down"
							>
								<svg
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2.5"><polyline points="6 9 12 15 18 9" /></svg
								>
							</button>
							<button
								class="reorder-btn"
								onclick={() => moveItem(index, 'bottom')}
								disabled={index === playlist.items.length - 1 || reordering}
								title="Move to bottom"
							>
								<svg
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2.5"
									><polyline points="7 6 12 11 17 6" /><polyline points="7 13 12 18 17 13" /></svg
								>
							</button>
						</div>
						{#if item.download}
							<button
								class="item-content"
								onclick={() => goto(`/downloads/${item.downloadId}?playlist=${playlistId}`)}
							>
								{#if item.download.thumbnail}
									<img
										class="item-thumbnail"
										src={item.download.thumbnail}
										alt={item.download.title || 'Thumbnail'}
									/>
								{:else}
									<div class="item-thumbnail placeholder-thumb"></div>
								{/if}
								<div class="item-info">
									<h4>{item.download.title || 'Untitled'}</h4>
									<div class="item-meta">
										{#if item.download.uploader}
											<span>{item.download.uploader}</span>
										{/if}
										{#if item.download.duration}
											<span>{formatDuration(item.download.duration)}</span>
										{/if}
										{#if item.download.filesize}
											<span>{formatBytes(item.download.filesize)}</span>
										{/if}
									</div>
								</div>
							</button>
						{:else}
							<div class="item-content pending">
								{#if item.thumbnail}
									<img
										class="item-thumbnail"
										src={item.thumbnail}
										alt={item.title || 'Thumbnail'}
									/>
								{:else}
									<div class="item-thumbnail placeholder-thumb"></div>
								{/if}
								<div class="item-info">
									<h4>{item.title || 'Untitled'}</h4>
									<div class="item-meta">
										<span class="pending-badge">Not downloaded</span>
									</div>
								</div>
							</div>
						{/if}
						<div class="item-actions">
							{#if !item.download}
								<button
									class="btn btn-sm btn-primary"
									onclick={() => downloadItem(item)}
									disabled={!selectedProfile || downloadingItems.has(item.id)}
									title={selectedProfile ? 'Download this video' : 'Select a profile first'}
								>
									{downloadingItems.has(item.id) ? 'Starting…' : 'Download'}
								</button>
							{/if}
							<button
								class="btn btn-sm btn-icon btn-danger remove-btn"
								onclick={() => removeItem(item)}
								aria-label="Remove from playlist"
								title="Remove from playlist"
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
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<style>
	.page {
		max-width: 1000px;
		margin: 0 auto;
		width: 100%;
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		color: var(--color-text-secondary);
		text-decoration: none;
		font-size: 0.875rem;
		margin-bottom: var(--spacing-xl);
		transition: color var(--transition-fast);
	}

	.back-link:hover {
		color: var(--color-text-primary);
	}

	.empty-state {
		text-align: center;
		padding: var(--spacing-2xl);
		background: var(--color-bg-secondary);
		border: 1px dashed var(--color-border-default);
		border-radius: var(--radius-lg);
	}

	.empty-state p {
		margin-bottom: var(--spacing-sm);
	}

	.playlist-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--spacing-lg);
		margin-bottom: var(--spacing-xl);
		padding-bottom: var(--spacing-lg);
		border-bottom: 1px solid var(--color-border-default);
	}

	.header-info h2 {
		margin-bottom: var(--spacing-xs);
	}

	.header-info .text-muted {
		margin-bottom: var(--spacing-sm);
	}

	.meta {
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.header-actions {
		display: flex;
		gap: var(--spacing-sm);
		flex-shrink: 0;
	}

	.edit-form {
		width: 100%;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		margin-bottom: var(--spacing-md);
	}

	label {
		margin-bottom: var(--spacing-sm);
		color: var(--color-text-secondary);
		font-size: 0.875rem;
		font-weight: 500;
	}

	.edit-actions {
		display: flex;
		gap: var(--spacing-sm);
	}

	.pending-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-md);
		flex-wrap: wrap;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		padding: var(--spacing-sm) var(--spacing-md);
		margin-bottom: var(--spacing-md);
	}

	.pending-info {
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	.pending-controls {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.pending-controls select {
		padding: var(--spacing-xs) var(--spacing-sm);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-sm);
		color: var(--color-text-primary);
		font-size: 0.875rem;
	}

	.hint {
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.pending-badge {
		display: inline-block;
		padding: 1px 8px;
		border-radius: var(--radius-sm);
		background: var(--color-bg-tertiary);
		color: var(--color-text-tertiary);
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.item-content.pending {
		cursor: default;
	}

	.item-actions {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		flex-shrink: 0;
	}

	.items-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.item-card {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		padding: var(--spacing-md);
		transition: all var(--transition-normal);
	}

	.item-card:hover {
		border-color: var(--color-border-subtle);
	}

	.item-position {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		min-width: 1.5rem;
		text-align: center;
		flex-shrink: 0;
	}

	.item-content {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		flex: 1;
		min-width: 0;
		cursor: pointer;
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		text-align: left;
		padding: 0;
	}

	.item-content:hover h4 {
		color: var(--color-accent-primary);
	}

	.item-thumbnail {
		width: 80px;
		height: 45px;
		border-radius: var(--radius-sm);
		object-fit: cover;
		flex-shrink: 0;
	}

	.placeholder-thumb {
		background: var(--color-bg-tertiary);
	}

	.item-info {
		flex: 1;
		min-width: 0;
	}

	.item-info h4 {
		font-size: 0.9375rem;
		margin-bottom: var(--spacing-xs);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: color var(--transition-fast);
	}

	.item-meta {
		display: flex;
		gap: var(--spacing-md);
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.reorder-controls {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex-shrink: 0;
		opacity: 0;
		transition: opacity var(--transition-fast);
	}

	.item-card:hover .reorder-controls {
		opacity: 1;
	}

	.reorder-btn {
		background: none;
		border: none;
		color: var(--color-text-secondary);
		padding: 2px 4px;
		cursor: pointer;
		border-radius: var(--radius-sm);
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: unset;
		min-width: unset;
		transition:
			color var(--transition-fast),
			background var(--transition-fast);
	}

	.reorder-btn:hover:not(:disabled) {
		color: var(--color-text-primary);
		background: var(--color-bg-hover, var(--color-overlay-white-08));
	}

	.reorder-btn:disabled {
		opacity: 0.2;
		cursor: default;
	}

	.remove-btn {
		flex-shrink: 0;
	}

	:global(.btn-icon) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-sm) !important;
		line-height: 1;
	}

	:global(.btn-icon svg) {
		display: block;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	:global(.spin) {
		animation: spin 1s linear infinite;
	}

	@media (max-width: 768px) {
		.page {
			padding: 0 var(--spacing-sm);
		}

		.playlist-header {
			flex-direction: column;
		}

		.header-actions {
			width: 100%;
		}

		.header-actions .btn {
			flex: 1;
		}

		.item-card {
			padding: var(--spacing-sm);
		}

		.item-thumbnail {
			width: 60px;
			height: 34px;
		}

		.item-meta {
			flex-wrap: wrap;
			gap: var(--spacing-sm);
		}

		.item-info h4 {
			font-size: 0.875rem;
		}
	}
</style>
