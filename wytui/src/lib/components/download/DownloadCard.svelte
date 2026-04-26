<script lang="ts">
	import { showConfirm } from '$lib/stores/modal.svelte';
	import type { Download } from '$lib/types';

	let { download }: { download: Download } = $props();

	let progressPercent = $derived(download.progress?.toFixed(1) || 0);
	let statusColor = $derived(getStatusColor(download.status));

	function getStatusColor(status: string) {
		const colors: Record<string, string> = {
			PENDING: 'var(--text-tertiary)',
			FETCHING_INFO: 'var(--info)',
			DOWNLOADING: 'var(--accent-primary)',
			PROCESSING: 'var(--warning)',
			COMPLETED: 'var(--success)',
			FAILED: 'var(--error)',
			CANCELLED: 'var(--text-tertiary)',
		};
		return colors[status] || 'var(--text-secondary)';
	}

	function getStatusLabel(status: string) {
		const labels: Record<string, string> = {
			PENDING: 'Pending',
			FETCHING_INFO: 'Fetching Info',
			DOWNLOADING: 'Downloading',
			PROCESSING: 'Processing',
			COMPLETED: 'Completed',
			FAILED: 'Failed',
			CANCELLED: 'Cancelled',
		};
		return labels[status] || status;
	}

	async function cancelDownload() {
		const confirmed = await showConfirm(
			'Cancel Download',
			'Are you sure you want to cancel this download?',
			'Cancel Download'
		);
		if (!confirmed) return;

		try {
			await fetch(`/api/downloads/${download.id}/cancel`, { method: 'POST' });
		} catch (e) {
			console.error('Failed to cancel:', e);
		}
	}

	async function deleteDownload() {
		const confirmed = await showConfirm(
			'Delete Download',
			'Are you sure you want to delete this download?',
			'Delete'
		);
		if (!confirmed) return;

		try {
			await fetch(`/api/downloads/${download.id}`, { method: 'DELETE' });
		} catch (e) {
			console.error('Failed to delete:', e);
		}
	}

	async function downloadFile() {
		window.open(`/api/files/${download.id}`, '_blank');
	}
</script>

<div class="download-card">
	{#if download.thumbnail}
		<div
			class="thumbnail"
			style="background-image: url({download.thumbnail})"
		></div>
	{/if}

	<div class="content">
		<div class="header">
			<h3>{download.title || download.url}</h3>
			<span class="status" style="color: {statusColor}">
				{getStatusLabel(download.status)}
			</span>
		</div>

		{#if download.uploader}
			<p class="uploader">{download.uploader}</p>
		{/if}

		{#if download.status === 'FETCHING_INFO'}
			<div class="progress">
				<div class="progress-bar indeterminate"></div>
			</div>
			<div class="progress-info">
				<span>Fetching video information...</span>
			</div>
		{/if}

		{#if download.status === 'DOWNLOADING' || download.status === 'PROCESSING'}
			<div class="progress">
				<div class="progress-bar" style="width: {progressPercent}%"></div>
			</div>
			<div class="progress-info">
				<span>{progressPercent}%</span>
				{#if download.speed}
					<span>{download.speed}</span>
				{/if}
				{#if download.eta}
					<span>ETA: {download.eta}</span>
				{/if}
			</div>
		{/if}

		{#if download.status === 'PENDING'}
			<div class="progress-info">
				<span class="text-muted">Waiting in queue...</span>
			</div>
		{/if}

		{#if download.error}
			<div class="error">{download.error}</div>
		{/if}

		<div class="actions">
			{#if download.status === 'DOWNLOADING' || download.status === 'PENDING' || download.status === 'FETCHING_INFO'}
				<button class="btn btn-sm btn-danger" onclick={cancelDownload}>
					Cancel
				</button>
			{/if}

			{#if download.status === 'COMPLETED'}
				<button class="btn btn-sm btn-primary" onclick={downloadFile}>
					Download
				</button>
			{/if}

			{#if download.status === 'COMPLETED' || download.status === 'FAILED' || download.status === 'CANCELLED'}
				<button class="btn btn-sm btn-secondary" onclick={deleteDownload}>
					Delete
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.download-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		overflow: hidden;
		transition: all var(--transition-normal);
	}

	.download-card:hover {
		border-color: var(--border-light);
		transform: translateY(-2px);
		box-shadow: var(--shadow-md);
	}

	.thumbnail {
		width: 100%;
		height: 180px;
		background-size: cover;
		background-position: center;
		background-color: var(--bg-tertiary);
	}

	.content {
		padding: var(--spacing-lg);
	}

	.header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-sm);
	}

	h3 {
		font-size: 1rem;
		line-height: 1.4;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
	}

	.status {
		font-size: 0.75rem;
		font-weight: 600;
		white-space: nowrap;
	}

	.uploader {
		color: var(--text-secondary);
		font-size: 0.875rem;
		margin-bottom: var(--spacing-md);
	}

	.progress {
		margin-bottom: var(--spacing-sm);
		height: 4px;
		background: var(--bg-tertiary);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.progress-bar {
		height: 100%;
		background: var(--accent-primary);
		border-radius: var(--radius-sm);
		transition: width 0.3s ease;
		position: relative;
	}

	.progress-bar::after {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		bottom: 0;
		right: 0;
		background: linear-gradient(
			90deg,
			transparent,
			rgba(255, 255, 255, 0.3),
			transparent
		);
		animation: shimmer 2s infinite;
	}

	@keyframes shimmer {
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(100%);
		}
	}

	.progress-bar.indeterminate {
		width: 100%;
		background: linear-gradient(
			90deg,
			var(--bg-tertiary) 0%,
			var(--accent-primary) 25%,
			var(--accent-primary) 75%,
			var(--bg-tertiary) 100%
		);
		background-size: 200% 100%;
		animation: indeterminate 1.5s ease-in-out infinite;
	}

	.progress-bar.indeterminate::after {
		display: none;
	}

	@keyframes indeterminate {
		0% {
			background-position: 100% 0;
		}
		100% {
			background-position: -100% 0;
		}
	}

	.progress-info {
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
		color: var(--text-secondary);
		margin-bottom: var(--spacing-md);
	}

	.error {
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid var(--error);
		border-radius: var(--radius-md);
		padding: var(--spacing-sm);
		color: var(--error);
		font-size: 0.75rem;
		margin-bottom: var(--spacing-md);
	}

	.actions {
		display: flex;
		gap: var(--spacing-sm);
	}
</style>
