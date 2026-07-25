<script lang="ts">
	import { addToast } from '$lib/stores/toast.svelte';
	import { csrfFetch } from '$lib/utils/fetch';
	import { focusOnMount } from '$lib/utils/a11y';
	import ListPlusIcon from '$lib/components/icons/ListPlusIcon.svelte';

	let { downloadId, storagePool = 'library' }: { downloadId: string; storagePool?: string } =
		$props();

	const canAddToPlaylist = $derived(storagePool === 'library');

	let open = $state(false);
	let loading = $state(false);
	let playlists = $state<{ id: string; name: string; hasItem: boolean }[]>([]);
	let toggling = $state<Set<string>>(new Set());

	let showNewInput = $state(false);
	let newName = $state('');
	let creating = $state(false);

	let menuEl: HTMLDivElement | undefined = $state();
	let btnEl: HTMLButtonElement | undefined = $state();

	async function openMenu() {
		open = true;
		loading = true;
		try {
			const [allRes, itemRes] = await Promise.all([
				fetch('/api/playlists'),
				fetch(`/api/downloads/${downloadId}/playlists`),
			]);
			const all: { id: string; name: string }[] = allRes.ok ? await allRes.json() : [];
			const inPlaylists: { id: string; name: string }[] = itemRes.ok ? await itemRes.json() : [];
			const inSet = new Set(inPlaylists.map((p) => p.id));
			playlists = all.map((p) => ({ ...p, hasItem: inSet.has(p.id) }));
		} catch {
			addToast('error', 'Failed to load playlists');
			open = false;
		} finally {
			loading = false;
		}
	}

	function closeMenu() {
		open = false;
		showNewInput = false;
		newName = '';
	}

	function handleToggle() {
		if (open) {
			closeMenu();
		} else {
			openMenu();
		}
	}

	async function togglePlaylist(playlist: { id: string; name: string; hasItem: boolean }) {
		if (toggling.has(playlist.id)) return;
		toggling = new Set([...toggling, playlist.id]);

		const method = playlist.hasItem ? 'DELETE' : 'POST';
		try {
			const res = await csrfFetch(`/api/playlists/${playlist.id}/items`, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ downloadId }),
			});
			if (res.ok) {
				playlists = playlists.map((p) =>
					p.id === playlist.id ? { ...p, hasItem: !p.hasItem } : p,
				);
			} else {
				addToast(
					'error',
					playlist.hasItem ? 'Failed to remove from playlist' : 'Failed to add to playlist',
				);
			}
		} catch {
			addToast('error', 'Request failed');
		} finally {
			const next = new Set(toggling);
			next.delete(playlist.id);
			toggling = next;
		}
	}

	async function handleCreate(e: Event) {
		e.preventDefault();
		if (!newName.trim()) return;
		creating = true;
		try {
			const res = await csrfFetch('/api/playlists', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newName.trim() }),
			});
			if (!res.ok) {
				const data = await res.json().catch(() => null);
				addToast('error', data?.message || 'Failed to create playlist');
				return;
			}
			const created = await res.json();
			// Add download to new playlist immediately
			await csrfFetch(`/api/playlists/${created.id}/items`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ downloadId }),
			});
			playlists = [...playlists, { id: created.id, name: created.name, hasItem: true }];
			newName = '';
			showNewInput = false;
			addToast('success', `Added to "${created.name}"`);
		} catch {
			addToast('error', 'Failed to create playlist');
		} finally {
			creating = false;
		}
	}

	// Close on outside click
	$effect(() => {
		if (!open) return;
		function handler(e: MouseEvent) {
			if (
				menuEl &&
				!menuEl.contains(e.target as Node) &&
				btnEl &&
				!btnEl.contains(e.target as Node)
			) {
				closeMenu();
			}
		}
		function keyHandler(e: KeyboardEvent) {
			if (e.key === 'Escape') closeMenu();
		}
		window.addEventListener('mousedown', handler);
		window.addEventListener('keydown', keyHandler);
		return () => {
			window.removeEventListener('mousedown', handler);
			window.removeEventListener('keydown', keyHandler);
		};
	});
</script>

