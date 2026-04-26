<script lang="ts">
	import { onMount } from 'svelte';
	import { showConfirm } from '$lib/stores/modal.svelte';

	let subscriptions = $state<any[]>([]);
	let profiles = $state<any[]>([]);
	let loading = $state(true);
	let showForm = $state(false);

	// Form state
	let formUrl = $state('');
	let formName = $state('');
	let formProfileId = $state('');
	let formCheckInterval = $state(1800); // 30 minutes default
	let formAutoDownload = $state(true);
	let formMaxVideos = $state(5);
	let formType = $state('CHANNEL');

	onMount(async () => {
		await Promise.all([loadSubscriptions(), loadProfiles()]);
	});

	async function loadSubscriptions() {
		loading = true;
		try {
			const res = await fetch('/api/subscriptions');
			if (res.ok) {
				subscriptions = await res.json();
			}
		} catch (e) {
			console.error('Failed to load subscriptions:', e);
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
			const res = await fetch('/api/subscriptions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					url: formUrl,
					name: formName,
					type: formType,
					profileId: formProfileId,
					checkInterval: formCheckInterval,
					autoDownload: formAutoDownload,
					maxVideos: formMaxVideos,
				}),
			});

			if (res.ok) {
				// Reset form
				formUrl = '';
				formName = '';
				showForm = false;
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
</script>

<svelte:head>
	<title>Subscriptions - wytui</title>
</svelte:head>

<div class="page">
	<div class="page-header">
		<div>
			<h1>Subscriptions</h1>
			<p class="text-muted">Monitor channels and auto-download new videos</p>
		</div>
		<button class="btn btn-primary" onclick={() => (showForm = !showForm)}>
			{showForm ? 'Cancel' : 'Add Subscription'}
		</button>
	</div>

	{#if showForm}
		<form class="subscription-form" onsubmit={handleSubmit}>
			<div class="form-row">
				<div class="form-group">
					<label for="url">Channel/Playlist URL</label>
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
						<option value="CHANNEL">Channel</option>
						<option value="PLAYLIST">Playlist</option>
						<option value="USER">User</option>
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

			<div class="form-row">
				<div class="form-group">
					<label for="interval">Check Interval (seconds)</label>
					<input type="number" id="interval" bind:value={formCheckInterval} min="60" />
				</div>
				<div class="form-group">
					<label for="maxVideos">Max Videos to Check</label>
					<input type="number" id="maxVideos" bind:value={formMaxVideos} min="1" max="50" />
				</div>
			</div>

			<label class="checkbox-label">
				<input type="checkbox" bind:checked={formAutoDownload} />
				Auto-download new videos
			</label>

			<button type="submit" class="btn btn-primary">Create Subscription</button>
		</form>
	{/if}

	{#if loading}
		<div class="loading">Loading subscriptions...</div>
	{:else if subscriptions.length === 0}
		<div class="empty-state">
			<p>No subscriptions yet</p>
			<p class="text-muted">Add a channel to start monitoring for new videos</p>
		</div>
	{:else}
		<div class="subscriptions-grid">
			{#each subscriptions as sub}
				<div class="subscription-card">
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
						<button
							class="btn btn-sm btn-danger"
							onclick={() => deleteSubscription(sub.id)}
						>
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

	.subscription-form {
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

	.subscriptions-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
		gap: var(--spacing-lg);
	}

	.subscription-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: var(--spacing-lg);
		transition: all var(--transition-normal);
	}

	.subscription-card:hover {
		border-color: var(--border-light);
		transform: translateY(-2px);
		box-shadow: var(--shadow-md);
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

	.actions {
		display: flex;
		gap: var(--spacing-sm);
		margin-top: var(--spacing-md);
	}

	@media (max-width: 768px) {
		.form-row {
			grid-template-columns: 1fr;
		}

		.subscriptions-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
