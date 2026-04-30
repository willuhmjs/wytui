<script lang="ts">
	import { onMount } from 'svelte';
	import DownloadForm from '$lib/components/download/DownloadForm.svelte';
	import DownloadCard from '$lib/components/download/DownloadCard.svelte';
	import { getSSEState } from '$lib/stores/sse.svelte';
	import { showConfirm } from '$lib/stores/modal.svelte';

	let activeTab = $state<'downloads' | 'subscriptions' | 'monitors'>('downloads');
	let sseState = getSSEState();

	// Completed downloads
	let completedDownloads = $state<any[]>([]);
	let completedLoading = $state(false);

	// Subscriptions state
	let subscriptions = $state<any[]>([]);
	let subsLoading = $state(false);
	let showSubsForm = $state(false);
	let subFormUrl = $state('');
	let subFormName = $state('');
	let subFormProfileId = $state('');
	let subFormCheckInterval = $state(1800);
	let subFormAutoDownload = $state(true);
	let subFormMaxVideos = $state(5);
	let subFormType = $state('CHANNEL');

	// Monitors state
	let monitors = $state<any[]>([]);
	let monitorsLoading = $state(false);
	let showMonitorsForm = $state(false);
	let monFormUrl = $state('');
	let monFormName = $state('');
	let monFormProfileId = $state('');
	let monFormType = $state('YOUTUBE_LIVE');
	let monFormAutoDownload = $state(true);

	// Shared state
	let profiles = $state<any[]>([]);

	onMount(() => {
		loadProfiles();
		loadCompletedDownloads();

		const eventSource = new EventSource('/api/sse');
		eventSource.addEventListener('download:complete', (e) => {
			const { download } = JSON.parse(e.data);
			const exists = completedDownloads.find((d) => d.id === download.id);
			if (!exists) {
				completedDownloads = [download, ...completedDownloads];
			}
		});
		eventSource.addEventListener('download:deleted', (e) => {
			const { id } = JSON.parse(e.data);
			completedDownloads = completedDownloads.filter((d) => d.id !== id);
		});

		return () => {
			eventSource.close();
		};
	});

	async function loadCompletedDownloads() {
		completedLoading = true;
		try {
			const res = await fetch('/api/downloads?status=COMPLETED&limit=50');
			if (res.ok) {
				completedDownloads = await res.json();
			}
		} catch (e) {
			console.error('Failed to load completed downloads:', e);
		} finally {
			completedLoading = false;
		}
	}

	async function loadProfiles() {
		try {
			const res = await fetch('/api/profiles');
			if (res.ok) {
				profiles = await res.json();
				const defaultProfile = profiles.find((p) => p.isDefault);
				if (defaultProfile) {
					subFormProfileId = defaultProfile.id;
					monFormProfileId = defaultProfile.id;
				}
			}
		} catch (e) {
			console.error('Failed to load profiles:', e);
		}
	}

	// Subscriptions functions
	async function loadSubscriptions() {
		subsLoading = true;
		try {
			const res = await fetch('/api/subscriptions');
			if (res.ok) {
				subscriptions = await res.json();
			}
		} catch (e) {
			console.error('Failed to load subscriptions:', e);
		} finally {
			subsLoading = false;
		}
	}

	async function handleSubsSubmit(e: Event) {
		e.preventDefault();
		try {
			const res = await fetch('/api/subscriptions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					url: subFormUrl,
					name: subFormName,
					type: subFormType,
					profileId: subFormProfileId,
					checkInterval: subFormCheckInterval,
					autoDownload: subFormAutoDownload,
					maxVideos: subFormMaxVideos,
				}),
			});

			if (res.ok) {
				subFormUrl = '';
				subFormName = '';
				showSubsForm = false;
				await loadSubscriptions();
			}
		} catch (e) {
			console.error('Failed to create subscription:', e);
		}
	}

	async function toggleSubscription(id: string, enabled: boolean) {
		try {
			await fetch(`/api/subscriptions/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled: !enabled }),
			});
			await loadSubscriptions();
		} catch (e) {
			console.error('Failed to toggle subscription:', e);
		}
	}

	async function deleteSubscription(id: string) {
		const confirmed = await showConfirm(
			'Delete Subscription',
			'Are you sure you want to delete this subscription?',
			'Delete'
		);
		if (!confirmed) return;

		try {
			await fetch(`/api/subscriptions/${id}`, { method: 'DELETE' });
			await loadSubscriptions();
		} catch (e) {
			console.error('Failed to delete subscription:', e);
		}
	}

	async function checkNow(id: string) {
		try {
			await fetch(`/api/subscriptions/${id}/check`, { method: 'POST' });
		} catch (e) {
			console.error('Failed to check subscription:', e);
		}
	}

	function formatInterval(seconds: number): string {
		if (seconds < 60) return `${seconds}s`;
		if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
		if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
		return `${Math.floor(seconds / 86400)}d`;
	}

	// Monitors functions
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
		try {
			const res = await fetch('/api/monitors', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					url: monFormUrl,
					name: monFormName,
					type: monFormType,
					profileId: monFormProfileId,
					autoDownload: monFormAutoDownload,
				}),
			});

			if (res.ok) {
				monFormUrl = '';
				monFormName = '';
				showMonitorsForm = false;
				await loadMonitors();
			}
		} catch (e) {
			console.error('Failed to create monitor:', e);
		}
	}

	async function toggleMonitor(id: string, enabled: boolean) {
		try {
			await fetch(`/api/monitors/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled: !enabled }),
			});
			await loadMonitors();
		} catch (e) {
			console.error('Failed to toggle monitor:', e);
		}
	}

	async function deleteMonitor(id: string) {
		const confirmed = await showConfirm(
			'Delete Monitor',
			'Are you sure you want to delete this monitor?',
			'Delete'
		);
		if (!confirmed) return;

		try {
			await fetch(`/api/monitors/${id}`, { method: 'DELETE' });
			await loadMonitors();
		} catch (e) {
			console.error('Failed to delete monitor:', e);
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

	// Load data when switching tabs
	$effect(() => {
		if (activeTab === 'subscriptions' && subscriptions.length === 0) {
			loadSubscriptions();
		} else if (activeTab === 'monitors' && monitors.length === 0) {
			loadMonitors();
		}
	});
</script>

<svelte:head>
	<title>wytui - YouTube Downloader</title>
</svelte:head>

<div class="page">
	<!-- Tabs -->
	<div class="tabs">
		<button
			class="tab"
			class:active={activeTab === 'downloads'}
			onclick={() => (activeTab = 'downloads')}
		>
			Downloads
		</button>
		<button
			class="tab"
			class:active={activeTab === 'subscriptions'}
			onclick={() => (activeTab = 'subscriptions')}
		>
			Subscriptions
		</button>
		<button
			class="tab"
			class:active={activeTab === 'monitors'}
			onclick={() => (activeTab = 'monitors')}
		>
			Monitors
		</button>
	</div>

	<!-- Downloads Tab -->
	{#if activeTab === 'downloads'}
		<div class="tab-content">
			<div class="downloads-layout">
				<div class="form-section">
					<h2>Download</h2>
					<DownloadForm />
				</div>

				<div class="active-section">
					<h2>Active ({sseState.downloads.length})</h2>
					{#if sseState.downloads.length === 0}
						<div class="empty-state">
							<p>No active downloads</p>
							<p class="text-muted">Paste a URL to get started</p>
						</div>
					{:else}
						<div class="downloads-list">
							{#each sseState.downloads as download (download.id)}
								<DownloadCard {download} />
							{/each}
						</div>
					{/if}
				</div>
			</div>

			<div class="section">
				<h2>Completed ({completedDownloads.length})</h2>
				{#if completedLoading}
					<div class="loading">Loading...</div>
				{:else if completedDownloads.length === 0}
					<div class="empty-state">
						<p>No completed downloads yet</p>
					</div>
				{:else}
					<div class="downloads-grid">
						{#each completedDownloads as download (download.id)}
							<DownloadCard {download} />
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Subscriptions Tab -->
	{#if activeTab === 'subscriptions'}
		<div class="tab-content">
			<div class="tab-header">
				<div>
					<h2>Subscriptions</h2>
					<p class="text-muted">Monitor channels and auto-download new videos</p>
				</div>
				<button class="btn btn-primary" onclick={() => (showSubsForm = !showSubsForm)}>
					{showSubsForm ? 'Cancel' : 'Add Subscription'}
				</button>
			</div>

			{#if showSubsForm}
				<form class="form-card" onsubmit={handleSubsSubmit}>
					<div class="form-row">
						<div class="form-group">
							<label for="sub-url">Channel/Playlist URL</label>
							<input type="url" id="sub-url" bind:value={subFormUrl} required />
						</div>
						<div class="form-group">
							<label for="sub-name">Name</label>
							<input type="text" id="sub-name" bind:value={subFormName} required />
						</div>
					</div>

					<div class="form-row">
						<div class="form-group">
							<label for="sub-type">Type</label>
							<select id="sub-type" bind:value={subFormType}>
								<option value="CHANNEL">Channel</option>
								<option value="PLAYLIST">Playlist</option>
								<option value="USER">User</option>
							</select>
						</div>
						<div class="form-group">
							<label for="sub-profile">Download Profile</label>
							<select id="sub-profile" bind:value={subFormProfileId} required>
								{#each profiles as profile}
									<option value={profile.id}>{profile.name}</option>
								{/each}
							</select>
						</div>
					</div>

					<div class="form-row">
						<div class="form-group">
							<label for="sub-interval">Check Interval (seconds)</label>
							<input type="number" id="sub-interval" bind:value={subFormCheckInterval} min="60" />
						</div>
						<div class="form-group">
							<label for="sub-maxVideos">Max Videos to Check</label>
							<input
								type="number"
								id="sub-maxVideos"
								bind:value={subFormMaxVideos}
								min="1"
								max="50"
							/>
						</div>
					</div>

					<label class="checkbox-label">
						<input type="checkbox" bind:checked={subFormAutoDownload} />
						Auto-download new videos
					</label>

					<button type="submit" class="btn btn-primary">Create Subscription</button>
				</form>
			{/if}

			{#if subsLoading}
				<div class="loading">Loading subscriptions...</div>
			{:else if subscriptions.length === 0}
				<div class="empty-state">
					<p>No subscriptions yet</p>
					<p class="text-muted">Add a channel to start monitoring for new videos</p>
				</div>
			{:else}
				<div class="content-grid">
					{#each subscriptions as sub}
						<div class="content-card">
							<div class="card-header">
								<h3>{sub.name}</h3>
								<span class="status" class:enabled={sub.enabled}>
									{sub.enabled ? 'Active' : 'Paused'}
								</span>
							</div>

							<p class="url">{sub.url}</p>

							<div class="meta">
								<span>Profile: {sub.profile.name}</span>
								<span>Check: {formatInterval(sub.checkInterval)}</span>
								<span>Type: {sub.type}</span>
							</div>

							{#if sub.lastChecked}
								<p class="text-muted text-sm">
									Last checked: {new Date(sub.lastChecked).toLocaleString()}
								</p>
							{/if}

							<div class="actions">
								<button class="btn btn-sm btn-primary" onclick={() => checkNow(sub.id)}>
									Check Now
								</button>
								<button
									class="btn btn-sm btn-secondary"
									onclick={() => toggleSubscription(sub.id, sub.enabled)}
								>
									{sub.enabled ? 'Pause' : 'Resume'}
								</button>
								<button class="btn btn-sm btn-danger" onclick={() => deleteSubscription(sub.id)}>
									Delete
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Monitors Tab -->
	{#if activeTab === 'monitors'}
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
							<input type="url" id="mon-url" bind:value={monFormUrl} required />
						</div>
						<div class="form-group">
							<label for="mon-name">Name</label>
							<input type="text" id="mon-name" bind:value={monFormName} required />
						</div>
					</div>

					<div class="form-row">
						<div class="form-group">
							<label for="mon-type">Type</label>
							<select id="mon-type" bind:value={monFormType}>
								<option value="YOUTUBE_LIVE">YouTube Live</option>
								<option value="TWITCH">Twitch</option>
							</select>
						</div>
						<div class="form-group">
							<label for="mon-profile">Download Profile</label>
							<select id="mon-profile" bind:value={monFormProfileId} required>
								{#each profiles as profile}
									<option value={profile.id}>{profile.name}</option>
								{/each}
							</select>
						</div>
					</div>

					<label class="checkbox-label">
						<input type="checkbox" bind:checked={monFormAutoDownload} />
						Auto-download when live
					</label>

					<button type="submit" class="btn btn-primary">Create Monitor</button>
				</form>
			{/if}

			{#if monitorsLoading}
				<div class="loading">Loading monitors...</div>
			{:else if monitors.length === 0}
				<div class="empty-state">
					<p>No monitors yet</p>
					<p class="text-muted">Add a livestream URL to start monitoring</p>
				</div>
			{:else}
				<div class="content-grid">
					{#each monitors as monitor}
						<div class="content-card" class:live={monitor.isLive}>
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
								<span>Type: {monitor.type.replace('_', ' ')}</span>
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
									onclick={() => toggleMonitor(monitor.id, monitor.enabled)}
								>
									{monitor.enabled ? 'Pause' : 'Resume'}
								</button>
								<button class="btn btn-sm btn-danger" onclick={() => deleteMonitor(monitor.id)}>
									Delete
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.page {
		max-width: 1400px;
		margin: 0 auto;
		width: 100%;
	}

	.tabs {
		display: inline-flex;
		gap: 4px;
		margin-bottom: var(--spacing-2xl);
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: 4px;
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

	.downloads-layout {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-xl);
		align-items: start;
	}

	.form-section {
		align-self: start;
	}

	.active-section {
		min-width: 0;
	}

	.active-section h2 {
		margin-bottom: var(--spacing-lg);
	}

	.downloads-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-lg);
	}

	.section {
		margin-bottom: var(--spacing-xl);
		width: 100%;
	}

	.section h2 {
		margin-bottom: var(--spacing-lg);
	}

	.form-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
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
		color: var(--text-secondary);
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

	.empty-state {
		text-align: center;
		padding: var(--spacing-2xl);
		background: var(--bg-secondary);
		border: 1px dashed var(--border);
		border-radius: var(--radius-lg);
	}

	.empty-state p {
		margin-bottom: var(--spacing-sm);
	}

	.loading {
		text-align: center;
		padding: var(--spacing-2xl);
		color: var(--text-secondary);
	}

	.downloads-grid,
	.content-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
		gap: var(--spacing-lg);
		width: 100%;
	}

	.content-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: var(--spacing-lg);
		transition: all var(--transition-normal);
	}

	.content-card:hover {
		border-color: var(--border-light);
		transform: translateY(-2px);
		box-shadow: var(--shadow-md);
	}

	.content-card.live {
		border-color: var(--error);
		background: rgba(239, 68, 68, 0.05);
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
		background: var(--bg-tertiary);
		color: var(--text-secondary);
	}

	.status.enabled {
		background: rgba(16, 185, 129, 0.1);
		color: var(--success);
	}

	.live-badge {
		padding: var(--spacing-xs) var(--spacing-sm);
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		font-weight: 600;
		background: var(--error);
		color: white;
		animation: pulse 2s infinite;
	}

	.url {
		font-size: 0.875rem;
		color: var(--text-secondary);
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
		color: var(--text-secondary);
	}

	.wait-info {
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: var(--bg-tertiary);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
		margin-bottom: var(--spacing-md);
	}

	.wait-info .label {
		font-size: 0.875rem;
		color: var(--text-secondary);
	}

	.wait-info .time {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--accent-primary);
	}

	.actions {
		display: flex;
		gap: var(--spacing-sm);
		margin-top: var(--spacing-md);
	}

	@media (max-width: 768px) {
		.downloads-layout {
			grid-template-columns: 1fr;
		}

		.downloads-grid,
		.content-grid {
			grid-template-columns: 1fr;
		}

		.form-row {
			grid-template-columns: 1fr;
		}
	}
</style>
