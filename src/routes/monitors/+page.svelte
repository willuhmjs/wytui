<script lang="ts">
	import { onMount } from 'svelte';
	import { onSSEEvent } from '$lib/stores/sse.svelte';
	import { showConfirm } from '$lib/stores/modal.svelte';
	import { addToast, removeToast } from '$lib/stores/toast.svelte';
	import { csrfFetch } from '$lib/utils/fetch';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import FilterDropdown from '$lib/components/ui/FilterDropdown.svelte';
	import SearchInput from '$lib/components/ui/SearchInput.svelte';
	import CheckIcon from '$lib/components/icons/CheckIcon.svelte';
	import XIcon from '$lib/components/icons/XIcon.svelte';

	// Monitors state
	let monitors = $state<any[]>([]);
	let monitorsLoading = $state(false);
	let showMonitorsForm = $state(false);
	let monFormUrl = $state('');
	let monFormProfileId = $state('');
	let monFormType = $state('YOUTUBE_LIVE');
	let monFormAutoDownload = $state(true);
	let monFormOptions = $state({ sponsorblock: false, subtitles: false, metadata: false });

	// List filters (client-side)
	let monitorsSearch = $state('');
	let monitorsPlatformFilter = $state<'all' | 'YOUTUBE_LIVE' | 'TWITCH'>('all');
	let monitorsSort = $state<'name' | 'status' | 'platform'>('name');

	let visibleMonitors = $derived.by(() => {
		const query = monitorsSearch.trim().toLowerCase();
		const filtered = monitors.filter((m) => {
			const matchesSearch =
				!query || m.name?.toLowerCase().includes(query) || m.url?.toLowerCase().includes(query);
			const matchesPlatform = monitorsPlatformFilter === 'all' || m.type === monitorsPlatformFilter;
			return matchesSearch && matchesPlatform;
		});
		const sorted = [...filtered];
		switch (monitorsSort) {
			case 'status':
				sorted.sort((a, b) => Number(b.isLive ?? false) - Number(a.isLive ?? false));
				break;
			case 'platform':
				sorted.sort((a, b) => (a.type ?? '').localeCompare(b.type ?? ''));
				break;
			default:
				sorted.sort((a, b) => (a.name ?? a.url ?? '').localeCompare(b.name ?? b.url ?? ''));
		}
		return sorted;
	});

	// Monitor edit state
	let editingMonitor = $state<any | null>(null);
	let editMonName = $state('');
	let editMonUrl = $state('');
	let editMonType = $state('YOUTUBE_LIVE');
	let editMonProfileId = $state('');
	let editMonAutoDownload = $state(true);
	let editMonOptions = $state({ sponsorblock: false, subtitles: false, metadata: false });

	// Form error state
	let monFormError = $state('');

	// Shared state
	let profiles = $state<any[]>([]);

	function buildOptionsFlags(
		opts: { sponsorblock: boolean; subtitles: boolean; metadata: boolean },
		saveToLibrary = false,
	): string[] {
		const flags: string[] = [];
		if (opts.sponsorblock) flags.push('--sponsorblock-remove', 'sponsor,selfpromo');
		if (opts.subtitles)
			flags.push('--write-subs', '--write-auto-subs', '--embed-subs', '--sub-langs', 'en');
		if (opts.metadata) flags.push('--embed-metadata', '--embed-chapters');
		if (saveToLibrary) flags.push('--write-thumbnail');
		return flags;
	}

	function parseOptionsFromFlags(flags: string[]): {
		sponsorblock: boolean;
		subtitles: boolean;
		metadata: boolean;
	} {
		return {
			sponsorblock: flags.includes('--sponsorblock-remove'),
			subtitles: flags.includes('--write-subs') || flags.includes('--write-auto-subs'),
			metadata: flags.includes('--embed-metadata'),
		};
	}

	onMount(() => {
		loadProfiles();
		loadMonitors();

		const unsubMonitorLive = onSSEEvent('monitor:live', ({ name }) => {
			addToast('info', `Stream is live: ${name || 'Unknown'}`);
			loadMonitors();
		});
		const unsubMonitorUpdate = onSSEEvent('monitor:update', () => {
			loadMonitors();
		});

		return () => {
			unsubMonitorLive();
			unsubMonitorUpdate();
		};
	});

	async function loadProfiles() {
		try {
			const profilesRes = await fetch('/api/profiles');
			if (profilesRes.ok) {
				profiles = await profilesRes.json();
				const defaultProfile = profiles.find((p) => p.isDefault);
				if (defaultProfile) {
					monFormProfileId = defaultProfile.id;
				}
			}
		} catch (e) {
			console.error('Failed to load profiles:', e);
		}
	}

	async function loadMonitors() {
		monitorsLoading = true;
		try {
			const res = await fetch('/api/monitors');
			if (res.ok) {
				monitors = await res.json();
			}
		} catch (e) {
			console.error('Failed to load monitors:', e);
		} finally {
			monitorsLoading = false;
		}
	}

	async function handleMonitorsSubmit(e: Event) {
		e.preventDefault();
		monFormError = '';
		try {
			const res = await csrfFetch('/api/monitors', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					url: monFormUrl,
					name: monFormUrl,
					type: monFormType,
					profileId: monFormProfileId,
					autoDownload: monFormAutoDownload,
					customFlags: buildOptionsFlags(monFormOptions),
				}),
			});

			if (res.ok) {
				monFormUrl = '';
				monFormOptions = { sponsorblock: false, subtitles: false, metadata: false };
				showMonitorsForm = false;
				addToast('success', 'Monitor added');
				await loadMonitors();
			} else {
				const data = await res.json().catch(() => null);
				monFormError = data?.message || `Failed to create monitor (${res.status})`;
			}
		} catch (e) {
			monFormError = 'Failed to create monitor';
		}
	}

	async function toggleMonitor(id: string, enabled: boolean) {
		let toastId: string | null = null;
		const timer = setTimeout(() => {
			toastId = addToast('info', enabled ? 'Pausing monitor...' : 'Resuming monitor...', 10000);
		}, 350);
		try {
			await csrfFetch(`/api/monitors/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled: !enabled }),
			});
			await loadMonitors();
		} catch (e) {
			addToast('error', 'Failed to update monitor');
		} finally {
			clearTimeout(timer);
			if (toastId) removeToast(toastId);
		}
	}

	async function deleteMonitor(id: string) {
		const confirmed = await showConfirm(
			'Delete Monitor',
			'Are you sure you want to delete this monitor?',
			'Delete',
		);
		if (!confirmed) return;

		try {
			await csrfFetch(`/api/monitors/${id}`, { method: 'DELETE' });
			await loadMonitors();
		} catch (e) {
			console.error('Failed to delete monitor:', e);
		}
	}

	function startEditMonitor(monitor: any) {
		editingMonitor = monitor;
		editMonName = monitor.name;
		editMonUrl = monitor.url;
		editMonType = monitor.type;
		editMonProfileId = monitor.profileId;
		editMonAutoDownload = monitor.autoDownload;
		editMonOptions = parseOptionsFromFlags(monitor.customFlags || []);
	}

	function cancelEditMonitor() {
		editingMonitor = null;
	}

	async function saveEditMonitor() {
		if (!editingMonitor) return;
		try {
			const res = await csrfFetch(`/api/monitors/${editingMonitor.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: editMonName,
					url: editMonUrl,
					type: editMonType,
					profileId: editMonProfileId,
					autoDownload: editMonAutoDownload,
					customFlags: buildOptionsFlags(editMonOptions),
				}),
			});
			if (res.ok) {
				editingMonitor = null;
				await loadMonitors();
			}
		} catch (e) {
			console.error('Failed to update monitor:', e);
		}
	}

	function formatWaitTime(seconds: number | null): string {
		if (!seconds) return 'Checking...';

		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		const secs = seconds % 60;

		if (hours > 0) return `${hours}h ${minutes}m`;
		if (minutes > 0) return `${minutes}m ${secs}s`;
		return `${secs}s`;
	}
