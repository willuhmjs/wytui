<script lang="ts">
	import { onMount } from 'svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ErrorMessage from '$lib/components/ui/ErrorMessage.svelte';

	let analytics = $state<any>(null);
	let analyticsLoading = $state(true);
	let error = $state<string | null>(null);

	onMount(() => {
		loadAnalytics();
	});

	async function loadAnalytics() {
		analyticsLoading = true;
		error = null;
		try {
			const res = await fetch('/api/analytics');
			if (res.ok) {
				analytics = await res.json();
			} else {
				error = `Failed to load analytics (${res.status})`;
			}
		} catch (e) {
			console.error('Failed to load analytics:', e);
			error = e instanceof Error ? e.message : 'Failed to load analytics';
		} finally {
			analyticsLoading = false;
		}
	}

	function formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
	}
</script>

<svelte:head>
	<title>Analytics - wytui</title>
</svelte:head>

<div class="page">
	{#if analyticsLoading}
		<Skeleton count={6} variant="row" />
	{:else if error}
		<ErrorMessage {error} onRetry={loadAnalytics} />
	{:else if analytics}
		<div class="settings-section">
			<div class="section-header">
				<h2>Analytics Overview</h2>
				<button
					class="btn btn-secondary btn-sm btn-icon"
					onclick={loadAnalytics}
					aria-label="Refresh analytics"
					title="Refresh analytics"
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
						><polyline points="23 4 23 10 17 10" /><path
							d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"
						/></svg
					>
				</button>
			</div>

			<div class="analytics-grid">
				<div class="stat-card">
					<div class="stat-label">Total Downloads</div>
					<div class="stat-value">{analytics.overview.totalDownloads.toLocaleString()}</div>
				</div>
				<div class="stat-card">
					<div class="stat-label">Completed</div>
					<div class="stat-value success">
						{analytics.overview.completedDownloads.toLocaleString()}
					</div>
				</div>
				<div class="stat-card">
					<div class="stat-label">Failed</div>
					<div class="stat-value error">{analytics.overview.failedDownloads.toLocaleString()}</div>
				</div>
				<div class="stat-card">
					<div class="stat-label">Active</div>
					<div class="stat-value">{analytics.overview.activeDownloads.toLocaleString()}</div>
				</div>
				<div class="stat-card">
					<div class="stat-label">Success Rate</div>
					<div class="stat-value">{analytics.overview.successRate}%</div>
				</div>
				<div class="stat-card">
					<div class="stat-label">Avg File Size</div>
					<div class="stat-value">{formatBytes(analytics.avgFilesize)}</div>
				</div>
			</div>
		</div>

		<div class="settings-section">
			<h2>Storage Usage</h2>
			<div class="storage-bars">
				<div class="storage-row">
					<span class="storage-label">Cache</span>
					<div class="storage-bar">
						<div
							class="storage-fill cache"
							style="width: {Math.min(
								100,
								(Number(analytics.storage.cacheBytes) / Number(analytics.storage.cacheQuotaBytes)) *
									100,
							)}%"
						></div>
					</div>
					<span class="storage-value"
						>{formatBytes(Number(analytics.storage.cacheBytes))} / {formatBytes(
							Number(analytics.storage.cacheQuotaBytes),
						)}</span
					>
				</div>
				<div class="storage-row">
					<span class="storage-label">Library</span>
					<div class="storage-bar">
						<div
							class="storage-fill library"
							style="width: {Math.min(
								100,
								(Number(analytics.storage.libraryBytes) / Number(analytics.storage.totalBytes)) *
									100,
							)}%"
						></div>
					</div>
					<span class="storage-value">{formatBytes(Number(analytics.storage.libraryBytes))}</span>
				</div>
				<div class="storage-row">
					<span class="storage-label">Total</span>
					<div class="storage-bar">
						<div class="storage-fill total" style="width: 100%"></div>
					</div>
					<span class="storage-value">{formatBytes(Number(analytics.storage.totalBytes))}</span>
				</div>
			</div>
		</div>

		<div class="analytics-columns">
			<div class="settings-section">
				<h2>Top Uploaders</h2>
				<div class="top-list">
					{#each analytics.topUploaders as uploader}
						<div class="top-item">
							<span class="top-name">{uploader.uploader}</span>
							<span class="top-count">{uploader.count}</span>
						</div>
					{/each}
					{#if analytics.topUploaders.length === 0}
						<EmptyState title="No data yet" variant="subtle" size="sm" />
					{/if}
				</div>
			</div>

			<div class="settings-section">
				<h2>Active Subscriptions</h2>
				<div class="top-list">
					{#each analytics.activeSubscriptions as sub}
						<div class="top-item">
							<span class="top-name">{sub.name}</span>
							<span class="top-count">{sub.downloadCount}</span>
						</div>
					{/each}
					{#if analytics.activeSubscriptions.length === 0}
						<EmptyState title="No subscriptions yet" variant="subtle" size="sm" />
					{/if}
				</div>
			</div>
		</div>

		<div class="settings-section">
			<h2>Downloads Per Day (Last 30 Days)</h2>
			<div class="chart">
				{#each analytics.downloadsPerDay as day}
					{@const maxDailyDownloads = Math.max(
						1,
						...analytics.downloadsPerDay.map((d: any) => d.count),
					)}
					<div class="chart-bar-container">
						<div
							class="chart-bar"
							style="height: {Math.min(100, (day.count / maxDailyDownloads) * 100)}%"
						></div>
						<div class="chart-label">
							{new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
						</div>
						<div class="chart-value">{day.count}</div>
					</div>
				{/each}
				{#if analytics.downloadsPerDay.length === 0}
					<EmptyState title="No downloads in the last 30 days" variant="subtle" size="sm" />
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.page {
		max-width: 1400px;
		margin: 0 auto;
		width: 100%;
	}

	.settings-section {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-overlay-white-10);
		border-radius: var(--radius-lg);
		padding: var(--spacing-xl);
		margin-bottom: var(--spacing-lg);
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-lg);
	}

	.settings-section h2 {
		font-size: 1.25rem;
		margin-bottom: var(--spacing-lg);
	}

	.section-header h2 {
		margin-bottom: 0;
	}

	/* Buttons use the global .btn system (src/app.css). */

	.btn-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-sm) !important;
		line-height: 1;
	}

	.btn-icon svg {
		display: block;
	}

	.analytics-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-lg);
	}

	.stat-card {
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-overlay-white-10);
		border-radius: var(--radius-md);
		padding: var(--spacing-lg);
		text-align: center;
	}

	.stat-label {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: var(--spacing-sm);
	}

	.stat-value {
		font-size: 1.75rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.stat-value.success {
		color: var(--color-status-success, #22c55e);
	}

	.stat-value.error {
		color: var(--color-status-error);
	}

	.storage-bars {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	.storage-row {
		display: grid;
		grid-template-columns: 80px 1fr 120px;
		gap: var(--spacing-md);
		align-items: center;
	}

	.storage-label {
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		font-weight: 500;
	}

	.storage-bar {
		height: 24px;
		background: var(--color-bg-tertiary);
		border-radius: var(--radius-sm);
		overflow: hidden;
		position: relative;
	}

	.storage-fill {
		height: 100%;
		transition: width 0.3s ease;
	}

	.storage-fill.cache {
		background: linear-gradient(90deg, #3b82f6, #60a5fa);
	}

	.storage-fill.library {
		background: linear-gradient(90deg, #8b5cf6, #a78bfa);
	}

	.storage-fill.total {
		background: linear-gradient(90deg, #10b981, #34d399);
	}

	.storage-value {
		font-size: 0.875rem;
		color: var(--color-text-primary);
		font-weight: 500;
		text-align: right;
	}

	.analytics-columns {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-lg);
	}

	.top-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.top-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-overlay-white-05);
		border-radius: var(--radius-sm);
	}

	.top-name {
		font-size: 0.875rem;
		color: var(--color-text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.top-count {
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		font-weight: 600;
		background: var(--color-bg-secondary);
		padding: 2px 8px;
		border-radius: 10px;
		min-width: 30px;
		text-align: center;
	}

	.chart {
		display: flex;
		gap: 4px;
		height: 200px;
		align-items: flex-end;
		padding: var(--spacing-md);
		background: var(--color-bg-tertiary);
		border-radius: var(--radius-md);
		overflow-x: auto;
	}

	.chart-bar-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--spacing-xs);
		min-width: 40px;
		height: 100%;
		justify-content: flex-end;
	}

	.chart-bar {
		width: 100%;
		min-height: 2px;
		background: linear-gradient(180deg, var(--color-accent-primary), rgba(59, 130, 246, 0.6));
		border-radius: 2px 2px 0 0;
		transition: height 0.3s ease;
	}

	.chart-label {
		font-size: 0.625rem;
		color: var(--color-text-tertiary);
		writing-mode: vertical-rl;
		text-orientation: mixed;
		white-space: nowrap;
		transform: rotate(180deg);
	}

	.chart-value {
		font-size: 0.6875rem;
		color: var(--color-text-secondary);
		font-weight: 600;
	}

	@media (max-width: 768px) {
		.page {
			padding: 0 var(--spacing-sm);
		}

		.analytics-grid {
			grid-template-columns: repeat(2, 1fr);
		}

		.analytics-columns {
			grid-template-columns: 1fr;
		}

		.storage-row {
			grid-template-columns: 60px 1fr 90px;
			gap: var(--spacing-sm);
		}

		.settings-section {
			padding: var(--spacing-md);
		}
	}
</style>
