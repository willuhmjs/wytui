<script lang="ts">
	import {
		formatBytes,
		formatDateTime,
		formatDuration,
		formatShortDate,
		getDownloadStatusColor,
		getDownloadStatusLabel,
	} from '$lib/utils/format';
	import { clickOnEnterOrSpace } from '$lib/utils/a11y';

	interface Props {
		download: any;
		onclick: () => void;
		selectionMode?: boolean;
		selected?: boolean;
		onToggleSelect?: () => void;
	}

	let {
		download,
		onclick,
		selectionMode = false,
		selected = false,
		onToggleSelect,
	}: Props = $props();

	let statusColor = $derived(getDownloadStatusColor(download.status));
	let statusLabel = $derived(getDownloadStatusLabel(download.status));
	let thumbnailFailed = $state(false);

	const VIDEO_EXTENSIONS = new Set(['MP4', 'WEBM', 'MKV', 'FLV', 'MOV', 'AVI']);
	let mediaType = $derived(download.filename?.split('.').pop()?.toUpperCase() || null);
	let isVideoCompleted = $derived(
		download.status === 'COMPLETED' && mediaType !== null && VIDEO_EXTENSIONS.has(mediaType),
	);

	let formattedSize = $derived(download.filesize ? formatBytes(download.filesize) : null);
	let formattedDuration = $derived(download.duration ? formatDuration(download.duration) : null);

	// When the file landed in wytui vs. when the video was originally published.
	let downloadedAt = $derived(download.completedAt || download.createdAt);
	let downloadedDate = $derived(formatShortDate(downloadedAt));
	let downloadedExact = $derived(formatDateTime(downloadedAt));
	let releasedDate = $derived(formatShortDate(download.uploadDate));
	function handleRowClick() {
		if (selectionMode) {
			onToggleSelect?.();
			return;
		}
		onclick();
	}
</script>

<div
	class="list-row"
	class:selecting={selectionMode}
	class:selected
	role="button"
	tabindex="0"
	onclick={handleRowClick}
	onkeydown={clickOnEnterOrSpace(handleRowClick)}
>
	{#if selectionMode}
		<button
			class="select-checkbox"
			class:checked={selected}
			aria-label={selected ? 'Deselect download' : 'Select download'}
			onclick={(e) => {
				e.stopPropagation();
				onToggleSelect?.();
			}}
		>
			{#if selected}
				<svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"
					><path
						d="M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2.5-2.5a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z"
					/></svg
				>
			{/if}
		</button>
	{/if}
	<div class="thumbnail">
		{#if download.thumbnail && !thumbnailFailed}
			<img
				src={download.thumbnail}
				alt={download.title || 'Thumbnail'}
				onerror={() => (thumbnailFailed = true)}
			/>
		{:else if isVideoCompleted}
			<video src="/api/files/{download.id}#t=0.001" preload="metadata" muted></video>
		{:else}
			<div class="thumbnail-placeholder"></div>
		{/if}
	</div>

	<div class="title-col">
		<span class="title">{download.title || download.url}</span>
		{#if download.uploader}
			<span class="uploader">{download.uploader}</span>
		{/if}
	</div>

	{#if formattedDuration}
		<span class="meta duration">{formattedDuration}</span>
	{/if}

	<span class="status-badge" style="--status-color: {statusColor}">
		{statusLabel}
	</span>

	{#if formattedSize}
		<span class="meta size">{formattedSize}</span>
	{/if}

	<span class="meta dates">
		{#if releasedDate}
			<span class="date-line" title="Released {releasedDate}">
				<span class="date-tag">Released</span>
				{releasedDate}
			</span>
		{/if}
		{#if downloadedDate}
			<span class="date-line" title="Downloaded {downloadedExact}">
				<span class="date-tag">Downloaded</span>
				{downloadedDate}
			</span>
		{/if}
	</span>
</div>

<style>
	.list-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.list-row:hover {
		border-color: var(--color-border-subtle);
		background: var(--color-bg-hover);
	}

	.list-row.selecting {
		cursor: default;
	}

	.list-row.selected {
		border-color: var(--color-accent-primary);
		background: color-mix(in srgb, var(--color-accent-primary) 8%, transparent);
	}

	.select-checkbox {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		flex-shrink: 0;
		border: 1.5px solid var(--color-border-translucent);
		border-radius: var(--radius-sm);
		background: transparent;
		color: #fff;
		cursor: pointer;
		padding: 0;
	}

	.select-checkbox.checked {
		background: var(--color-accent-primary);
		border-color: var(--color-accent-primary);
	}

	.list-row:focus-visible {
		outline: none;
		border-color: var(--color-accent-primary);
		box-shadow: 0 0 0 3px var(--color-focus-ring);
	}

	.thumbnail {
		width: 80px;
		height: 45px;
		border-radius: var(--radius-sm);
		overflow: hidden;
		flex-shrink: 0;
		background: var(--color-bg-tertiary);
	}

	.thumbnail img,
	.thumbnail video {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.thumbnail-placeholder {
		width: 100%;
		height: 100%;
	}

	.title-col {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.title {
		font-size: var(--font-size-sm);
		font-weight: 500;
		color: var(--color-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.uploader {
		font-size: var(--font-size-xs);
		color: var(--color-text-tertiary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.meta {
		font-size: var(--font-size-xs);
		color: var(--color-text-secondary);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.duration {
		font-family: var(--font-family-mono);
		font-size: var(--font-size-2xs);
	}

	.size {
		font-family: var(--font-family-mono);
		font-size: var(--font-size-2xs);
		min-width: 60px;
		text-align: right;
	}

	.dates {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 1px;
		min-width: 130px;
		font-size: var(--font-size-2xs);
		color: var(--color-text-tertiary);
	}

	.date-line {
		display: flex;
		align-items: baseline;
		gap: var(--spacing-xs);
		white-space: nowrap;
	}

	.date-tag {
		font-size: var(--font-size-2xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		opacity: 0.65;
	}

	.status-badge {
		font-size: var(--font-size-2xs);
		font-weight: 600;
		padding: 2px 8px;
		border-radius: var(--radius-sm);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--status-color);
		background: color-mix(in srgb, var(--status-color) 15%, transparent);
		flex-shrink: 0;
	}

	@media (max-width: 768px) {
		.duration,
		.size,
		.dates {
			display: none;
		}

		.list-row {
			padding: var(--spacing-xs) var(--spacing-sm);
		}

		.thumbnail {
			width: 60px;
			height: 34px;
		}
	}
</style>