</script>

<svelte:head>
	<title>Monitors - wytui</title>
</svelte:head>

<div class="page">
	<div class="tab-content">
		<div class="tab-header">
			<div>
				<h2>Livestream Monitors</h2>
				<p class="text-muted">Monitor livestreams and auto-download when they go live</p>
			</div>
			<button class="btn btn-primary" onclick={() => (showMonitorsForm = !showMonitorsForm)}>
				{showMonitorsForm ? 'Cancel' : 'Add Monitor'}
			</button>
		</div>

		{#if showMonitorsForm}
			<form class="form-card" onsubmit={handleMonitorsSubmit}>
				<div class="form-row">
					<div class="form-group">
						<label for="mon-url">Stream URL</label>
						<input
							type="url"
							id="mon-url"
							bind:value={monFormUrl}
							required
							placeholder="https://www.youtube.com/@channel/live"
						/>
					</div>
					<div class="form-group">
						<label for="mon-type">Platform</label>
						<select id="mon-type" bind:value={monFormType}>
							<option value="YOUTUBE_LIVE">YouTube Live</option>
							<option value="TWITCH">Twitch</option>
						</select>
					</div>
				</div>

				<div class="form-group">
					<label for="mon-profile">Download Profile</label>
					<select id="mon-profile" bind:value={monFormProfileId} required>
						{#each profiles as profile}
							<option value={profile.id}>{profile.name}</option>
						{/each}
					</select>
				</div>

				<label class="checkbox-label">
					<input type="checkbox" bind:checked={monFormAutoDownload} />
					Auto-download when live
				</label>

				<div class="options-row">
					<span class="options-label">Options</span>
					<div class="options-chips">
						<button
							type="button"
							class="option-chip"
							class:active={monFormOptions.sponsorblock}
							onclick={() => (monFormOptions.sponsorblock = !monFormOptions.sponsorblock)}
							>SponsorBlock</button
						>
						<button
							type="button"
							class="option-chip"
							class:active={monFormOptions.subtitles}
							onclick={() => (monFormOptions.subtitles = !monFormOptions.subtitles)}
							>Subtitles</button
						>
						<button
							type="button"
							class="option-chip"
							class:active={monFormOptions.metadata}
							onclick={() => (monFormOptions.metadata = !monFormOptions.metadata)}>Metadata</button
						>
					</div>
				</div>

				{#if monFormError}
					<p class="form-error">{monFormError}</p>
				{/if}
				<button type="submit" class="btn btn-primary">Create Monitor</button>
			</form>
		{/if}

		{#if monitors.length > 0}
			<div class="list-filters">
				<SearchInput
					bind:value={monitorsSearch}
					placeholder="Search monitors..."
					label="Search monitors"
				/>
				<FilterDropdown
					label="Filter by platform"
					bind:value={monitorsPlatformFilter}
					options={[
						{ value: 'all', label: 'All platforms' },
						{ value: 'YOUTUBE_LIVE', label: 'YouTube Live' },
						{ value: 'TWITCH', label: 'Twitch' },
					]}
				/>
				<FilterDropdown
					label="Sort monitors"
					bind:value={monitorsSort}
					options={[
						{ value: 'name', label: 'Name A–Z' },
						{ value: 'status', label: 'Live first' },
						{ value: 'platform', label: 'Platform' },
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

		{#if monitorsLoading && monitors.length === 0}
			<Skeleton count={3} variant="card" />
		{:else if monitors.length === 0}
			<EmptyState title="No monitors yet" description="Add a livestream URL to start monitoring" />
		{:else}
			<div class="content-grid">
				{#if visibleMonitors.length === 0}
					<p class="no-match-text">No monitors match your filters.</p>
				{/if}
				{#each visibleMonitors as monitor (monitor.id)}
					<div class="content-card" class:live={monitor.isLive}>
						{#if editingMonitor?.id === monitor.id}
							<div class="edit-form">
								<div class="form-row">
									<div class="form-group">
										<label for="edit-monitor-url">URL</label>
										<input type="url" id="edit-monitor-url" bind:value={editMonUrl} />
									</div>
									<div class="form-group">
										<label for="edit-monitor-type">Platform</label>
										<select id="edit-monitor-type" bind:value={editMonType}>
											<option value="YOUTUBE_LIVE">YouTube Live</option>
											<option value="TWITCH">Twitch</option>
										</select>
									</div>
								</div>
								<div class="form-group">
									<label for="edit-monitor-profile">Profile</label>
									<select id="edit-monitor-profile" bind:value={editMonProfileId}>
										{#each profiles as profile}
											<option value={profile.id}>{profile.name}</option>
										{/each}
									</select>
								</div>
								<label class="checkbox-label">
									<input type="checkbox" bind:checked={editMonAutoDownload} />
									Auto-download when live
								</label>
								<div class="options-row">
									<span class="options-label">Options</span>
									<div class="options-chips">
										<button
											type="button"
											class="option-chip"
											class:active={editMonOptions.sponsorblock}
											onclick={() => (editMonOptions.sponsorblock = !editMonOptions.sponsorblock)}
											>SponsorBlock</button
										>
										<button
											type="button"
											class="option-chip"
											class:active={editMonOptions.subtitles}
											onclick={() => (editMonOptions.subtitles = !editMonOptions.subtitles)}
											>Subtitles</button
										>
										<button
											type="button"
											class="option-chip"
											class:active={editMonOptions.metadata}
											onclick={() => (editMonOptions.metadata = !editMonOptions.metadata)}
											>Metadata</button
										>
									</div>
								</div>
								<div class="actions">
									<button
										class="btn btn-sm btn-primary"
										onclick={saveEditMonitor}
										aria-label="Save"
										title="Save"
									>
										<CheckIcon />
										Save
									</button>
									<button
										class="btn btn-sm btn-secondary"
										onclick={cancelEditMonitor}
										aria-label="Cancel"
										title="Cancel"
									>
										<XIcon />
										Cancel
									</button>
								</div>
							</div>
						{:else}
							<div class="card-header">
								<h3>{monitor.name}</h3>
								{#if monitor.isLive}
									<span class="live-badge">LIVE</span>
								{:else if monitor.enabled}
									<span class="status enabled">Monitoring</span>
								{:else}
									<span class="status">Paused</span>
								{/if}
							</div>

							<p class="url">{monitor.url}</p>

							<div class="meta">
								<span>{monitor.type === 'TWITCH' ? 'Twitch' : 'YouTube Live'}</span>
								<span>Profile: {monitor.profile.name}</span>
							</div>

							{#if monitor.waitTime && !monitor.isLive}
								<div class="wait-info">
									<span class="label">Goes live in:</span>
									<span class="time">{formatWaitTime(monitor.waitTime)}</span>
								</div>
							{/if}

							{#if monitor.liveDate && !monitor.isLive}
								<p class="text-muted text-sm">
									Expected: {new Date(monitor.liveDate).toLocaleString()}
								</p>
							{/if}

							{#if monitor.lastChecked}
								<p class="text-muted text-sm">
									Last checked: {new Date(monitor.lastChecked).toLocaleString()}
								</p>
							{/if}

							<div class="actions">
								<button
									class="btn btn-sm btn-secondary"
									onclick={() => startEditMonitor(monitor)}
									aria-label="Edit"
									title="Edit"
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
									Edit
								</button>
								<button
									class="btn btn-sm btn-secondary"
									onclick={() => toggleMonitor(monitor.id, monitor.enabled)}
									aria-label={monitor.enabled ? 'Pause' : 'Resume'}
									title={monitor.enabled ? 'Pause' : 'Resume'}
								>
									{#if monitor.enabled}
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
											><rect x="6" y="4" width="4" height="16" /><rect
												x="14"
												y="4"
												width="4"
												height="16"
											/></svg
										>
										Pause
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
											stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg
										>
										Resume
									{/if}
								</button>
								<button
									class="btn btn-sm btn-danger"
									onclick={() => deleteMonitor(monitor.id)}
									aria-label="Delete"
									title="Delete"
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
									Delete
								</button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.page {
		max-width: 1400px;
		margin: 0 auto;
		width: 100%;
	}

	.tab-content {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-2xl);
	}

	.tab-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: var(--spacing-lg);
	}

	.tab-header h2 {
		margin-bottom: var(--spacing-xs);
	}

	.tab-header p {
		margin-top: var(--spacing-xs);
	}

	.form-card {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		padding: var(--spacing-xl);
		margin-bottom: var(--spacing-xl);
	}

	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-lg);
	}

	.form-group {
		display: flex;
		flex-direction: column;
	}

	label {
		margin-bottom: var(--spacing-sm);
		color: var(--color-text-secondary);
		font-size: 0.875rem;
		font-weight: 500;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		margin-bottom: var(--spacing-lg);
	}

	.checkbox-label input {
		width: auto;
	}

	.content-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
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

	.content-card {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		padding: var(--spacing-lg);
		transition: all var(--transition-normal);
	}

	.content-card:hover {
		border-color: var(--color-border-subtle);
		transform: translateY(-2px);
		box-shadow: var(--shadow-md);
	}

	.content-card.live {
		border-color: var(--color-status-error);
		background: rgba(239, 68, 68, 0.05);
	}

	.edit-form {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-lg);
	}

	.edit-form .form-row {
		margin-bottom: 0;
	}

	.edit-form .form-group {
		margin-bottom: 0;
	}

	.edit-form .checkbox-label {
		margin-bottom: 0;
	}

	.edit-form .actions {
		margin-top: 0;
	}

	.card-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-md);
	}

	.card-header h3 {
		font-size: 1rem;
		flex: 1;
	}

	.status {
		padding: var(--spacing-xs) var(--spacing-sm);
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		font-weight: 600;
		background: var(--color-bg-tertiary);
		color: var(--color-text-secondary);
	}

	.status.enabled {
		background: rgba(16, 185, 129, 0.1);
		color: var(--color-status-success);
	}

	.live-badge {
		padding: var(--spacing-xs) var(--spacing-sm);
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		font-weight: 600;
		background: var(--color-status-error);
		color: white;
		animation: pulse 2s infinite;
	}

	.url {
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		margin-bottom: var(--spacing-md);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-md);
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.wait-info {
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
		margin-bottom: var(--spacing-md);
	}

	.wait-info .label {
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	.wait-info .time {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-accent-primary);
	}

	.form-error {
		color: var(--color-status-error, #ef4444);
		font-size: 0.85rem;
		margin: var(--spacing-xs) 0;
	}

	.options-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		margin-bottom: var(--spacing-md);
	}

	.options-label {
		font-size: 0.75rem;
		color: var(--color-text-tertiary);
		text-transform: uppercase;
		font-weight: 600;
		letter-spacing: 0.05em;
		white-space: nowrap;
	}

	.options-chips {
		display: flex;
		gap: var(--spacing-xs);
		flex-wrap: wrap;
	}

	.option-chip {
		padding: var(--spacing-xs) var(--spacing-sm);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		color: var(--color-text-secondary);
		font-size: 0.8125rem;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.option-chip:hover {
		background: var(--color-bg-hover);
		border-color: var(--color-accent-dim);
	}

	.option-chip.active {
		background: rgba(99, 102, 241, 0.15);
		border-color: var(--color-accent-primary);
		color: var(--color-accent-primary);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-sm);
		margin-top: var(--spacing-md);
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

	@media (max-width: 768px) {
		.page {
			padding: 0 var(--spacing-sm);
		}

		.tab-header {
			flex-direction: column;
			gap: var(--spacing-md);
		}

		.tab-header .btn {
			width: 100%;
		}

		.content-grid {
			grid-template-columns: 1fr;
		}

		.form-row {
			grid-template-columns: 1fr;
		}

		.form-card {
			padding: var(--spacing-md);
		}

		.content-card {
			padding: var(--spacing-md);
		}

		.card-header h3 {
			font-size: 0.9375rem;
		}

		.actions {
			flex-wrap: wrap;
		}

		.actions .btn {
			flex: 1;
			min-width: 0;
		}

		.options-row {
			flex-direction: column;
			align-items: flex-start;
		}

		.meta {
			gap: var(--spacing-sm);
		}
	}
</style>
