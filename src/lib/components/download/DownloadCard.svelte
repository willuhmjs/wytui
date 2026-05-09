<script lang="ts">
	import { showConfirm } from '$lib/stores/modal.svelte';
	import type { Download } from '$lib/types';

	let {
		download,
		jellyfinUrl = '',
		selectionMode = false,
		selected = false,
		onToggleSelect,
	}: {
		download: Download & { processingStep?: string };
		jellyfinUrl?: string;
		selectionMode?: boolean;
		selected?: boolean;
		onToggleSelect?: () => void;
	} = $props();

	let progressPercent = $derived(download.progress?.toFixed(1) || 0);
	let statusColor = $derived(getStatusColor(download.status));
	let mediaType = $derived(download.filename?.split('.').pop()?.toUpperCase() || null);

	let formattedDuration = $derived.by(() => {
		if (!download.duration) return null;
		const s = download.duration;
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		const sec = s % 60;
		return h > 0
			? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
			: `${m}:${String(sec).padStart(2, '0')}`;
	});

	let formattedSize = $derived.by(() => {
		if (!download.filesize) return null;
		const bytes = Number(download.filesize);
		if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
		if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`;
		return `${(bytes / 1024).toFixed(0)} KB`;
	});
	let jellyfinQuery = $derived(
		download.artist
			? `${download.artist} ${download.title?.split(' - ').pop()?.trim() || download.title || ''}`
			: download.title || ''
	);

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

	async function retryDownload() {
		try {
			const body: any = { url: download.url, profileId: download.profileId };
			if (download.storagePool === 'library') body.saveToLibrary = true;
			if (download.customFlags?.length) body.customFlags = download.customFlags;
			await fetch('/api/downloads', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			await fetch(`/api/downloads/${download.id}`, { method: 'DELETE' });
		} catch (e) {
			console.error('Failed to retry:', e);
		}
	}

	let promoting = $state(false);

	async function promoteToLibrary() {
		promoting = true;
		try {
			const res = await fetch(`/api/downloads/${download.id}/promote`, { method: 'POST' });
			if (res.ok) {
				const updated = await res.json();
				download.storagePool = updated.storagePool;
			}
		} catch (e) {
			console.error('Failed to promote:', e);
		} finally {
			promoting = false;
		}
	}

	function isMobileDevice() {
		return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
			navigator.userAgent
		);
	}

	async function downloadFile() {
		// Only use share dialog on mobile devices
		const useMobileShare =
			isMobileDevice() && navigator.canShare?.({ files: [new File([], 'test')] });

		if (!useMobileShare) {
			window.open(`/api/files/${download.id}`, '_blank');
			return;
		}

		try {
			const response = await fetch(`/api/files/${download.id}`);
			if (!response.ok) throw new Error('Download failed');

			const blob = await response.blob();
			const file = new File([blob], download.filename || 'download', { type: blob.type });
			await navigator.share({ files: [file] });
		} catch (e: any) {
			if (e.name !== 'AbortError') {
				console.error('Share failed:', e);
			}
		}
	}
</script>

<div class="download-card" class:selecting={selectionMode} class:selected>
	{#if selectionMode && download.status === 'COMPLETED'}
		<button class="select-overlay" onclick={onToggleSelect}>
			<div class="select-checkbox" class:checked={selected}>
				{#if selected}
					<svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><path d="M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2.5-2.5a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z"/></svg>
				{/if}
			</div>
		</button>
	{/if}
	{#if download.thumbnail}
		<div
			class="thumbnail"
			style="background-image: url({download.thumbnail})"
		></div>
	{/if}

	<div class="content">
		<div class="header">
			<h3>{download.title || download.url}</h3>
			<div class="header-badges">
				{#if mediaType}
					<span class="media-badge">{mediaType}</span>
				{/if}
				{#if download.status === 'COMPLETED'}
					<span class="pool-badge" class:library={download.storagePool === 'library'}>
						{download.storagePool === 'library' ? 'Library' : 'Cache'}
					</span>
				{/if}
				<span class="status-icon" title={getStatusLabel(download.status)}>
					{#if download.status === 'COMPLETED'}
						<svg viewBox="0 0 20 20" fill="var(--success)" width="18" height="18"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd" /></svg>
					{:else if download.status === 'FAILED'}
						<svg viewBox="0 0 20 20" fill="var(--error)" width="18" height="18"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clip-rule="evenodd" /></svg>
					{:else if download.status === 'CANCELLED'}
						<svg viewBox="0 0 20 20" fill="var(--text-tertiary)" width="18" height="18"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM6.75 9.25a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5z" clip-rule="evenodd" /></svg>
					{:else if download.status === 'DOWNLOADING'}
						<svg viewBox="0 0 20 20" fill="var(--accent-primary)" width="18" height="18"><path d="M10 2a.75.75 0 01.75.75v5.59l1.95-2.1a.75.75 0 111.1 1.02l-3.25 3.5a.75.75 0 01-1.1 0L6.2 7.26a.75.75 0 011.1-1.02l1.95 2.1V2.75A.75.75 0 0110 2z" /><path d="M5.273 4.5a1.25 1.25 0 00-1.205.918l-1.523 5.52c-.006.02-.01.041-.015.062H6a1.25 1.25 0 011.173.82l.243.693a.25.25 0 00.235.164h4.698a.25.25 0 00.234-.164l.244-.693A1.25 1.25 0 0114 11h3.47a1.318 1.318 0 00-.015-.062l-1.523-5.52a1.25 1.25 0 00-1.205-.918h-.558a.75.75 0 010-1.5h.558a2.75 2.75 0 012.651 2.019l1.523 5.52c.066.239.099.485.099.733V15a2 2 0 01-2 2H3a2 2 0 01-2-2v-3.228c0-.248.033-.494.099-.733l1.523-5.52A2.75 2.75 0 015.273 3.5h.558a.75.75 0 010 1.5h-.558z" /></svg>
					{:else if download.status === 'PROCESSING'}
						<svg viewBox="0 0 20 20" fill="var(--warning)" width="18" height="18" class="spin"><path fill-rule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H4.28a.75.75 0 00-.75.75v3.955a.75.75 0 001.5 0v-2.173l.207.208a7 7 0 0011.675-3.143.75.75 0 00-1.6-.252zm-1.699-7.339a7 7 0 00-11.675 3.143.75.75 0 001.6.252 5.5 5.5 0 019.201-2.466l.312.311H10.62a.75.75 0 100 1.5h3.953a.75.75 0 00.75-.75V2.12a.75.75 0 00-1.5 0v2.173l-.208-.208z" clip-rule="evenodd" /></svg>
					{:else if download.status === 'FETCHING_INFO'}
						<svg viewBox="0 0 20 20" fill="var(--info)" width="18" height="18" class="spin"><path fill-rule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H4.28a.75.75 0 00-.75.75v3.955a.75.75 0 001.5 0v-2.173l.207.208a7 7 0 0011.675-3.143.75.75 0 00-1.6-.252zm-1.699-7.339a7 7 0 00-11.675 3.143.75.75 0 001.6.252 5.5 5.5 0 019.201-2.466l.312.311H10.62a.75.75 0 100 1.5h3.953a.75.75 0 00.75-.75V2.12a.75.75 0 00-1.5 0v2.173l-.208-.208z" clip-rule="evenodd" /></svg>
					{:else if download.status === 'PENDING'}
						<svg viewBox="0 0 20 20" fill="var(--text-tertiary)" width="18" height="18"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clip-rule="evenodd" /></svg>
					{/if}
				</span>
			</div>
		</div>

		{#if download.uploader}
			<p class="uploader">{download.uploader}</p>
		{/if}

		{#if download.status === 'COMPLETED' && (formattedDuration || formattedSize)}
			<div class="meta-badges">
				{#if formattedDuration}
					<span class="meta-badge">{formattedDuration}</span>
				{/if}
				{#if formattedSize}
					<span class="meta-badge">{formattedSize}</span>
				{/if}
			</div>
		{/if}

		{#if download.status === 'FETCHING_INFO'}
			<div class="progress">
				<div class="progress-bar indeterminate"></div>
			</div>
			<div class="progress-info">
				<span>Fetching video information...</span>
			</div>
		{/if}

		{#if download.status === 'DOWNLOADING'}
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

		{#if download.status === 'PROCESSING'}
			<div class="progress">
				<div class="progress-bar indeterminate processing"></div>
			</div>
			<div class="progress-info">
				<span>{download.processingStep || 'Processing...'}</span>
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
			{#if download.status === 'DOWNLOADING' || download.status === 'PENDING' || download.status === 'FETCHING_INFO' || download.status === 'PROCESSING'}
				<button class="btn btn-sm btn-danger" onclick={cancelDownload}>
					Cancel
				</button>
			{/if}

			{#if download.status === 'COMPLETED'}
				<button class="btn btn-sm btn-primary" onclick={downloadFile}>
					Download
				</button>
				{#if download.storagePool === 'cache'}
					<button class="btn btn-sm btn-accent" onclick={promoteToLibrary} disabled={promoting}>
						{promoting ? 'Saving...' : 'Save to Library'}
					</button>
				{/if}
				{#if download.storagePool === 'library' && jellyfinUrl}
					<a
						class="btn btn-sm btn-secondary"
						href="{jellyfinUrl}/web/#/search.html?query={encodeURIComponent(jellyfinQuery)}"
						target="_blank"
						rel="noopener"
					>
						Open in Jellyfin
					</a>
				{/if}
			{/if}

			{#if download.status === 'FAILED' || download.status === 'CANCELLED'}
				<button class="btn btn-sm btn-primary" onclick={retryDownload}>
					Retry
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
		flex-shrink: 0;
		position: relative;
	}

	.download-card:hover {
		border-color: var(--border-light);
		transform: translateY(-2px);
		box-shadow: var(--shadow-md);
	}

	.download-card.selected {
		border-color: var(--accent-primary);
		box-shadow: 0 0 0 1px var(--accent-primary);
	}

	.select-overlay {
		position: absolute;
		top: var(--spacing-sm);
		left: var(--spacing-sm);
		z-index: 2;
		background: transparent;
		border: none;
		padding: 0;
		cursor: pointer;
	}

	.select-checkbox {
		width: 22px;
		height: 22px;
		border-radius: var(--radius-sm);
		border: 2px solid rgba(255, 255, 255, 0.4);
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s;
	}

	.select-checkbox.checked {
		background: var(--accent-primary);
		border-color: var(--accent-primary);
		color: white;
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
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}

	.header-badges {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		flex-shrink: 0;
	}

	.media-badge {
		font-size: 0.625rem;
		font-weight: 600;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		letter-spacing: 0.05em;
		background: rgba(99, 102, 241, 0.15);
		color: var(--accent-primary);
		font-family: monospace;
	}

	.pool-badge {
		font-size: 0.625rem;
		font-weight: 600;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		background: var(--bg-tertiary);
		color: var(--text-tertiary);
	}

	.pool-badge.library {
		background: rgba(16, 185, 129, 0.15);
		color: var(--success);
	}

	.status-icon {
		display: flex;
		align-items: center;
		line-height: 0;
	}

	.status-icon :global(.spin) {
		animation: spin 1.5s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	.uploader {
		color: var(--text-secondary);
		font-size: 0.875rem;
		margin-bottom: var(--spacing-sm);
	}

	.meta-badges {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-xs);
		margin-bottom: var(--spacing-md);
	}

	.meta-badge {
		font-size: 0.625rem;
		font-weight: 500;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		background: rgba(255, 255, 255, 0.06);
		color: var(--text-secondary);
		font-family: monospace;
		letter-spacing: 0.02em;
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

	.progress-bar.indeterminate.processing {
		background: linear-gradient(
			90deg,
			var(--bg-tertiary) 0%,
			var(--warning) 25%,
			var(--warning) 75%,
			var(--bg-tertiary) 100%
		);
		background-size: 200% 100%;
		animation: indeterminate 1.5s ease-in-out infinite;
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

	@media (max-width: 768px) {
		.thumbnail {
			height: 140px;
		}

		.content {
			padding: var(--spacing-md);
		}

		h3 {
			font-size: 0.9375rem;
		}

		.actions {
			flex-wrap: wrap;
		}

		.actions button {
			flex: 1;
			min-width: 0;
		}
	}
</style>
