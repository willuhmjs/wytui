<script lang="ts">
	import { onMount } from 'svelte';
	import { getSSEState } from '$lib/stores/sse.svelte';
	import { showConfirm } from '$lib/stores/modal.svelte';

	let monitors = $state<any[]>([]);
	let profiles = $state<any[]>([]);
	let loading = $state(true);
	let showForm = $state(false);

	// Form state
	let formUrl = $state('');
	let formName = $state('');
	let formProfileId = $state('');
	let formType = $state('YOUTUBE_LIVE');
	let formAutoDownload = $state(true);

	let sseState = getSSEState();

	onMount(async () => {
		await Promise.all([loadMonitors(), loadProfiles()]);
	});

	async function loadMonitors() {
		loading = true;
		try {
			const res = await fetch('/api/monitors');
			if (res.ok) {
				monitors = await res.json();
			}
		} catch (e) {
			console.error('Failed to load monitors:', e);
		} finally {
			loading = false;
		}
	}

	async function loadProfiles() {
		try {
			const res = await fetch('/api/profiles');
			if (res.ok) {
				profiles = await res.json();
				const defaultProfile = profiles.find((p) => p.isDefault);
				if (defaultProfile) {
					formProfileId = defaultProfile.id;
				}
			}
		} catch (e) {
			console.error('Failed to load profiles:', e);
		}
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();

		try {
			const res = await fetch('/api/monitors', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					url: formUrl,
					name: formName,
					type: formType,
					profileId: formProfileId,
					autoDownload: formAutoDownload,
				}),
			});

			if (res.ok) {
				// Reset form
				formUrl = '';
				formName = '';
				showForm = false;
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
</script>

<svelte:head>
	<title>Monitors - wytui</title>
</svelte:head>

<div class="page">
	<div class="page-header">
		<div>
			<h1>Livestream Monitors</h1>
			<p class="text-muted">Monitor livestreams and auto-download when they go live</p>
		</div>
		<button class="btn btn-primary" onclick={() => (showForm = !showForm)}>
			{showForm ? 'Cancel' : 'Add Monitor'}
		</button>
	</div>

	{#if showForm}
		<form class="monitor-form" onsubmit={handleSubmit}>
			<div class="form-row">
				<div class="form-group">
					<label for="url">Stream URL</label>
					<input type="url" id="url" bind:value={formUrl} required />
				</div>
				<div class="form-group">
					<label for="name">Name</label>
					<input type="text" id="name" bind:value={formName} required />
				</div>
			</div>

			<div class="form-row">
				<div class="form-group">
					<label for="type">Type</label>
					<select id="type" bind:value={formType}>
						<option value="YOUTUBE_LIVE">YouTube Live</option>
						<option value="TWITCH">Twitch</option>
					</select>
				</div>
				<div class="form-group">
					<label for="profile">Download Profile</label>
					<select id="profile" bind:value={formProfileId} required>
						{#each profiles as profile}
							<option value={profile.id}>{profile.name}</option>
						{/each}
					</select>
				</div>
			</div>

			<label class="checkbox-label">
				<input type="checkbox" bind:checked={formAutoDownload} />
				Auto-download when live
			</label>

			<button type="submit" class="btn btn-primary">Create Monitor</button>
		</form>
	{/if}

	{#if loading}
		<div class="loading">Loading monitors...</div>
	{:else if monitors.length === 0}
		<div class="empty-state">
			<p>No monitors yet</p>
			<p class="text-muted">Add a livestream URL to start monitoring</p>
		</div>
	{:else}
		<div class="monitors-grid">
			{#each monitors as monitor}
				<div class="monitor-card" class:live={monitor.isLive}>
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

<style>
	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: var(--spacing-xl);
	}

	.page-header p {
		margin-top: var(--spacing-sm);
	}

	.monitor-form {
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

	.loading {
		text-align: center;
		padding: var(--spacing-2xl);
		color: var(--text-secondary);
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

	.monitors-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
		gap: var(--spacing-lg);
	}

	.monitor-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: var(--spacing-lg);
		transition: all var(--transition-normal);
	}

	.monitor-card:hover {
		border-color: var(--border-light);
		transform: translateY(-2px);
		box-shadow: var(--shadow-md);
	}

	.monitor-card.live {
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

	.live-badge {
		padding: var(--spacing-xs) var(--spacing-sm);
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		font-weight: 600;
		background: var(--error);
		color: white;
		animation: pulse 2s infinite;
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
		.form-row {
			grid-template-columns: 1fr;
		}

		.monitors-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
