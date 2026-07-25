<script lang="ts">
	import { formatBytes, formatUptime } from '$lib/utils/format';
	import { getSSEState } from '$lib/stores/sse.svelte';
	import { trapFocus } from '$lib/utils/a11y';

	let {
		open,
		onClose,
		isAdmin = false,
		showTotalSize = true,
	}: { open: boolean; onClose: () => void; isAdmin?: boolean; showTotalSize?: boolean } = $props();

	let data = $state<any>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let sseState = getSSEState();
	let panelEl: HTMLDivElement | null = $state(null);

	$effect(() => {
		if (open) {
			fetchHealth();
		} else {
			data = null;
			error = null;
		}
	});

	$effect(() => {
		if (open && panelEl) {
			const release = trapFocus(panelEl);
			return release;
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
		if (pct >= 90) return 'var(--color-status-error)';
		if (pct >= 70) return 'var(--color-status-warning)';
		return 'var(--color-status-success)';
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="health-overlay" onkeydown={handleKeydown} onclick={onClose}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			bind:this={panelEl}
			class="health-panel"
			role="dialog"
			aria-modal="true"
			aria-label="Application health"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={handleKeydown}
		>
			<div class="panel-header">
				<h2><i class="bi bi-activity"></i> Application Health</h2>
				<div class="panel-header-actions">
					<button class="refresh-btn" onclick={fetchHealth} disabled={loading} aria-label="Refresh">
						<i class="bi bi-arrow-clockwise" class:spinning={loading}></i>
					</button>
					<button class="close-btn" onclick={onClose} aria-label="Close"> × </button>
				</div>
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
							{#if data.storage.totalCache}
								<div class="progress-section">
									<div class="progress-header">
										<span class="stat-label">Total Cache</span>
										<span class="stat-detail">
											{#if data.storage.totalCache.quotaBytes}
												{formatBytes(data.storage.totalCache.usedBytes)} / {formatBytes(
													data.storage.totalCache.quotaBytes,
												)}
											{:else}
												{formatBytes(data.storage.totalCache.usedBytes)} &middot; No limit
											{/if}
										</span>
									</div>
									<div class="health-progress">
										<div
											class="health-progress-bar"
											style="width: {data.storage.totalCache
												.percentage}%; background: {progressColor(
												data.storage.totalCache.percentage,
											)};"
										></div>
									</div>
								</div>
							{/if}
							<div class="progress-section">
								<div class="progress-header">
									<span class="stat-label">Your Cache</span>
									<span class="stat-detail"
										>{formatBytes(data.storage.cache.usedBytes)} / {formatBytes(
											data.storage.cache.quotaBytes,
										)}</span
									>
								</div>
								<div class="health-progress">
									<div
										class="health-progress-bar"
										style="width: {data.storage.cache.percentage}%; background: {progressColor(
											data.storage.cache.percentage,
										)};"
									></div>
								</div>
							</div>
							{#if data.storage.disk}
								<div class="progress-section">
									<div class="progress-header">
										<span class="stat-label">Disk</span>
										<span class="stat-detail"
											>{formatBytes(data.storage.disk.usedBytes)} / {formatBytes(
												data.storage.disk.totalBytes,
											)}</span
										>
									</div>
									<div class="health-progress">
										<div
											class="health-progress-bar"
											style="width: {data.storage.disk.percentage}%; background: {progressColor(
												data.storage.disk.percentage,
											)};"
										></div>
									</div>
								</div>
							{/if}
							{#if data.storage.library}
								<div class="library-stats">
									{#if data.storage.library.video}
										<div class="stat-row">
											<span class="stat-label"><i class="bi bi-film"></i> Video Library</span>
											<span class="stat-detail"
												>{data.storage.library.video.count} files &middot; {formatBytes(
													data.storage.library.video.usedBytes,
												)}</span
											>
										</div>
									{/if}
									{#if data.storage.library.music}
										<div class="stat-row">
											<span class="stat-label"
												><i class="bi bi-music-note-beamed"></i> Music Library</span
											>
											<span class="stat-detail"
												>{data.storage.library.music.count} files &middot; {formatBytes(
													data.storage.library.music.usedBytes,
												)}</span
											>
										</div>
									{/if}
								</div>
							{/if}
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
								<span class="stat-value"
									>{data.subscriptions.active}
									<span class="stat-dim">/ {data.subscriptions.total}</span></span
								>
							</div>
							<div class="stat-row">
								<span class="stat-label">Monitors</span>
								<span class="stat-value"
									>{data.monitors.enabled}
									<span class="stat-dim">/ {data.monitors.total}</span></span
								>
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
		background: var(--color-overlay-medium);
		backdrop-filter: blur(4px);
		z-index: var(--z-modal);
		display: flex;
		align-items: center;
		justify-content: center;
		animation: fadeIn 200ms ease;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(16px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.health-panel {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
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
		border-bottom: 1px solid var(--color-border-default);
	}

	.panel-header h2 {
		font-size: 1.1rem;
		margin: 0;
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		color: var(--color-text-primary);
	}

	.panel-header h2 .bi {
		color: var(--color-accent-primary);
	}

	.panel-header-actions {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.close-btn,
	.refresh-btn {
		background: transparent;
		border: none;
		color: var(--color-text-secondary);
		font-size: 1rem;
		cursor: pointer;
		padding: var(--spacing-xs);
		border-radius: var(--radius-sm);
		display: flex;
		align-items: center;
	}

	.close-btn {
		font-size: 1.75rem;
		line-height: 1;
		font-weight: 300;
	}

	.close-btn:hover,
	.refresh-btn:hover {
		color: var(--color-text-primary);
		background: var(--color-overlay-hover);
	}

	.close-btn:hover {
		color: var(--color-status-error);
	}

	.refresh-btn:disabled {
		cursor: default;
		opacity: 0.5;
	}

	.spinning {
		animation: spin 0.8s linear infinite;
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
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-overlay-white-06);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
	}

	.stat-card.wide {
		grid-column: 1 / -1;
	}

	.card-title {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-bottom: var(--spacing-sm);
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.card-title .bi {
		font-size: 0.85rem;
		color: var(--color-accent-primary);
	}

	.stat-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 5px 0;
	}

	.stat-row + .stat-row {
		border-top: 1px solid var(--color-overlay-white-05);
	}

	.stat-label {
		font-size: 0.825rem;
		color: var(--color-text-secondary);
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
		color: var(--color-text-primary);
	}

	.stat-value.accent {
		color: var(--color-accent-primary);
	}
	.stat-value.success {
		color: var(--color-status-success);
	}
	.stat-value.error {
		color: var(--color-status-error);
	}
	.stat-value.live {
		color: var(--color-status-error);
	}
	.stat-value.mono {
		font-family: monospace;
		font-size: 0.8rem;
	}

	.stat-dim {
		font-weight: 400;
		color: var(--color-text-tertiary);
	}

	.stat-detail {
		font-size: 0.8rem;
		color: var(--color-text-secondary);
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
		background: var(--color-bg-elevated);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.health-progress-bar {
		height: 100%;
		border-radius: var(--radius-sm);
		transition: width var(--transition-normal);
	}

	.library-stats {
		margin-top: var(--spacing-xs);
		border-top: 1px solid var(--color-overlay-white-05);
		padding-top: var(--spacing-xs);
	}

	.status-indicator {
		display: inline-block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--color-status-error);
		margin-right: 4px;
	}

	.status-indicator.connected {
		background: var(--color-status-success);
	}

	.error-state {
		text-align: center;
		padding: var(--spacing-2xl);
		color: var(--color-text-secondary);
	}

	.error-state .bi {
		font-size: 2rem;
		color: var(--color-status-warning);
		display: block;
		margin-bottom: var(--spacing-md);
	}

	.retry-btn {
		margin-top: var(--spacing-md);
		padding: var(--spacing-sm) var(--spacing-lg);
		background: var(--color-accent-primary);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		cursor: pointer;
		font-weight: 500;
	}

	.retry-btn:hover {
		background: var(--color-accent-hover);
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

	@media (prefers-reduced-motion: reduce) {
		.health-overlay {
			animation: none;
			opacity: 1;
		}

		.health-panel {
			animation: none;
			opacity: 1;
			transform: none;
		}

		.spinning {
			animation: none;
		}

		.health-progress-bar {
			transition: none;
		}
	}
</style>