<div class="add-to-playlist-wrap">
	<button
		bind:this={btnEl}
		class="btn btn-secondary"
		onclick={handleToggle}
		disabled={!canAddToPlaylist}
		title={canAddToPlaylist ? 'Add to playlist' : 'Save to library to add to playlists'}
		aria-label="Add to playlist"
	>
		<ListPlusIcon />
		Playlist
	</button>

	{#if open}
		<div class="playlist-popover" bind:this={menuEl}>
			{#if loading}
				<div class="popover-loading">Loading...</div>
			{:else}
				<div class="popover-list">
					{#if playlists.length === 0}
						<div class="popover-empty">No playlists yet</div>
					{:else}
						{#each playlists as playlist}
							<button
								class="playlist-row"
								onclick={() => togglePlaylist(playlist)}
								disabled={toggling.has(playlist.id)}
							>
								<span class="playlist-check" class:checked={playlist.hasItem}>
									{#if playlist.hasItem}
										<svg
											width="12"
											height="12"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="3"
										>
											<polyline points="20 6 9 17 4 12" />
										</svg>
									{/if}
								</span>
								<span class="playlist-name">{playlist.name}</span>
								{#if toggling.has(playlist.id)}
									<span class="playlist-spinner"></span>
								{/if}
							</button>
						{/each}
					{/if}
				</div>

				<div class="popover-footer">
					{#if showNewInput}
						<form class="new-playlist-form" onsubmit={handleCreate}>
							<input
								class="new-playlist-input"
								type="text"
								placeholder="Playlist name"
								bind:value={newName}
								use:focusOnMount
								maxlength={100}
							/>
							<button
								class="btn btn-sm btn-primary"
								type="submit"
								disabled={creating || !newName.trim()}
							>
								{creating ? 'Creating…' : 'Create'}
							</button>
							<button
								class="btn btn-sm btn-ghost"
								type="button"
								onclick={() => {
									showNewInput = false;
									newName = '';
								}}
							>
								Cancel
							</button>
						</form>
					{:else}
						<button class="new-playlist-btn" onclick={() => (showNewInput = true)}>
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
							>
								<line x1="12" y1="5" x2="12" y2="19" />
								<line x1="5" y1="12" x2="19" y2="12" />
							</svg>
							New playlist
						</button>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.add-to-playlist-wrap {
		position: relative;
		display: inline-block;
	}

	.playlist-popover {
		position: absolute;
		bottom: calc(100% + 6px);
		left: 0;
		z-index: var(--z-dropdown);
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-dropdown);
		min-width: 220px;
		max-width: 280px;
		overflow: hidden;
	}

	.popover-loading,
	.popover-empty {
		padding: 12px 16px;
		color: var(--color-text-secondary);
		font-size: var(--font-size-sm);
	}

	.popover-list {
		max-height: 220px;
		overflow-y: auto;
	}

	.playlist-row {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px 12px;
		background: none;
		border: none;
		text-align: left;
		cursor: pointer;
		color: var(--color-text-primary);
		font-size: var(--font-size-sm);
		min-height: unset;
		min-width: unset;
		border-radius: 0;
		transition: background var(--transition-fast);
	}

	.playlist-row:hover:not(:disabled) {
		background: var(--color-overlay-hover);
	}

	.playlist-row:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.playlist-check {
		flex-shrink: 0;
		width: 16px;
		height: 16px;
		border-radius: var(--radius-sm);
		border: 1.5px solid var(--color-border-default);
		display: flex;
		align-items: center;
		justify-content: center;
		transition:
			background var(--transition-fast),
			border-color var(--transition-fast);
	}

	.playlist-check.checked {
		background: var(--color-accent-primary);
		border-color: var(--color-accent-primary);
		color: var(--color-text-on-accent);
	}

	.playlist-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.playlist-spinner {
		width: 12px;
		height: 12px;
		border: 2px solid var(--color-border-default);
		border-top-color: var(--color-accent-primary);
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
		flex-shrink: 0;
	}

	.popover-footer {
		border-top: 1px solid var(--color-border-default);
		padding: 8px;
	}

	.new-playlist-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 6px 8px;
		background: none;
		border: none;
		color: var(--color-text-secondary);
		font-size: var(--font-size-control);
		cursor: pointer;
		border-radius: var(--radius-sm);
		min-height: unset;
		transition:
			color var(--transition-fast),
			background var(--transition-fast);
	}

	.new-playlist-btn:hover {
		color: var(--color-text-primary);
		background: var(--color-overlay-hover);
	}

	.new-playlist-form {
		display: flex;
		gap: 6px;
		align-items: center;
	}

	.new-playlist-input {
		flex: 1;
		font-size: var(--font-size-control);
		padding: 4px 8px;
		min-width: 0;
	}
</style>
