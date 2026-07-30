<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { showConfirm } from '$lib/stores/modal.svelte';
	import { addToast } from '$lib/stores/toast.svelte';
	import { csrfFetch } from '$lib/utils/fetch';
	import { onSSEEvent } from '$lib/stores/sse.svelte';
	import { formatBytes, formatDuration } from '$lib/utils/format';
	import VideoPlayer from '$lib/components/player/VideoPlayer.svelte';
	import DownloadVersionPicker from '$lib/components/download/DownloadVersionPicker.svelte';
	import TagEditor from '$lib/components/ui/TagEditor.svelte';
	import FolderDownIcon from '$lib/components/icons/FolderDownIcon.svelte';
	import ExternalLinkIcon from '$lib/components/icons/ExternalLinkIcon.svelte';
	import RefreshIcon from '$lib/components/icons/RefreshIcon.svelte';
	import TrashIcon from '$lib/components/icons/TrashIcon.svelte';
	import AddToPlaylistMenu from '$lib/components/playlist/AddToPlaylistMenu.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let download = $state(data.download);
	let tasks = $state<any[]>(data.downloadTasks ?? []);
	let deleting = $state(false);
	let promoting = $state(false);
	let refreshing = $state(false);
	let downloadPickerOpen = $state(false);

	const TASK_LABELS: Record<string, string> = {
		download: 'Download',
		merge: 'Merge Formats',
		metadata: 'Embed Metadata',
		thumbnail: 'Embed Thumbnail',
		subtitle: 'Embed Subtitles',
		sponsorblock: 'SponsorBlock',
		convert: 'Convert',
	};

	const TASK_ICONS: Record<string, string> = {
		download: 'M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2',
		merge: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
		metadata:
			'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
		thumbnail:
			'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
		subtitle:
			'M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z',
		sponsorblock: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
		convert:
			'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
	};

	let showTasks = $derived(
		tasks.length > 0 &&
			['DOWNLOADING', 'PROCESSING', 'COMPLETED', 'FAILED'].includes(download.status),
	);

	// Listen for SSE task updates
	$effect(() => {
		const unsub1 = onSSEEvent('download:tasks', (eventData: any) => {
			if (eventData.id === download.id) {
				tasks = eventData.tasks;
			}
		});
		const unsub2 = onSSEEvent('download:task', (eventData: any) => {
			if (eventData.id === download.id) {
				const idx = tasks.findIndex((t: any) => t.id === eventData.task.id);
				if (idx >= 0) {
					tasks[idx] = eventData.task;
					tasks = [...tasks];
				} else {
					tasks = [...tasks, eventData.task];
				}
			}
		});

		// Keep the download record itself live (title, metadata, status, progress)
		// so a record opened before metadata is fetched populates without a reload.
		const patch = (eventData: any) => {
			if (eventData.id === download.id) {
				download = { ...download, ...eventData };
			}
		};
		const unsub3 = onSSEEvent('download:metadata', patch);
		const unsub4 = onSSEEvent('download:status', patch);
		const unsub5 = onSSEEvent('download:progress', patch);
		const unsub6 = onSSEEvent('download:complete', (eventData: any) => {
			if (eventData.id === download.id && eventData.download) {
				download = { ...download, ...eventData.download };
			}
		});
		const unsub7 = onSSEEvent('download:failed', (eventData: any) => {
			if (eventData.id === download.id) {
				download = { ...download, status: 'FAILED', error: eventData.error };
			}
		});
		const unsub8 = onSSEEvent('download:cancelled', (eventData: any) => {
			if (eventData.id === download.id) {
				download = { ...download, status: 'CANCELLED' };
			}
		});

		return () => {
			unsub1();
			unsub2();
			unsub3();
			unsub4();
			unsub5();
			unsub6();
			unsub7();
			unsub8();
		};
	});

	// Playlist autoplay
	let autoplay = $state(false);
	onMount(() => {
		autoplay = localStorage.getItem('playlist-autoplay') === 'true';
	});

	function handleVideoEnded() {
		if (!autoplay || !data.playlistContext?.nextDownloadId) return;
		goto(
			`/downloads/${data.playlistContext.nextDownloadId}?playlist=${data.playlistContext.playlistId}`,
		);
	}

	function toggleAutoplay() {
		autoplay = !autoplay;
		localStorage.setItem('playlist-autoplay', String(autoplay));
	}

	// -- Watch progress saving --
	let watchProgressTimer: ReturnType<typeof setInterval> | undefined;
	let lastSavedPosition = $state(0);

	$effect(() => {
		// Only set up for completed video downloads
		if (!isVideo || download.status !== 'COMPLETED') return;

		watchProgressTimer = setInterval(() => {
			const videoEl = document.querySelector('.video-player-wrapper video') as HTMLVideoElement;
			if (!videoEl || videoEl.paused || !videoEl.duration) return;

			const position = videoEl.currentTime;
			const dur = videoEl.duration;

			// Only save if position changed by at least 2 seconds
			if (Math.abs(position - lastSavedPosition) < 2) return;
			lastSavedPosition = position;

			csrfFetch(`/api/watch-progress/${download.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ position, duration: dur }),
			}).catch(() => {
				// Fail silently
			});
		}, 10000);

		return () => {
			if (watchProgressTimer) clearInterval(watchProgressTimer);
		};
	});

	function formatDate(date: string | Date | null): string {
		if (!date) return 'Unknown';
		return new Date(date).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
		});
	}

	function formatDateTime(date: string | Date | null): string {
		if (!date) return 'Unknown';
		return new Date(date).toLocaleString();
	}

	async function handleDelete() {
		const confirmed = await showConfirm(
			'Delete Download',
			`Delete "${download.title || 'this download'}"? This cannot be undone.`,
			'Delete',
		);
		if (!confirmed) return;

		deleting = true;
		try {
			const res = await csrfFetch(`/api/downloads/${download.id}`, { method: 'DELETE' });
			if (res.ok) {
				addToast('success', 'Download deleted');
				goto('/downloads');
			} else {
				addToast('error', 'Failed to delete download');
			}
		} catch {
			addToast('error', 'Failed to delete download');
		} finally {
			deleting = false;
		}
	}

	let libraryRequestStatus = $state<string | null>(data.libraryRequestStatus ?? null);

	async function handlePromote() {
		promoting = true;
		try {
			const res = await csrfFetch(`/api/downloads/${download.id}/promote`, { method: 'POST' });
			if (res.ok) {
				const body = await res.json().catch(() => ({}));
				if (body?.requested) {
					libraryRequestStatus = 'pending';
					addToast('success', 'Library save requested — awaiting admin approval');
				} else {
					download = { ...download, storagePool: 'library' };
					addToast('success', 'Moved to library');
				}
			} else {
				const err = await res.json().catch(() => null);
				addToast('error', err?.message || 'Failed to move to library');
			}
		} catch {
			addToast('error', 'Failed to move to library');
		} finally {
			promoting = false;
		}
	}

	async function handleRefreshMetadata() {
		refreshing = true;
		try {
			const res = await csrfFetch(`/api/downloads/${download.id}/refresh`, { method: 'POST' });
			if (res.ok) {
				const updated = await res.json();
				download = { ...download, ...updated };
				addToast('success', 'Metadata refreshed');
			} else {
				const err = await res.json().catch(() => null);
				addToast('error', err?.message || 'Failed to refresh metadata');
			}
		} catch {
			addToast('error', 'Failed to refresh metadata');
		} finally {
			refreshing = false;
		}
	}

	function openInJellyfin() {
		if (data.jellyfinUrl) {
			window.open(
				`${data.jellyfinUrl}/web/index.html#!/search.html?query=${encodeURIComponent(download.title || '')}`,
				'_blank',
			);
		}
	}

	// Use ?t= query param for subtitle timestamp linking, fallback to watch progress
	let urlStartTime = $derived(() => {
		const t = $page.url.searchParams.get('t');
		return t ? parseFloat(t) : null;
	});

	let isVideo = $derived(download.filepath?.match(/\.(mp4|webm|mkv)$/i) !== null);

	let isAudio = $derived(download.filepath?.match(/\.(mp3|m4a|aac|flac|opus|ogg|wav)$/i) !== null);

	// Metadata is fetched in phase 1 (PENDING -> FETCHING_INFO). If the record was
	// opened before that completed, title/uploader/etc. are still null. Show a
	// loading treatment that the SSE handlers above will resolve in place.
	let metadataPending = $derived(
		!download.title && ['PENDING', 'FETCHING_INFO', 'DOWNLOADING'].includes(download.status),
	);

	let urlCopied = $state(false);
	async function copySourceUrl() {
		await navigator.clipboard.writeText(download.url);
		urlCopied = true;
		setTimeout(() => (urlCopied = false), 1500);
	}
</script>

<svelte:head>
	<title>{download.title || 'Download'} - wytui</title>
</svelte:head>

<div class="detail-page">
	{#if data.playlistContext}
		<div class="playlist-nav-bar">
			<a href="/playlists/{data.playlistContext.playlistId}" class="back-link">
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
					<path
						d="M10 3L5 8L10 13"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
				{data.playlistContext.playlistName}
			</a>
			<div class="playlist-nav-controls">
				{#if data.playlistContext.prevDownloadId}
					<a
						href="/downloads/{data.playlistContext.prevDownloadId}?playlist={data.playlistContext
							.playlistId}"
						class="btn btn-sm btn-secondary"
					>
						← Prev
					</a>
				{/if}
				<span class="playlist-position"
					>{data.playlistContext.currentPosition} / {data.playlistContext.totalItems}</span
				>
				{#if data.playlistContext.nextDownloadId}
					<a
						href="/downloads/{data.playlistContext.nextDownloadId}?playlist={data.playlistContext
							.playlistId}"
						class="btn btn-sm btn-secondary"
					>
						Next →
					</a>
				{/if}
				<button
					class="btn btn-sm"
					class:btn-secondary={!autoplay}
					class:btn-primary={autoplay}
					onclick={toggleAutoplay}
					title={autoplay ? 'Autoplay on' : 'Autoplay off'}
				>
					Autoplay {autoplay ? 'On' : 'Off'}
				</button>
			</div>
		</div>
	{:else}
		<a href="/downloads" class="back-link">
			<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
				<path
					d="M10 3L5 8L10 13"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
			Back to Downloads
		</a>
	{/if}

	<div class="detail-layout">
		<!-- Player / Thumbnail Area -->
		<div class="media-area">
			{#if isVideo && download.status === 'COMPLETED'}
				<VideoPlayer
					src="/api/files/{download.id}"
					poster={download.thumbnail || undefined}
					videoId={download.videoId || undefined}
					downloadId={download.id}
					startTime={data.startTimeParam ?? download.watchProgress?.position ?? 0}
					onEnded={handleVideoEnded}
					onDownload={() => (downloadPickerOpen = true)}
				/>
			{:else if isAudio && download.status === 'COMPLETED'}
				<div class="audio-area">
					{#if download.thumbnail}
						<img src={download.thumbnail} alt={download.title || 'Cover art'} class="audio-cover" />
					{/if}
					<!-- svelte-ignore a11y_media_has_caption -->
					<audio controls preload="metadata" class="audio-player">
						<source src="/api/files/{download.id}" />
					</audio>
				</div>
			{:else if download.thumbnail}
				<img src={download.thumbnail} alt={download.title || 'Thumbnail'} class="thumbnail" />
			{:else if metadataPending}
				<div class="skeleton thumbnail-skeleton" aria-hidden="true"></div>
			{:else}
				<div class="no-thumbnail">
					<svg
						width="48"
						height="48"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
					>
						<rect x="2" y="2" width="20" height="20" rx="2" />
						<path d="M10 9l5 3-5 3V9z" fill="currentColor" stroke="none" />
					</svg>
				</div>
			{/if}
		</div>

		<!-- Metadata -->
		<div class="meta-area">
			{#if metadataPending}
				<div class="meta-loading" aria-busy="true" aria-label="Fetching video details">
					<div class="skeleton skeleton-line skeleton-title-line"></div>
					<div class="skeleton skeleton-line skeleton-uploader-line"></div>
					<div class="fetching-indicator" role="status">
						<span class="fetching-spinner" aria-hidden="true"></span>
						<span>Fetching details…</span>
					</div>
				</div>
			{:else}
				<h1 class="title">{download.title || 'Untitled'}</h1>

				{#if download.uploader}
					<a href="/channels/{encodeURIComponent(download.uploader)}" class="uploader-link"
						>{download.uploader}</a
					>
				{/if}
			{/if}

			<div class="badges">
				<span
					class="badge"
					class:badge-library={download.storagePool === 'library'}
					class:badge-cache={download.storagePool === 'cache'}
				>
					{download.storagePool === 'library' ? 'Library' : 'Cache'}
				</span>
				{#if download.videoType}
					<span class="badge badge-type">{download.videoType}</span>
				{/if}
				{#if download.profile}
					<span class="badge badge-profile">{download.profile.name}</span>
				{/if}
			</div>

			<div class="meta-grid">
				{#if download.duration}
					<div class="meta-item">
						<span class="meta-label">Duration</span>
						<span class="meta-value">{formatDuration(download.duration)}</span>
					</div>
				{/if}
				{#if download.filesize}
					<div class="meta-item">
						<span class="meta-label">File Size</span>
						<span class="meta-value">{formatBytes(download.filesize)}</span>
					</div>
				{/if}
				{#if download.format}
					<div class="meta-item">
						<span class="meta-label">Format</span>
						<span class="meta-value">{download.format}</span>
					</div>
				{/if}
				{#if download.uploadDate}
					<div class="meta-item">
						<span class="meta-label">Released</span>
						<span class="meta-value">{formatDate(download.uploadDate)}</span>
					</div>
				{/if}
				{#if download.completedAt}
					<div class="meta-item">
						<span class="meta-label">Downloaded</span>
						<span class="meta-value">{formatDateTime(download.completedAt)}</span>
					</div>
				{/if}
				{#if download.dislikeCount !== null && download.dislikeCount !== undefined}
					<div class="meta-item">
						<span class="meta-label">Dislikes</span>
						<span class="meta-value">{download.dislikeCount.toLocaleString()}</span>
					</div>
				{/if}
			</div>

			{#if download.description}
				<details class="description-section">
					<summary>Description</summary>
					<p class="description-text">{download.description}</p>
				</details>
			{/if}

			<div class="tags-section">
				<span class="meta-label">Tags</span>
				<TagEditor
					tags={download.tags || []}
					onUpdate={async (newTags) => {
						try {
							const res = await csrfFetch(`/api/downloads/${download.id}`, {
								method: 'PATCH',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({ tags: newTags }),
							});
							if (res.ok) {
								download = { ...download, tags: newTags };
							}
						} catch {}
					}}
				/>
			</div>

			{#if download.artist || download.album}
				<div class="music-meta">
					<h3>Music Info</h3>
					<div class="meta-grid">
						{#if download.artist}
							<div class="meta-item">
								<span class="meta-label">Artist</span>
								<span class="meta-value">{download.artist}</span>
							</div>
						{/if}
						{#if download.album}
							<div class="meta-item">
								<span class="meta-label">Album</span>
								<span class="meta-value">{download.album}</span>
							</div>
						{/if}
						{#if download.trackNumber}
							<div class="meta-item">
								<span class="meta-label">Track</span>
								<span class="meta-value">#{download.trackNumber}</span>
							</div>
						{/if}
						{#if download.releaseYear}
							<div class="meta-item">
								<span class="meta-label">Year</span>
								<span class="meta-value">{download.releaseYear}</span>
							</div>
						{/if}
					</div>
				</div>
			{/if}

			<div class="actions">
				{#if download.status === 'COMPLETED'}
					<DownloadVersionPicker
						downloadId={download.id}
						label="Download File"
						className="btn btn-primary"
						bind:open={downloadPickerOpen}
					/>
					{#if download.storagePool === 'cache'}
						{#if libraryRequestStatus === 'pending'}
							<button class="btn btn-secondary" disabled title="Library save requested">
								<FolderDownIcon />
								Library Save Requested
							</button>
						{:else if data.libraryAction === 'save'}
							<button
								class="btn btn-accent"
								onclick={handlePromote}
								disabled={promoting}
								title="Save to library"
								aria-label="Save to library"
							>
								<FolderDownIcon />
								{promoting ? 'Moving...' : 'Save to Library'}
							</button>
						{:else if data.libraryAction === 'request'}
							<button
								class="btn btn-accent"
								onclick={handlePromote}
								disabled={promoting}
								title="Request to save to library"
								aria-label="Request to save to library"
							>
								<FolderDownIcon />
								{promoting ? 'Requesting...' : 'Request Library Save'}
							</button>
						{/if}
					{/if}
					<AddToPlaylistMenu downloadId={download.id} storagePool={download.storagePool} />
					{#if data.jellyfinUrl}
						<button
							class="btn btn-secondary"
							onclick={openInJellyfin}
							title="Open in Jellyfin"
							aria-label="Open in Jellyfin"
						>
							<ExternalLinkIcon />
							Open in Jellyfin
						</button>
					{/if}
				{/if}
				<button
					class="btn btn-secondary"
					onclick={handleRefreshMetadata}
					disabled={refreshing}
					title="Refresh metadata"
					aria-label="Refresh metadata"
				>
					<RefreshIcon />
					{refreshing ? 'Refreshing...' : 'Refresh Metadata'}
				</button>
				<button
					class="btn btn-danger"
					onclick={handleDelete}
					disabled={deleting}
					title="Delete download"
					aria-label="Delete download"
				>
					<TrashIcon />
					{deleting ? 'Deleting...' : 'Delete'}
				</button>
			</div>

			<div class="source-url">
				<span class="meta-label">Source</span>
				<div class="url-row">
					<a href={download.url} target="_blank" rel="noopener noreferrer" class="url-link"
						>{download.url}</a
					>
					<button
						class="copy-url-btn"
						class:copied={urlCopied}
						onclick={copySourceUrl}
						title={urlCopied ? 'Copied!' : 'Copy source URL'}
					>
						{#if urlCopied}
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
				</div>
			</div>
		</div>
	</div>

	{#if showTasks}
		<div class="tasks-section">
			<h3 class="tasks-heading">Processing Steps</h3>
			<div class="task-timeline">
				{#each tasks as task (task.id)}
					<div
						class="task-step"
						class:task-pending={task.status === 'pending'}
						class:task-in-progress={task.status === 'in_progress'}
						class:task-completed={task.status === 'completed'}
						class:task-failed={task.status === 'failed'}
						class:task-skipped={task.status === 'skipped'}
					>
						<div class="task-indicator">
							{#if task.status === 'completed'}
								<svg
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2.5"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<polyline points="20 6 9 17 4 12" />
								</svg>
							{:else if task.status === 'failed'}
								<svg
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2.5"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
								</svg>
							{:else if task.status === 'in_progress'}
								<div class="task-spinner"></div>
							{:else if task.status === 'skipped'}
								<svg
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<line x1="5" y1="12" x2="19" y2="12" />
								</svg>
							{:else}
								<div class="task-dot"></div>
							{/if}
						</div>
						<div class="task-content">
							<div class="task-header">
								<div class="task-icon">
									<svg
										width="14"
										height="14"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<path d={TASK_ICONS[task.type] || TASK_ICONS.convert} />
									</svg>
								</div>
								<span class="task-type">{TASK_LABELS[task.type] || task.type}</span>
								<span class="task-status-badge task-status-{task.status}"
									>{task.status.replace('_', ' ')}</span
								>
							</div>
							{#if task.status === 'in_progress' && task.progress != null}
								<div class="task-progress-bar">
									<div
										class="task-progress-fill"
										style="width: {Math.min(100, task.progress)}%"
									></div>
								</div>
							{/if}
							{#if task.message}
								<p class="task-message">{task.message}</p>
							{/if}
							{#if task.startedAt && task.completedAt}
								<p class="task-timing">
									{Math.round(
										(new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()) /
											1000,
									)}s
								</p>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	{#if data.similar && data.similar.length > 0}
		<div class="similar-section">
			<h3 class="similar-heading">
				More from <a
					href="/channels/{encodeURIComponent(download.uploader ?? '')}"
					class="similar-channel-link">{download.uploader}</a
				>
			</h3>
			<div class="similar-grid">
				{#each data.similar as item}
					<a href="/downloads/{item.id}" class="similar-card">
						{#if item.thumbnail}
							<img src={item.thumbnail} alt={item.title || ''} class="similar-thumb" />
						{:else}
							<div class="similar-thumb placeholder-thumb"></div>
						{/if}
						<div class="similar-info">
							<p class="similar-title">{item.title || 'Untitled'}</p>
							{#if item.duration}
								<span class="similar-duration">{formatDuration(item.duration)}</span>
							{/if}
						</div>
					</a>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.detail-page {
		max-width: 1200px;
		margin: 0 auto;
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		color: var(--color-text-secondary);
		text-decoration: none;
		font-size: 0.875rem;
		margin-bottom: var(--spacing-xl);
		transition: color var(--transition-fast);
	}

	.back-link:hover {
		color: var(--color-text-primary);
	}

	.playlist-nav-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-xl);
		flex-wrap: wrap;
	}

	.playlist-nav-bar .back-link {
		margin-bottom: 0;
	}

	.playlist-nav-controls {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.playlist-position {
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		white-space: nowrap;
	}

	.detail-layout {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xl);
	}

	.media-area {
		width: 100%;
		border-radius: var(--radius-lg);
		overflow: hidden;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
	}

	.audio-area {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: var(--spacing-xl);
		gap: var(--spacing-lg);
	}

	.audio-cover {
		width: 200px;
		height: 200px;
		border-radius: var(--radius-lg);
		object-fit: cover;
	}

	.audio-player {
		width: 100%;
		max-width: 500px;
	}

	.thumbnail {
		width: 100%;
		display: block;
		object-fit: cover;
	}

	.no-thumbnail {
		width: 100%;
		height: 300px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-tertiary);
	}

	.meta-area {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-lg);
	}

	.title {
		font-size: 1.5rem;
		font-weight: 700;
		line-height: 1.3;
	}

	.uploader-link {
		font-size: 1rem;
		color: var(--color-text-secondary);
		margin-top: calc(-1 * var(--spacing-sm));
		text-decoration: none;
		transition: color var(--transition-fast);
	}

	.uploader-link:hover {
		color: var(--color-accent-primary);
	}

	/* Loading treatment while phase-1 metadata is still being fetched */
	.thumbnail-skeleton {
		width: 100%;
		height: 300px;
		border-radius: 0;
	}

	.meta-loading {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.skeleton-line {
		border-radius: var(--radius-sm);
	}

	.skeleton-title-line {
		height: 1.5rem;
		width: 70%;
		max-width: 480px;
	}

	.skeleton-uploader-line {
		height: 1rem;
		width: 35%;
		max-width: 240px;
	}

	.fetching-indicator {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-sm);
		margin-top: var(--spacing-xs);
		font-size: 0.8125rem;
		color: var(--color-text-tertiary);
	}

	.fetching-spinner {
		width: 12px;
		height: 12px;
		border: 2px solid transparent;
		border-top-color: var(--color-accent-primary);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@media (prefers-reduced-motion: reduce) {
		.fetching-spinner {
			animation: none;
		}
	}

	.badges {
		display: flex;
		gap: var(--spacing-sm);
		flex-wrap: wrap;
	}

	.badge {
		padding: var(--spacing-xs) var(--spacing-sm);
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		font-weight: 600;
		background: var(--color-bg-tertiary);
		color: var(--color-text-secondary);
	}

	.badge-library {
		background: rgba(16, 185, 129, 0.15);
		color: var(--color-status-success);
	}

	.badge-cache {
		background: rgba(59, 130, 246, 0.15);
		color: var(--color-accent-primary);
	}

	.badge-type {
		text-transform: capitalize;
	}

	.badge-profile {
		background: rgba(139, 92, 246, 0.15);
		color: #a78bfa;
	}

	.meta-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		gap: var(--spacing-md);
	}

	.meta-item {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.meta-label {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-tertiary);
	}

	.meta-value {
		font-size: 0.9375rem;
		color: var(--color-text-primary);
	}

	.description-section {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
	}

	.description-section summary {
		cursor: pointer;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text-secondary);
	}

	.description-text {
		margin-top: var(--spacing-md);
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		line-height: 1.6;
		white-space: pre-wrap;
		max-height: 300px;
		overflow-y: auto;
	}

	.tags-section {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.tag-list {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-xs);
	}

	.tag {
		padding: var(--spacing-xs) var(--spacing-sm);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.music-meta {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		padding: var(--spacing-lg);
	}

	.music-meta h3 {
		font-size: 0.875rem;
		margin-bottom: var(--spacing-md);
		color: var(--color-text-secondary);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-sm);
		padding-top: var(--spacing-md);
		border-top: 1px solid var(--color-border-default);
	}

	.actions .btn {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.source-url {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.url-row {
		display: flex;
		align-items: flex-start;
		gap: var(--spacing-xs);
	}

	.url-link {
		font-size: 0.8125rem;
		color: var(--color-accent-primary);
		text-decoration: none;
		word-break: break-all;
	}

	.url-link:hover {
		text-decoration: underline;
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
		flex-shrink: 0;
		margin-top: 1px;
	}

	.copy-url-btn:hover {
		color: var(--color-accent-primary);
		background: var(--color-bg-tertiary);
	}

	.copy-url-btn.copied {
		color: var(--color-status-success);
	}

	.similar-section {
		margin-top: var(--spacing-2xl);
		padding-top: var(--spacing-xl);
		border-top: 1px solid var(--color-border-default);
	}

	.similar-heading {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: var(--spacing-lg);
		color: var(--color-text-secondary);
	}

	.similar-channel-link {
		color: var(--color-text-primary);
		text-decoration: none;
		transition: color var(--transition-fast);
	}

	.similar-channel-link:hover {
		color: var(--color-accent-primary);
	}

	.similar-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: var(--spacing-md);
	}

	.similar-card {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		text-decoration: none;
		color: inherit;
		border-radius: var(--radius-md);
		overflow: hidden;
		transition: opacity var(--transition-fast);
	}

	.similar-card:hover {
		opacity: 0.8;
	}

	.similar-thumb {
		width: 100%;
		aspect-ratio: 16/9;
		object-fit: cover;
		background: var(--color-bg-secondary);
		border-radius: var(--radius-md);
	}

	.similar-info {
		padding: 0 2px;
	}

	.similar-title {
		font-size: 0.875rem;
		font-weight: 500;
		line-height: 1.4;
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		margin-bottom: 2px;
	}

	.similar-duration {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	/* Task timeline */
	.tasks-section {
		margin-top: var(--spacing-xl);
		padding-top: var(--spacing-xl);
		border-top: 1px solid var(--color-border-default);
	}

	.tasks-heading {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: var(--spacing-lg);
		color: var(--color-text-secondary);
	}

	.task-timeline {
		display: flex;
		flex-direction: column;
		gap: 0;
		position: relative;
	}

	.task-step {
		display: flex;
		gap: var(--spacing-md);
		position: relative;
		padding-bottom: var(--spacing-lg);
	}

	.task-step:last-child {
		padding-bottom: 0;
	}

	/* Vertical line connecting steps */
	.task-step:not(:last-child)::after {
		content: '';
		position: absolute;
		left: 11px;
		top: 24px;
		bottom: 0;
		width: 2px;
		background: var(--color-border-default);
	}

	.task-step.task-completed:not(:last-child)::after {
		background: var(--color-status-success);
	}

	.task-step.task-in-progress:not(:last-child)::after {
		background: var(--color-accent-primary);
	}

	.task-indicator {
		flex-shrink: 0;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-bg-tertiary);
		border: 2px solid var(--color-border-default);
		position: relative;
		z-index: 1;
	}

	.task-completed .task-indicator {
		background: rgba(16, 185, 129, 0.15);
		border-color: var(--color-status-success);
		color: var(--color-status-success);
	}

	.task-failed .task-indicator {
		background: rgba(239, 68, 68, 0.15);
		border-color: var(--color-status-error);
		color: var(--color-status-error);
	}

	.task-in-progress .task-indicator {
		background: rgba(59, 130, 246, 0.15);
		border-color: var(--color-accent-primary);
		color: var(--color-accent-primary);
	}

	.task-skipped .task-indicator {
		opacity: 0.5;
		color: var(--color-text-tertiary);
	}

	.task-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-text-tertiary);
	}

	.task-spinner {
		width: 12px;
		height: 12px;
		border: 2px solid transparent;
		border-top-color: var(--color-accent-primary);
		border-radius: 50%;
		animation: task-spin 0.8s linear infinite;
	}

	@keyframes task-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.task-content {
		flex: 1;
		min-width: 0;
		padding-top: 1px;
	}

	.task-header {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.task-icon {
		color: var(--color-text-tertiary);
		display: flex;
		align-items: center;
	}

	.task-type {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text-primary);
	}

	.task-status-badge {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		margin-left: auto;
	}

	.task-status-pending {
		background: var(--color-bg-tertiary);
		color: var(--color-text-tertiary);
	}

	.task-status-in_progress {
		background: rgba(59, 130, 246, 0.15);
		color: var(--color-accent-primary);
	}

	.task-status-completed {
		background: rgba(16, 185, 129, 0.15);
		color: var(--color-status-success);
	}

	.task-status-failed {
		background: rgba(239, 68, 68, 0.15);
		color: var(--color-status-error);
	}

	.task-status-skipped {
		background: var(--color-bg-tertiary);
		color: var(--color-text-tertiary);
	}

	.task-progress-bar {
		margin-top: var(--spacing-xs);
		height: 4px;
		background: var(--color-bg-tertiary);
		border-radius: 2px;
		overflow: hidden;
	}

	.task-progress-fill {
		height: 100%;
		background: var(--color-accent-primary);
		border-radius: 2px;
		transition: width 0.3s ease;
	}

	.task-message {
		margin-top: 2px;
		font-size: 0.75rem;
		color: var(--color-text-tertiary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.task-timing {
		margin-top: 2px;
		font-size: 0.6875rem;
		color: var(--color-text-tertiary);
	}

	@media (max-width: 768px) {
		.title {
			font-size: 1.25rem;
		}
		.meta-grid {
			grid-template-columns: 1fr 1fr;
		}
		.actions {
			flex-direction: column;
		}
		.actions .btn {
			width: 100%;
			justify-content: center;
		}
		.similar-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
