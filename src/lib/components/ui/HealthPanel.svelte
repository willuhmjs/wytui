<script lang="ts">
	import { formatBytes, formatUptime } from '$lib/utils/format';
	import { getSSEState } from '$lib/stores/sse.svelte';

	let { open, onClose }: { open: boolean; onClose: () => void } = $props();

	let data = $state<any>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let sseState = getSSEState();

	$effect(() => {
		if (open) {
			fetchHealth();
		} else {
			data = null;
			error = null;
		}
	});

	async function fetchHealth() {
		loading = true;
		error = null;
		try {
			const res = await fetch('/api/health');
			if (!res.ok) throw new Error(`${res.status}`);
			data = await res.json();
		} catch (e: any) {
			error = e.message || 'Failed to load';
		} finally {
			loading = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}

	function progressColor(pct: number): string {
		if (pct >= 90) return 'var(--error)';
		if (pct >= 70) return 'var(--warning)';
		return 'var(--success)';
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="health-overlay" onkeydown={handleKeydown} onclick={onClose}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="health-panel" onclick={(e) => e.stopPropagation()}>
			<div class="panel-header">
				<h2><i class="bi bi-activity"></i> Application Health</h2>
				<button class="close-btn" onclick={onClose} aria-label="Close">
					<i class="bi bi-x-lg"></i>
				</button>
			</div>

			{#if loading && !data}
				<div class="panel-body">
					<div class="stats-grid">
						{#each Array(6) as _}
							<div class="stat-card">
								<div class="skeleton" style="height: 20px; width: 40%; margin-bottom: 12px;"></div>
								<div class="skeleton" style="height: 16px; width: 70%; margin-bottom: 8px;"></div>
								<div class="skeleton" style="height: 16px; width: 55%;"></div>
							</div>
						{/each}
					</div>
				</div>
			{:else if error}
				<div class="panel-body">
					<div class="error-state">
						<i class="bi bi-exclamation-triangle"></i>
						<p>Failed to load health data</p>
						<button class="retry-btn" onclick={fetchHealth}>Retry</button>
					</div>
				</div>
			{:else if data}
				<div class="panel-body">
					<div class="stats-grid">
						<div class="stat-card">
							<div class="card-title"><i class="bi bi-broadcast"></i> Connection</div>
							<div class="stat-row">
								<span class="stat-label">SSE Status</span>
								<span class="stat-value">
									<span class="status-indicator" class:connected={sseState.connected}></span>
									{sseState.connected ? 'Connected' : 'Disconnected'}
								</span>
							</div>
							<div class="stat-row">
								<span class="stat-label">Active Clients</span>
								<span class="stat-value">{data.connection.sseClients}</span>
							</div>
						</div>

						<div class="stat-card">
							<div class="card-title"><i class="bi bi-download"></i> Downloads</div>
							<div class="stat-row">
								<span class="stat-label">Active</span>
								<span class="stat-value accent">{data.downloads.active}</span>
							</div>
							<div class="stat-row">
								<span class="stat-label">Queued</span>
								<span class="stat-value">{data.downloads.queued}</span>
							</div>
							<div class="stat-row">
								<span class="stat-label">Completed</span>
								<span class="stat-value success">{data.downloads.completed}</span>
							</div>
							{#if data.downloads.failed > 0}
								<div class="stat-row">
									<span class="stat-label">Failed</span>
									<span class="stat-value error">{data.downloads.failed}</span>
								</div>
							{/if}
						</div>

						<div class="stat-card wide">
							<div class="card-title"><i class="bi bi-hdd"></i> Storage</div>
							<div class="progress-section">
								<div class="progress-header">
									<span class="stat-label">Cache</span>
									<span class="stat-detail">{formatBytes(data.storage.cache.usedBytes)} / {formatBytes(data.storage.cache.quotaBytes)}</span>
								</div>
								<div class="health-progress">
									<div
										class="health-progress-bar"
										style="width: {data.storage.cache.percentage}%; background: {progressColor(data.storage.cache.percentage)};"
									></div>
								</div>
							</div>
							{#if data.storage.disk}
								<div class="progress-section">
									<div class="progress-header">
										<span class="stat-label">Disk</span>
										<span class="stat-detail">{formatBytes(String(BigInt(data.storage.disk.totalBytes) - BigInt(data.storage.disk.availableBytes)))} / {formatBytes(data.storage.disk.totalBytes)}</span>
									</div>
									<div class="health-progress">
										<div
											class="health-progress-bar"
											style="width: {data.storage.disk.percentage}%; background: {progressColor(data.storage.disk.percentage)};"
										></div>
									</div>
								</div>
							{/if}
							<div class="library-stats">
								{#if data.storage.library.video}
									<div class="stat-row">
										<span class="stat-label"><i class="bi bi-film"></i> Video Library</span>
										<span class="stat-detail">{data.storage.library.video.count} files &middot; {formatBytes(data.storage.library.video.usedBytes)}</span>
									</div>
								{/if}
								{#if data.storage.library.music}
									<div class="stat-row">
										<span class="stat-label"><i class="bi bi-music-note-beamed"></i> Music Library</span>
										<span class="stat-detail">{data.storage.library.music.count} files &middot; {formatBytes(data.storage.library.music.usedBytes)}</span>
									</div>
								{/if}
							</div>
						</div>

						<div class="stat-card">
							<div class="card-title"><i class="bi bi-stack"></i> Queue</div>
							<div class="stat-row">
								<span class="stat-label">Active Workers</span>
								<span class="stat-value">{data.queue.active} / {data.queue.maxConcurrent}</span>
							</div>
							<div class="stat-row">
								<span class="stat-label">Queued Downloads</span>
								<span class="stat-value">{data.queue.downloads}</span>
							</div>
							<div class="stat-row">
								<span class="stat-label">Queued Metadata</span>
								<span class="stat-value">{data.queue.metadata}</span>
							</div>
						</div>

						<div class="stat-card">
							<div class="card-title"><i class="bi bi-gear"></i> System</div>
							<div class="stat-row">
								<span class="stat-label">yt-dlp</span>
								<span class="stat-value mono">{data.system.ytdlpVersion || 'Unknown'}</span>
							</div>
							<div class="stat-row">
								<span class="stat-label">Uptime</span>
								<span class="stat-value">{formatUptime(data.system.uptimeMs)}</span>
							</div>
						</div>

						<div class="stat-card">
							<div class="card-title"><i class="bi bi-arrow-repeat"></i> Automations</div>
							<div class="stat-row">
								<span class="stat-label">Subscriptions</span>
								<span class="stat-value">{data.subscriptions.active} <span class="stat-dim">/ {data.subscriptions.total}</span></span>
							</div>
							<div class="stat-row">
								<span class="stat-label">Monitors</span>
								<span class="stat-value">{data.monitors.enabled} <span class="stat-dim">/ {data.monitors.total}</span></span>
							</div>
							{#if data.monitors.live > 0}
								<div class="stat-row">
									<span class="stat-label">Currently Live</span>
									<span class="stat-value live">{data.monitors.live}</span>
								</div>
							{/if}
						</div>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.health-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(4px);
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		animation: fadeIn 200ms ease;
	}

	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	@keyframes slideUp {
		from { opacity: 0; transform: translateY(16px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.health-panel {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		width: 90%;
		max-width: 700px;
		max-height: 85vh;
		display: flex;
		flex-direction: column;
		box-shadow: var(--shadow-xl);
		animation: slideUp 200ms ease;
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-lg) var(--spacing-xl);
		border-bottom: 1px solid var(--border);
	}

	.panel-header h2 {
		font-size: 1.1rem;
		margin: 0;
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		color: var(--text-primary);
	}

	.panel-header h2 .bi {
		color: var(--accent-primary);
	}

	.close-btn {
		background: transparent;
		border: none;
		color: var(--text-secondary);
		font-size: 1rem;
		cursor: pointer;
		padding: var(--spacing-xs);
		border-radius: var(--radius-sm);
		display: flex;
		align-items: center;
	}

	.close-btn:hover {
		color: var(--text-primary);
		background: rgba(255, 255, 255, 0.06);
	}

	.panel-body {
		padding: var(--spacing-lg);
		overflow-y: auto;
	}

	.stats-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-md);
	}

	.stat-card {
		background: var(--bg-tertiary);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
	}

	.stat-card.wide {
		grid-column: 1 / -1;
	}

	.card-title {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-bottom: var(--spacing-sm);
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.card-title .bi {
		font-size: 0.85rem;
		color: var(--accent-primary);
	}

	.stat-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 5px 0;
	}

	.stat-row + .stat-row {
		border-top: 1px solid rgba(255, 255, 255, 0.04);
	}

	.stat-label {
		font-size: 0.825rem;
		color: var(--text-secondary);
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.stat-label .bi {
		font-size: 0.85rem;
	}

	.stat-value {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.stat-value.accent { color: var(--accent-primary); }
	.stat-value.success { color: var(--success); }
	.stat-value.error { color: var(--error); }
	.stat-value.live { color: var(--error); }
	.stat-value.mono { font-family: monospace; font-size: 0.8rem; }

	.stat-dim {
		font-weight: 400;
		color: var(--text-tertiary);
	}

	.stat-detail {
		font-size: 0.8rem;
		color: var(--text-secondary);
	}

	.progress-section {
		margin-bottom: var(--spacing-sm);
	}

	.progress-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 4px;
	}

	.health-progress {
		width: 100%;
		height: 6px;
		background: var(--bg-elevated);
		border-radius: 3px;
		overflow: hidden;
	}

	.health-progress-bar {
		height: 100%;
		border-radius: 3px;
		transition: width var(--transition-normal);
	}

	.library-stats {
		margin-top: var(--spacing-xs);
		border-top: 1px solid rgba(255, 255, 255, 0.04);
		padding-top: var(--spacing-xs);
	}

	.status-indicator {
		display: inline-block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--error);
		margin-right: 4px;
	}

	.status-indicator.connected {
		background: var(--success);
	}

	.error-state {
		text-align: center;
		padding: var(--spacing-2xl);
		color: var(--text-secondary);
	}

	.error-state .bi {
		font-size: 2rem;
		color: var(--warning);
		display: block;
		margin-bottom: var(--spacing-md);
	}

	.retry-btn {
		margin-top: var(--spacing-md);
		padding: var(--spacing-sm) var(--spacing-lg);
		background: var(--accent-primary);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		cursor: pointer;
		font-weight: 500;
	}

	.retry-btn:hover {
		background: var(--accent-hover);
	}

	@media (max-width: 768px) {
		.stats-grid {
			grid-template-columns: 1fr;
		}

		.health-panel {
			width: 95%;
			max-height: 90vh;
		}

		.panel-header {
			padding: var(--spacing-md);
		}

		.panel-body {
			padding: var(--spacing-md);
		}
	}
</style>
