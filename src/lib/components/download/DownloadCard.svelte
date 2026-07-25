<script lang="ts">
	import { goto } from '$app/navigation';
	import { showConfirm } from '$lib/stores/modal.svelte';
	import { csrfFetch } from '$lib/utils/fetch';
	import { getDownloadStatusColor, getDownloadStatusLabel } from '$lib/utils/format';
	import { downloadOrShare } from '$lib/utils/download';
	import type { Download } from '$lib/types';
	import XIcon from '$lib/components/icons/XIcon.svelte';
	import DownloadIcon from '$lib/components/icons/DownloadIcon.svelte';
	import DownloadVersionPicker from '$lib/components/download/DownloadVersionPicker.svelte';
	import FolderDownIcon from '$lib/components/icons/FolderDownIcon.svelte';
	import ExternalLinkIcon from '$lib/components/icons/ExternalLinkIcon.svelte';
	import RefreshIcon from '$lib/components/icons/RefreshIcon.svelte';
	import TrashIcon from '$lib/components/icons/TrashIcon.svelte';
	import AddToPlaylistMenu from '$lib/components/playlist/AddToPlaylistMenu.svelte';

	let {
		download,
		jellyfinUrl = '',
		selectionMode = false,
		selected = false,
		libraryConfigured = false,
		onToggleSelect,
	}: {
		download: Download & {
			processingStep?: string;
			indeterminate?: boolean;
			stepStartedAt?: number;
		};
		jellyfinUrl?: string;
		selectionMode?: boolean;
		selected?: boolean;
		libraryConfigured?: boolean;
		onToggleSelect?: () => void;
	} = $props();

	let progressPercent = $derived(download.progress?.toFixed(1) ?? '0');
	let statusColor = $derived(getDownloadStatusColor(download.status));
	let mediaType = $derived(download.filename?.split('.').pop()?.toUpperCase() || null);

	// For indeterminate progress timer
	let elapsedTime = $state(0);
	let timerInterval = $state<number | null>(null);

	function formatElapsed(ms: number): string {
		const totalSeconds = Math.floor(ms / 1000);
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes}:${String(seconds).padStart(2, '0')}`;
	}

	$effect(() => {
		if (download.status === 'PROCESSING' && download.indeterminate && download.stepStartedAt) {
			// Start timer
			if (!timerInterval) {
				elapsedTime = Date.now() - download.stepStartedAt;
				timerInterval = window.setInterval(() => {
					if (download.stepStartedAt) {
						elapsedTime = Date.now() - download.stepStartedAt;
					}
				}, 1000);
			}
		} else {
			// Stop timer
			if (timerInterval) {
				clearInterval(timerInterval);
				timerInterval = null;
				elapsedTime = 0;
			}
		}

		return () => {
			if (timerInterval) {
				clearInterval(timerInterval);
				timerInterval = null;
			}
		};
	});

	const VIDEO_EXTENSIONS = new Set(['MP4', 'WEBM', 'MKV', 'FLV', 'MOV', 'AVI']);
	let isPreviewable = $derived(
		download.status === 'COMPLETED' && mediaType !== null && VIDEO_EXTENSIONS.has(mediaType),
	);
	let showPreview = $state(false);
	let videoEl = $state<HTMLVideoElement | null>(null);
	let thumbnailFailed = $state(false);
	let videoProgress = $state(0);
	let isDragging = $state(false);
	let seekTarget = $state(-1);
	let isMuted = $state(true);
	let progressBarEl = $state<HTMLDivElement | null>(null);
	let videoDuration = $state(0);
	let videoTimestamp = $state<string | null>(null);

	function handleThumbnailEnter() {
		if (!isPreviewable || isMobileDevice()) return;
		showPreview = true;
		videoTimestamp = '0:00';
	}

	function handleThumbnailLeave() {
		if (isDragging) return;
		showPreview = false;
		videoProgress = 0;
		seekTarget = -1;
		isMuted = true;
		videoDuration = 0;
		videoTimestamp = null;
		if (videoEl) {
			videoEl.pause();
			videoEl.removeAttribute('src');
			videoEl.load();
		}
	}

	function formatTime(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${String(s).padStart(2, '0')}`;
	}

	function updateTimestamp() {
		if (!videoDuration) return;
		videoTimestamp = formatTime(videoProgress * videoDuration);
	}

	function handleTimeUpdate() {
		if (!videoEl || !videoEl.duration) return;
		videoDuration = videoEl.duration;
		if (isDragging) return;
		const current = videoEl.currentTime / videoEl.duration;
		if (seekTarget >= 0) {
			if (Math.abs(current - seekTarget) > 0.05) return;
			seekTarget = -1;
		}
		videoProgress = current;
		updateTimestamp();
	}

	function seekToPosition(clientX: number) {
		if (!progressBarEl || !videoEl || !videoEl.duration) return;
		const rect = progressBarEl.getBoundingClientRect();
		const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
		seekTarget = ratio;
		videoEl.currentTime = ratio * videoEl.duration;
		videoProgress = ratio;
		updateTimestamp();
	}

	function handleProgressMouseDown(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		isDragging = true;
		seekToPosition(e.clientX);
		window.addEventListener('mousemove', handleProgressMouseMove);
		window.addEventListener('mouseup', handleProgressMouseUp);
	}

	function handleProgressMouseMove(e: MouseEvent) {
		seekToPosition(e.clientX);
	}

	let justDragged = false;

	function handleProgressMouseUp(e: MouseEvent) {
		isDragging = false;
		justDragged = true;
		requestAnimationFrame(() => {
			justDragged = false;
		});
		window.removeEventListener('mousemove', handleProgressMouseMove);
		window.removeEventListener('mouseup', handleProgressMouseUp);
		if (progressBarEl) {
			const card = progressBarEl.closest('.download-card');
			if (card && !card.contains(e.target as Node)) {
				handleThumbnailLeave();
			}
		}
	}

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
			: download.title || '',
	);

	async function cancelDownload() {
		const confirmed = await showConfirm(
			'Cancel Download',
			'Are you sure you want to cancel this download?',
			'Cancel Download',
		);
		if (!confirmed) return;

		try {
			await csrfFetch(`/api/downloads/${download.id}/cancel`, { method: 'POST' });
		} catch (e) {
			console.error('Failed to cancel:', e);
		}
	}

	async function deleteDownload() {
		const confirmed = await showConfirm(
			'Delete Download',
			'Are you sure you want to delete this download?',
			'Delete',
		);
		if (!confirmed) return;

		try {
			await csrfFetch(`/api/downloads/${download.id}`, { method: 'DELETE' });
		} catch (e) {
			console.error('Failed to delete:', e);
		}
	}

	async function retryDownload() {
		try {
			const body: any = { url: download.url, profileId: download.profileId };
			if (download.storagePool === 'library') body.saveToLibrary = true;
			if (download.customFlags?.length) body.customFlags = download.customFlags;
			await csrfFetch('/api/downloads', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			await csrfFetch(`/api/downloads/${download.id}`, { method: 'DELETE' });
		} catch (e) {
			console.error('Failed to retry:', e);
		}
	}

	let redownloading = $state(false);

	async function redownload() {
		redownloading = true;
		try {
			const body: any = { url: download.url, profileId: download.profileId };
			if (download.storagePool === 'library') body.saveToLibrary = true;
			if (download.customFlags?.length) body.customFlags = download.customFlags;

			const res = await csrfFetch('/api/downloads', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});

			if (!res.ok) throw new Error(`HTTP ${res.status}`);
		} catch (e) {
			console.error('Failed to redownload:', e);
		} finally {
			redownloading = false;
		}
	}

	let promoting = $state(false);
	let copied = $state(false);

	async function copyUrl() {
		try {
			await navigator.clipboard.writeText(download.url);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// fallback
			const ta = document.createElement('textarea');
			ta.value = download.url;
			ta.style.position = 'fixed';
			ta.style.opacity = '0';
			document.body.appendChild(ta);
			ta.select();
			document.execCommand('copy');
			document.body.removeChild(ta);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		}
	}

	async function promoteToLibrary() {
		promoting = true;
		try {
			const res = await csrfFetch(`/api/downloads/${download.id}/promote`, { method: 'POST' });
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

	function handleCardClick(e: MouseEvent) {
		if (justDragged) return;
		if (selectionMode) {
			onToggleSelect?.();
			return;
		}
		if (download.status !== 'COMPLETED') return;
		const target = e.target as HTMLElement;
		if (target.closest('button, a, video, audio')) return;
		goto(`/downloads/${download.id}`);
	}

	function isMobileDevice() {
		return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
			navigator.userAgent,
		);
	}

	async function downloadFile() {
		await downloadOrShare(download.id, download.filename || download.title || undefined);
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="download-card"
	class:selecting={selectionMode}
	class:selected
	class:clickable={download.status === 'COMPLETED' && !selectionMode}
	onclick={handleCardClick}
>
	{#if selectionMode && download.status === 'COMPLETED'}
		<button class="select-overlay" onclick={onToggleSelect}>
			<div class="select-checkbox" class:checked={selected}>
				{#if selected}
					<svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"
						><path
							d="M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2.5-2.5a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z"
						/></svg
					>
				{/if}
			</div>
		</button>
	{/if}
	{#if download.thumbnail || isPreviewable}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="thumbnail" onmouseenter={handleThumbnailEnter} onmouseleave={handleThumbnailLeave}>
			{#if download.thumbnail && !thumbnailFailed}
				<img
					class="thumbnail-img"
					src={download.thumbnail}
					alt={download.title || 'Thumbnail'}
					onerror={() => (thumbnailFailed = true)}
				/>
			{:else if isPreviewable && !showPreview}
				<video class="thumbnail-img" src="/api/files/{download.id}#t=0.001" preload="metadata" muted
				></video>
			{/if}
			{#if !showPreview && download.status === 'COMPLETED'}
				<div class="play-overlay">
					<svg viewBox="0 0 24 24" fill="white" width="36" height="36"
						><path d="M8 5v14l11-7z" /></svg
					>
				</div>
			{/if}
			{#if showPreview}
				<video
					bind:this={videoEl}
					class="video-preview"
					src="/api/files/{download.id}"
					muted={isMuted}
					autoplay
					loop
					preload="none"
					ontimeupdate={handleTimeUpdate}
				></video>
				{#if videoTimestamp}
					<span class="video-time">{videoTimestamp}</span>
				{/if}
				<button
					class="mute-btn"
					onclick={(e) => {
						e.stopPropagation();
						isMuted = !isMuted;
					}}
				>
					{#if isMuted}
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="white"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							width="16"
							height="16"
							><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line
								x1="23"
								y1="9"
								x2="17"
								y2="15"
							/><line x1="17" y1="9" x2="23" y2="15" /></svg
						>
					{:else}
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="white"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							width="16"
							height="16"
							><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path
								d="M19.07 4.93a10 10 0 0 1 0 14.14"
							/><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg
						>
					{/if}
				</button>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="video-progress-bar"
					class:dragging={isDragging}
					bind:this={progressBarEl}
					onmousedown={handleProgressMouseDown}
				>
					<div class="progress-fill" style="width: {videoProgress * 100}%"></div>
				</div>
			{/if}
		</div>
	{/if}

	<div class="content">
		<div class="header">
			<h3>{download.title || download.url}</h3>
			<div class="header-badges">
				<button
					class="copy-url-btn"
					class:copied
					onclick={copyUrl}
					title={copied ? 'Copied!' : 'Copy source URL'}
				>
					{#if copied}
						<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"
							><path
								fill-rule="evenodd"
								d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
								clip-rule="evenodd"
							/></svg
						>
					{:else}
						<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"
							><path
								fill-rule="evenodd"
								d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5zm4.03-.78a.75.75 0 011.06 0L15 10.38V7.75a.75.75 0 011.5 0v4.5a.75.75 0 01-.75.75h-4.5a.75.75 0 010-1.5h2.63L8.28 5.78a.75.75 0 010-1.06z"
								clip-rule="evenodd"
							/></svg
						>
					{/if}
				</button>
				{#if mediaType}
					<span class="media-badge">{mediaType}</span>
				{/if}
				{#if download.status === 'COMPLETED'}
					<span class="pool-badge" class:library={download.storagePool === 'library'}>
						{download.storagePool === 'library' ? 'Library' : 'Cache'}
					</span>
				{/if}
				<span class="status-icon" title={getDownloadStatusLabel(download.status)}>
					{#if download.status === 'COMPLETED'}
						<svg viewBox="0 0 20 20" fill="var(--color-status-success)" width="18" height="18"
							><path
								fill-rule="evenodd"
								d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
								clip-rule="evenodd"
							/></svg
						>
					{:else if download.status === 'FAILED'}
						<svg viewBox="0 0 20 20" fill="var(--color-status-error)" width="18" height="18"
							><path
								fill-rule="evenodd"
								d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
								clip-rule="evenodd"
							/></svg
						>
					{:else if download.status === 'CANCELLED'}
						<svg viewBox="0 0 20 20" fill="var(--color-text-tertiary)" width="18" height="18"
							><path
								fill-rule="evenodd"
								d="M10 18a8 8 0 100-16 8 8 0 000 16zM6.75 9.25a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5z"
								clip-rule="evenodd"
							/></svg
						>
					{:else if download.status === 'DOWNLOADING'}
						<svg viewBox="0 0 20 20" fill="var(--color-accent-primary)" width="18" height="18"
							><path
								d="M10 2a.75.75 0 01.75.75v5.59l1.95-2.1a.75.75 0 111.1 1.02l-3.25 3.5a.75.75 0 01-1.1 0L6.2 7.26a.75.75 0 011.1-1.02l1.95 2.1V2.75A.75.75 0 0110 2z"
							/><path
								d="M5.273 4.5a1.25 1.25 0 00-1.205.918l-1.523 5.52c-.006.02-.01.041-.015.062H6a1.25 1.25 0 011.173.82l.243.693a.25.25 0 00.235.164h4.698a.25.25 0 00.234-.164l.244-.693A1.25 1.25 0 0114 11h3.47a1.318 1.318 0 00-.015-.062l-1.523-5.52a1.25 1.25 0 00-1.205-.918h-.558a.75.75 0 010-1.5h.558a2.75 2.75 0 012.651 2.019l1.523 5.52c.066.239.099.485.099.733V15a2 2 0 01-2 2H3a2 2 0 01-2-2v-3.228c0-.248.033-.494.099-.733l1.523-5.52A2.75 2.75 0 015.273 3.5h.558a.75.75 0 010 1.5h-.558z"
							/></svg
						>
					{:else if download.status === 'PROCESSING'}
						<svg
							viewBox="0 0 20 20"
							fill="var(--color-status-warning)"
							width="18"
							height="18"
							class="spin"
							><path
								fill-rule="evenodd"
								d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H4.28a.75.75 0 00-.75.75v3.955a.75.75 0 001.5 0v-2.173l.207.208a7 7 0 0011.675-3.143.75.75 0 00-1.6-.252zm-1.699-7.339a7 7 0 00-11.675 3.143.75.75 0 001.6.252 5.5 5.5 0 019.201-2.466l.312.311H10.62a.75.75 0 100 1.5h3.953a.75.75 0 00.75-.75V2.12a.75.75 0 00-1.5 0v2.173l-.208-.208z"
								clip-rule="evenodd"
							/></svg
						>
					{:else if download.status === 'FETCHING_INFO'}
						<svg
							viewBox="0 0 20 20"
							fill="var(--color-status-info)"
							width="18"
							height="18"
							class="spin"
							><path
								fill-rule="evenodd"
								d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H4.28a.75.75 0 00-.75.75v3.955a.75.75 0 001.5 0v-2.173l.207.208a7 7 0 0011.675-3.143.75.75 0 00-1.6-.252zm-1.699-7.339a7 7 0 00-11.675 3.143.75.75 0 001.6.252 5.5 5.5 0 019.201-2.466l.312.311H10.62a.75.75 0 100 1.5h3.953a.75.75 0 00.75-.75V2.12a.75.75 0 00-1.5 0v2.173l-.208-.208z"
								clip-rule="evenodd"
							/></svg
						>
					{:else if download.status === 'PENDING'}
						<svg viewBox="0 0 20 20" fill="var(--color-text-tertiary)" width="18" height="18"
							><path
								fill-rule="evenodd"
								d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z"
								clip-rule="evenodd"
							/></svg
						>
					{:else if download.status === 'DELETED'}
						<svg viewBox="0 0 20 20" fill="var(--color-text-tertiary)" width="18" height="18"
							><path
								fill-rule="evenodd"
								d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
								clip-rule="evenodd"
							/></svg
						>
					{/if}
				</span>
			</div>
		</div>

		{#if download.uploader}
			<div class="uploader-text">{download.uploader}</div>
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
				{#if download.indeterminate}
					<div class="progress-bar indeterminate processing" aria-busy="true"></div>
				{:else}
					<div class="progress-bar processing" style="width: {progressPercent}%"></div>
				{/if}
			</div>
			<div class="progress-info">
				{#if download.indeterminate && download.stepStartedAt}
					<span>{download.processingStep || 'Processing...'} · {formatElapsed(elapsedTime)}</span>
				{:else if download.indeterminate}
					<span>{download.processingStep || 'Processing...'}</span>
				{:else if download.processingStep && download.processingStep.includes('%')}
					<!-- processingStep already has percent embedded (e.g. "Merging (45% · 2MB/s)") -->
					<span>{download.processingStep}</span>
				{:else}
					<!-- processingStep has no percent, show progress separately -->
					<span>{download.processingStep || 'Processing...'} {progressPercent}%</span>
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

		{#if download.status === 'DELETED'}
			<div class="deleted-info">Watched by all users — file removed</div>
		{/if}

		<div class="actions">
			{#if download.status === 'DOWNLOADING' || download.status === 'PENDING' || download.status === 'FETCHING_INFO' || download.status === 'PROCESSING'}
				<button
					class="btn btn-sm btn-danger"
					onclick={cancelDownload}
					title="Cancel download"
					aria-label="Cancel download"
				>
					<XIcon width={14} height={14} />
					Cancel
				</button>
			{/if}

			{#if download.status === 'COMPLETED'}
				<DownloadVersionPicker
					downloadId={download.id}
					label="Download"
					className="btn btn-sm btn-primary"
					direction="down"
					onSingle={downloadFile}
				/>
				<AddToPlaylistMenu downloadId={download.id} storagePool={download.storagePool} />
				{#if download.storagePool === 'cache' && libraryConfigured}
					<button
						class="btn btn-sm btn-accent"
						onclick={promoteToLibrary}
						disabled={promoting}
						title="Save to library"
						aria-label="Save to library"
					>
						<FolderDownIcon width={14} height={14} />
						{promoting ? 'Saving...' : 'Save to Library'}
					</button>
				{/if}
				{#if download.storagePool === 'library' && jellyfinUrl}
					<a
						class="btn btn-sm btn-secondary"
						href="{jellyfinUrl}/web/#/search.html?query={encodeURIComponent(jellyfinQuery)}"
						target="_blank"
						rel="noopener"
						title="Open in Jellyfin"
						aria-label="Open in Jellyfin"
					>
						<ExternalLinkIcon width={14} height={14} />
						Open in Jellyfin
					</a>
				{/if}
			{/if}

			{#if download.status === 'DELETED'}
				<button
					class="btn btn-sm btn-primary"
					onclick={redownload}
					disabled={redownloading}
					title="Redownload"
					aria-label="Redownload"
				>
					<DownloadIcon width={14} height={14} />
					{redownloading ? 'Redownloading...' : 'Redownload'}
				</button>
			{/if}

			{#if download.status === 'FAILED' || download.status === 'CANCELLED'}
				<button
					class="btn btn-sm btn-primary"
					onclick={retryDownload}
					title="Retry download"
					aria-label="Retry download"
				>
					<RefreshIcon width={14} height={14} />
					Retry
				</button>
			{/if}

			{#if download.status === 'COMPLETED' || download.status === 'FAILED' || download.status === 'CANCELLED' || download.status === 'DELETED'}
				<button
					class="btn btn-sm btn-secondary"
					onclick={deleteDownload}
					title="Delete download"
					aria-label="Delete download"
				>
					<TrashIcon width={14} height={14} />
					Delete
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.download-card {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		overflow: hidden;
		transition:
			transform var(--transition-normal),
			box-shadow var(--transition-normal),
			border-color var(--transition-normal);
		flex-shrink: 0;
		position: relative;
		display: flex;
		flex-direction: column;
	}

	.download-card:hover {
		border-color: var(--color-border-translucent-hover);
		transform: translateY(-3px);
		box-shadow:
			var(--shadow-lg),
			0 0 0 1px rgba(59, 130, 246, 0.05);
	}

	@media (prefers-reduced-motion: reduce) {
		.download-card,
		.download-card:hover {
			transform: none;
			transition: border-color var(--transition-fast);
		}
	}

	.download-card.clickable,
	.download-card.selecting {
		cursor: pointer;
	}

	.download-card.clickable:hover h3 {
		color: var(--color-accent-primary);
	}

	.play-overlay {
		position: absolute;
		inset: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.3);
		opacity: 0;
		transition: opacity var(--transition-snappy);
		pointer-events: none;
	}

	.download-card.clickable:hover .play-overlay {
		opacity: 1;
	}

	.play-overlay svg {
		filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.4));
	}

	.download-card.selected {
		border-color: var(--color-accent-primary);
		box-shadow: 0 0 0 1px var(--color-accent-primary);
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
		transition: all var(--transition-fast);
	}

	.select-overlay:focus-visible {
		outline: none;
	}

	.select-overlay:focus-visible .select-checkbox {
		border-color: var(--color-accent-primary);
		box-shadow: 0 0 0 3px var(--color-focus-ring);
	}

	.select-checkbox.checked {
		background: var(--color-accent-primary);
		border-color: var(--color-accent-primary);
		color: var(--color-text-on-accent);
	}

	.thumbnail {
		width: 100%;
		height: 180px;
		background-color: var(--color-bg-tertiary);
		position: relative;
		overflow: hidden;
	}

	.thumbnail-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		position: relative;
		z-index: 0;
	}

	.video-preview {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		z-index: 1;
	}

	.video-time {
		position: absolute;
		bottom: 12px;
		left: 8px;
		z-index: 4;
		background: rgba(0, 0, 0, 0.55);
		backdrop-filter: blur(4px);
		border-radius: var(--radius-sm);
		padding: 2px 6px;
		color: white;
		font-size: var(--font-size-2xs);
		font-family: var(--font-family-mono);
		line-height: 1;
		pointer-events: none;
	}

	.mute-btn {
		position: absolute;
		bottom: 12px;
		right: 8px;
		z-index: 4;
		background: rgba(0, 0, 0, 0.55);
		backdrop-filter: blur(4px);
		border: none;
		border-radius: 50%;
		width: 32px;
		height: 32px;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		opacity: 0.8;
		transition:
			opacity var(--transition-fast),
			background var(--transition-fast);
	}

	.mute-btn:hover {
		opacity: 1;
		background: rgba(0, 0, 0, 0.75);
	}

	.video-progress-bar {
		position: absolute;
		bottom: 0;
		left: 0;
		width: 100%;
		height: 8px;
		background: var(--color-overlay-white-30);
		z-index: 3;
		cursor: pointer;
		transition: height var(--transition-fast);
	}

	/* Invisible grab zone extending above the visible bar so it's easy to drag */
	.video-progress-bar::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		top: -16px;
	}

	.video-progress-bar:hover,
	.video-progress-bar.dragging {
		height: 12px;
	}

	.progress-fill {
		height: 100%;
		background: var(--color-player-progress);
		transition: width 0.1s linear;
	}

	.deleted-info {
		background: var(--color-overlay-white-05);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		padding: var(--spacing-sm);
		color: var(--color-text-secondary);
		font-size: var(--font-size-xs);
		margin-bottom: var(--spacing-md);
		text-align: center;
	}

	.download-card:has(.deleted-info) {
		opacity: 0.6;
	}

	.download-card:has(.deleted-info):hover {
		opacity: 0.8;
	}

	.content {
		padding: var(--spacing-lg);
		flex: 1;
		display: flex;
		flex-direction: column;
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
		transition: color var(--transition-fast);
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
		background: var(--color-status-info-bg);
		color: var(--color-accent-primary);
		font-family: var(--font-family-mono);
	}

	.pool-badge {
		font-size: 0.625rem;
		font-weight: 600;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		background: var(--color-bg-tertiary);
		color: var(--color-text-tertiary);
	}

	.pool-badge.library {
		background: var(--color-status-success-bg);
		color: var(--color-status-success);
	}

	.copy-url-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		color: var(--color-text-tertiary);
		cursor: pointer;
		padding: 2px;
		border-radius: var(--radius-sm);
		transition: all var(--transition-fast);
		opacity: 0;
	}

	.download-card:hover .copy-url-btn {
		opacity: 1;
	}

	.copy-url-btn:hover {
		color: var(--color-accent-primary);
		background: var(--color-bg-tertiary);
	}

	.copy-url-btn.copied {
		color: var(--color-status-success);
		opacity: 1;
	}

	.status-icon {
		display: flex;
		align-items: center;
		line-height: 0;
	}

	.status-icon :global(.spin) {
		animation: spin 1.5s linear infinite;
	}

	.uploader-text {
		color: var(--color-text-secondary);
		font-size: var(--font-size-sm);
		margin-bottom: var(--spacing-sm);
		display: block;
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
		background: var(--color-overlay-white-06);
		color: var(--color-text-secondary);
		font-family: var(--font-family-mono);
		letter-spacing: 0.02em;
	}

	.progress {
		margin-bottom: var(--spacing-sm);
		height: 4px;
		background: var(--color-bg-tertiary);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.progress-bar {
		height: 100%;
		background: var(--color-accent-primary);
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
		background: linear-gradient(90deg, transparent, var(--color-overlay-white-30), transparent);
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
			var(--color-bg-tertiary) 0%,
			var(--color-accent-primary) 25%,
			var(--color-accent-primary) 75%,
			var(--color-bg-tertiary) 100%
		);
		background-size: 200% 100%;
		animation: indeterminate 1.5s ease-in-out infinite;
	}

	.progress-bar.indeterminate::after {
		display: none;
	}

	.progress-bar.processing {
		background: var(--color-status-warning);
	}

	.progress-bar.indeterminate.processing {
		background: linear-gradient(
			90deg,
			var(--color-bg-tertiary) 0%,
			var(--color-status-warning) 25%,
			var(--color-status-warning) 75%,
			var(--color-bg-tertiary) 100%
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
		color: var(--color-text-secondary);
		margin-bottom: var(--spacing-md);
	}

	.error {
		background: var(--color-status-error-bg);
		border: 1px solid var(--color-status-error);
		border-radius: var(--radius-md);
		padding: var(--spacing-sm);
		color: var(--color-status-error);
		font-size: 0.75rem;
		margin-bottom: var(--spacing-md);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-sm);
		margin-top: auto;
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

		.actions button {
			flex: 1;
			min-width: 0;
		}
	}
</style>
