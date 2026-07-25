<script lang="ts">
	import { addToast } from '$lib/stores/toast.svelte';
	import { csrfFetch } from '$lib/utils/fetch';
	import { trapFocus, uniqueId } from '$lib/utils/a11y';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import RefreshIcon from '$lib/components/icons/RefreshIcon.svelte';

	interface Channel {
		id: string;
		title: string;
		url: string;
		uploader?: string;
		channelId?: string;
		thumbnail?: string;
	}

	interface Profile {
		id: string;
		name: string;
	}

	interface Props {
		open: boolean;
		onImported?: (count: number) => void;
	}

	let { open = $bindable(), onImported }: Props = $props();

	let channels = $state<Channel[]>([]);
	let profiles = $state<Profile[]>([]);
	let loading = $state(false);
	let refreshing = $state(false);
	let importing = $state(false);
	let selected = $state(new Set<string>());
	let selectedProfile = $state('');
	let enabled = $state(true);
	let autoDownload = $state(true);
	let saveToLibrary = $state(false);
	let filter = $state('');

	// Guard for the staggered select/deselect wave — bumping it cancels the
	// pending timeouts of any earlier wave.
	let waveRun = 0;

	const filtered = $derived(
		filter.trim()
			? channels.filter((c) => {
					const q = filter.trim().toLowerCase();
					return (
						c.title.toLowerCase().includes(q) || (c.uploader?.toLowerCase().includes(q) ?? false)
					);
				})
			: channels,
	);

	const titleId = uniqueId('import-subs-title');
	const bodyId = uniqueId('import-subs-body');

	let dialogEl: HTMLDivElement | null = $state(null);
	let gridEl: HTMLDivElement | null = $state(null);

	$effect(() => {
		if (open && dialogEl) {
			const release = trapFocus(dialogEl);
			return release;
		}
	});

	$effect(() => {
		if (open) {
			void loadData();
		}
	});

	async function loadData(refresh = false) {
		// On refresh keep the existing cards visible (no skeleton) so the grid
		// doesn't flash empty; on first open show the loading skeleton.
		if (refresh) refreshing = true;
		else loading = true;
		filter = '';
		selected = new Set();
		waveRun++;
		try {
			const res = await fetch(`/api/youtube/subscriptions${refresh ? '?refresh=1' : ''}`);
			if (!res.ok) {
				addToast('error', 'Failed to load subscriptions');
				if (!refresh) close();
				return;
			}
			const data = await res.json();
			if (data.needsRelink) {
				addToast('error', 'YouTube session expired — re-link via the extension');
				if (!refresh) close();
				return;
			}
			channels = data.channels || [];
			// Select all by default.
			selected = new Set(channels.map((c) => c.id));

			// Load profiles once (only needed on the first open).
			if (!refresh && profiles.length === 0) {
				const profilesRes = await fetch('/api/profiles');
				if (profilesRes.ok) profiles = await profilesRes.json();
			}
		} catch {
			addToast('error', 'Failed to load subscriptions');
			if (!refresh) close();
		} finally {
			loading = false;
			refreshing = false;
		}
	}

	function toggle(id: string) {
		// Reassign a fresh Set — mutating in place and reassigning the same
		// reference doesn't register as a change in Svelte 5.
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected = next;
	}

	// Number of columns the grid is currently rendering, read from the resolved
	// grid-template-columns so the wave delay can follow the real layout.
	function columnCount(): number {
		if (!gridEl) return 1;
		const cols = getComputedStyle(gridEl).gridTemplateColumns.split(' ').filter(Boolean).length;
		return Math.max(1, cols);
	}

	// Apply select/deselect across the visible channels as a diagonal wave from
	// the top-left corner. Each card's change is delayed by (row + col).
	function runWave(select: boolean) {
		const runId = ++waveRun;
		const items = filtered;
		const reduced =
			typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

		const apply = (id: string) => {
			const next = new Set(selected);
			if (select) next.add(id);
			else next.delete(id);
			selected = next;
		};

		if (reduced) {
			for (const c of items) apply(c.id);
			return;
		}

		const cols = columnCount();
		const step = 35;
		items.forEach((c, i) => {
			const delay = (Math.floor(i / cols) + (i % cols)) * step;
			setTimeout(() => {
				if (runId !== waveRun) return;
				apply(c.id);
			}, delay);
		});
	}

	function refresh() {
		if (refreshing || loading) return;
		void loadData(true);
	}

	function selectAll() {
		runWave(true);
	}

	function deselectAll() {
		runWave(false);
	}

	async function importSubscriptions() {
		if (!selectedProfile) {
			addToast('error', 'Please select a download profile');
			return;
		}
		if (selected.size === 0) {
			addToast('error', 'Please select at least one channel');
			return;
		}
		importing = true;
		try {
			const chosen = channels.filter((c) => selected.has(c.id));
			const res = await csrfFetch('/api/youtube/subscriptions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					channels: chosen.map((c) => ({ url: c.url, name: c.title })),
					profileId: selectedProfile,
					enabled,
					autoDownload,
					saveToLibrary,
				}),
			});
			if (!res.ok) {
				addToast('error', 'Failed to import subscriptions');
				return;
			}
			const data = await res.json();
			const msg =
				data.skipped > 0
					? `Imported ${data.created} subscription(s) — skipped ${data.skipped} already subscribed`
					: `Imported ${data.created} subscription(s)`;
			addToast('success', msg);
			onImported?.(data.created);
			close();
		} catch {
			addToast('error', 'Failed to import subscriptions');
		} finally {
			importing = false;
		}
	}

	function close() {
		waveRun++;
		open = false;
	}

	function handleOverlayClick(e: MouseEvent) {
		if (e.target === e.currentTarget) close();
	}

	function handleDialogKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			close();
		}
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={handleOverlayClick}>
		<div
			bind:this={dialogEl}
			class="modal"
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
			aria-describedby={bodyId}
			tabindex="-1"
			onkeydown={handleDialogKeydown}
		>
			<div class="modal-header">
				<div class="header-text">
					<h3 id={titleId}>Import YouTube Subscriptions</h3>
					<p class="hint">
						Selected channels are added as subscriptions and polled for new uploads. Existing videos
						are not re-downloaded.
					</p>
				</div>
				<button class="btn-icon-close" onclick={close} aria-label="Close">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<line x1="18" y1="6" x2="6" y2="18" />
						<line x1="6" y1="6" x2="18" y2="18" />
					</svg>
				</button>
			</div>
			<div class="modal-body" id={bodyId}>
				{#if loading}
					<Skeleton count={6} variant="list" />
				{:else}
					<div class="import-config">
						<div class="form-group">
							<label for="profile-select">Download Profile</label>
							<select
								id="profile-select"
								bind:value={selectedProfile}
								disabled={profiles.length === 0}
							>
								<option value="">Select a profile</option>
								{#each profiles as profile}
									<option value={profile.id}>{profile.name}</option>
								{/each}
							</select>
							{#if profiles.length === 0}
								<p class="hint">
									No download profiles yet. <a href="/settings">Create one in Settings</a> before importing.
								</p>
							{/if}
						</div>

						<div class="form-group checkbox-group">
							<label>
								<input type="checkbox" bind:checked={enabled} />
								Enabled
							</label>
							<label>
								<input type="checkbox" bind:checked={autoDownload} />
								Auto-download new videos
							</label>
							<label>
								<input type="checkbox" bind:checked={saveToLibrary} />
								Save to library
							</label>
						</div>
					</div>

					{#if channels.length > 0}
						<div class="selection-bar">
							<span class="selection-count">{selected.size} of {channels.length} selected</span>
							<div class="selection-actions">
								<button class="btn-text" onclick={selectAll} type="button">Select All</button>
								<button class="btn-text" onclick={deselectAll} type="button">Deselect All</button>
								<button
									class="btn-refresh"
									onclick={refresh}
									type="button"
									disabled={refreshing}
									aria-label="Refresh subscriptions"
									title="Refresh (clears cache)"
								>
									<RefreshIcon width={14} height={14} class={refreshing ? 'spin-icon' : ''} />
									<span>Refresh</span>
								</button>
							</div>
						</div>

						{#if channels.length > 8}
							<div class="channel-filter">
								<input
									type="text"
									bind:value={filter}
									placeholder="Filter channels…"
									aria-label="Filter channels"
								/>
							</div>
						{/if}

						<div class="channel-grid" bind:this={gridEl}>
							{#each filtered as channel (channel.id)}
								<button
									type="button"
									class="channel-card"
									class:selected={selected.has(channel.id)}
									onclick={() => toggle(channel.id)}
									aria-pressed={selected.has(channel.id)}
								>
									<div class="card-thumb">
										{#if channel.thumbnail}
											<img src={channel.thumbnail} alt="" loading="lazy" />
										{:else}
											<span class="thumb-placeholder" aria-hidden="true">
												<svg
													width="28"
													height="28"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-linejoin="round"
												>
													<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
													<circle cx="12" cy="7" r="4" />
												</svg>
											</span>
										{/if}
										<span class="card-check" aria-hidden="true">
											{#if selected.has(channel.id)}
												<svg
													width="14"
													height="14"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="3"
													stroke-linecap="round"
													stroke-linejoin="round"
												>
													<polyline points="20 6 9 17 4 12" />
												</svg>
											{/if}
										</span>
									</div>
									<div class="card-body">
										<span class="card-title">{channel.title}</span>
										{#if channel.uploader && channel.uploader !== channel.title}
											<span class="card-uploader">{channel.uploader}</span>
										{/if}
									</div>
								</button>
							{:else}
								<p class="no-match text-muted">No channels match “{filter}”.</p>
							{/each}
						</div>
					{:else}
						<p class="text-muted">No subscriptions found.</p>
					{/if}
				{/if}
			</div>
			<div class="modal-footer">
				<button class="btn btn-secondary" onclick={close}>Cancel</button>
				<button
					class="btn btn-primary"
					onclick={importSubscriptions}
					disabled={loading || importing || !selectedProfile || selected.size === 0}
				>
					{importing ? 'Importing…' : `Import ${selected.size > 0 ? `(${selected.size})` : ''}`}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: var(--color-overlay-medium);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: var(--z-modal);
		animation: fadeIn var(--transition-fast);
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.modal {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		max-width: 700px;
		width: 90%;
		max-height: 90vh;
		display: flex;
		flex-direction: column;
		box-shadow: var(--shadow-xl);
		animation: slideUp 200ms ease;
		outline: none;
	}

	.modal:focus-visible {
		box-shadow:
			var(--shadow-xl),
			0 0 0 3px var(--color-focus-ring);
	}

	@keyframes slideUp {
		from {
			transform: translateY(20px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	.modal-header {
		padding: var(--spacing-lg);
		border-bottom: 1px solid var(--color-border-default);
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--spacing-md);
	}

	.header-text {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		min-width: 0;
	}

	.modal-header h3 {
		margin: 0;
		font-size: var(--font-size-xl);
		color: var(--color-text-primary);
	}

	.btn-icon-close {
		background: none;
		border: none;
		padding: var(--spacing-xs);
		cursor: pointer;
		color: var(--color-text-secondary);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
		transition: background var(--transition-fast);
	}

	.btn-icon-close:hover {
		background: var(--color-overlay-white-10);
		color: var(--color-text-primary);
	}

	.modal-body {
		padding: var(--spacing-lg);
		overflow-y: auto;
		flex: 1;
	}

	.hint {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.hint a {
		color: var(--color-accent-primary);
	}

	.import-config {
		margin-bottom: var(--spacing-lg);
	}

	.form-group {
		margin-bottom: var(--spacing-md);
	}

	.form-group > label {
		display: block;
		margin-bottom: var(--spacing-xs);
		color: var(--color-text-primary);
		font-weight: 500;
	}

	.form-group select {
		width: 100%;
		padding: var(--spacing-sm);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		color: var(--color-text-primary);
		font-size: var(--font-size-base);
	}

	.checkbox-group {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-md);
	}

	.checkbox-group label {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		margin: 0;
		font-weight: 400;
		color: var(--color-text-primary);
		cursor: pointer;
	}

	.selection-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-sm);
		margin-bottom: var(--spacing-sm);
	}

	.selection-count {
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	.selection-actions {
		display: flex;
		gap: var(--spacing-sm);
	}

	.btn-text {
		background: none;
		border: none;
		padding: var(--spacing-xs) var(--spacing-sm);
		cursor: pointer;
		color: var(--color-accent-primary);
		font-size: 0.875rem;
		border-radius: var(--radius-sm);
		transition: background var(--transition-fast);
	}

	.btn-text:hover {
		background: var(--color-overlay-white-10);
	}

	.btn-refresh {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		background: none;
		border: none;
		padding: var(--spacing-xs) var(--spacing-sm);
		cursor: pointer;
		color: var(--color-text-secondary);
		font-size: 0.875rem;
		border-radius: var(--radius-sm);
		transition:
			background var(--transition-fast),
			color var(--transition-fast);
	}

	.btn-refresh:hover:not(:disabled) {
		background: var(--color-overlay-white-10);
		color: var(--color-text-primary);
	}

	.btn-refresh:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.btn-refresh :global(.spin-icon) {
		animation: spin 0.8s linear infinite;
	}

	.channel-filter {
		margin-bottom: var(--spacing-sm);
	}

	.channel-filter input {
		width: 100%;
		padding: var(--spacing-xs) var(--spacing-sm);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-sm);
		color: var(--color-text-primary);
		font-size: 0.875rem;
	}

	.no-match {
		padding: var(--spacing-md);
		text-align: center;
		margin: 0;
		grid-column: 1 / -1;
	}

	.channel-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: var(--spacing-sm);
		padding-top: var(--spacing-xs);
	}

	.channel-card {
		display: flex;
		flex-direction: column;
		text-align: left;
		padding: 0;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		overflow: hidden;
		cursor: pointer;
		transition:
			border-color var(--transition-fast),
			box-shadow var(--transition-fast),
			transform var(--transition-fast);
	}

	.channel-card:hover {
		border-color: var(--color-border-translucent-hover);
		transform: translateY(-2px);
	}

	.channel-card.selected {
		border-color: var(--color-accent-primary);
		box-shadow: 0 0 0 1px var(--color-accent-primary);
	}

	.channel-card:focus-visible {
		outline: none;
		box-shadow: 0 0 0 3px var(--color-focus-ring);
	}

	.card-thumb {
		position: relative;
		width: 100%;
		aspect-ratio: 16 / 9;
		background: var(--color-bg-tertiary);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.card-thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.thumb-placeholder {
		color: var(--color-text-tertiary);
		display: flex;
	}

	.card-check {
		position: absolute;
		top: var(--spacing-xs);
		right: var(--spacing-xs);
		width: 22px;
		height: 22px;
		border-radius: var(--radius-full, 999px);
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-overlay-medium);
		border: 1.5px solid var(--color-text-inverse, #fff);
		color: var(--color-text-inverse, #fff);
		transition:
			background var(--transition-fast),
			border-color var(--transition-fast);
	}

	.channel-card.selected .card-check {
		background: var(--color-accent-primary);
		border-color: var(--color-accent-primary);
	}

	.card-body {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--spacing-sm);
		min-width: 0;
	}

	.card-title {
		font-weight: 500;
		color: var(--color-text-primary);
		font-size: 0.8125rem;
		line-height: 1.3;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.card-uploader {
		font-size: 0.6875rem;
		color: var(--color-text-tertiary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.text-muted {
		color: var(--color-text-secondary);
	}

	.modal-footer {
		padding: var(--spacing-lg);
		border-top: 1px solid var(--color-border-default);
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-md);
	}

	@media (max-width: 768px) {
		.modal {
			width: 95%;
		}

		.modal-header,
		.modal-body,
		.modal-footer {
			padding: var(--spacing-md);
		}

		.modal-footer {
			flex-direction: column-reverse;
		}

		.modal-footer button {
			width: 100%;
		}
	}
</style>
