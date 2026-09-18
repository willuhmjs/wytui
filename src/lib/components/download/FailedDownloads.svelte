<script lang="ts">
	import { onMount } from 'svelte';
	import { onSSEEvent, getSSEState } from '$lib/stores/sse.svelte';
	import { showConfirm } from '$lib/stores/modal.svelte';
	import { addToast } from '$lib/stores/toast.svelte';
	import { csrfFetch } from '$lib/utils/fetch';
	import { formatShortDate } from '$lib/utils/format';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import RefreshIcon from '$lib/components/icons/RefreshIcon.svelte';
	import TrashIcon from '$lib/components/icons/TrashIcon.svelte';

	const FAILED_PAGE_SIZE = 50;

	let failedDownloads = $state<any[]>([]);
	let failedLoading = $state(false);
	let loadingMore = $state(false);
	let hasMoreFailed = $state(false);
	let retryingAll = $state(false);
	// Collapsed by default — the slim header bar is the only thing rendered
	// until the user expands it.
	let expanded = $state(false);

	// download:failed fires per video on a failing batch, so several
	// refetches race. Only the newest request's response may be applied —
	// a stale snapshot must never overwrite a fresher one (or resurrect
	// rows the user just removed).
	let loadSeq = 0;
	// Rows the user removed locally (retry/delete). A refetch whose DB query
	// predates the removal would otherwise resurrect them; download:failed
	// clears the id so a genuinely re-failed download reappears.
	const removedIds = new Set<string>();

	let sseState = getSSEState();
	// null until first observed — the store's `connected` flips false→true on
	// the initial connect too, and that one must not stack a second fetch on
	// the mount load. Only a reconnect after a drop triggers the refetch.
	let prevConnected: boolean | null = $state(null);

	function removeRow(id: string) {
		removedIds.add(id);
		failedDownloads = failedDownloads.filter((d) => d.id !== id);
	}

	async function loadFailedDownloads(offset = 0) {
		const seq = ++loadSeq;
		if (offset === 0) failedLoading = true;
		try {
			const params = new URLSearchParams({
				status: 'FAILED',
				limit: String(FAILED_PAGE_SIZE),
				offset: String(offset),
			});
			const res = await fetch(`/api/downloads?${params}`);
			if (seq !== loadSeq) return; // superseded by a newer load
			if (res.ok) {
				const page = (await res.json()) as any[];
				hasMoreFailed = page.length === FAILED_PAGE_SIZE;
				const visible = page.filter((d) => !removedIds.has(d.id));
				failedDownloads = offset === 0 ? visible : [...failedDownloads, ...visible];
			}
		} catch (e) {
			console.error('Failed to load failed downloads:', e);
		} finally {
			if (seq === loadSeq) failedLoading = false;
		}
	}

	async function loadMoreFailed() {
		if (failedLoading || loadingMore || !hasMoreFailed) return;
		loadingMore = true;
		try {
			await loadFailedDownloads(failedDownloads.length);
		} finally {
			loadingMore = false;
		}
	}

	async function retryDownload(download: any) {
		try {
			const res = await csrfFetch(`/api/downloads/${download.id}/retry`, { method: 'POST' });
			// 404: the row is already gone server-side (e.g. the retention
			// prune) — the desired end state is achieved, drop it silently.
			if (res.ok || res.status === 404) {
				removeRow(download.id);
			} else {
				addToast('error', `Failed to retry "${download.title || download.url}"`);
			}
		} catch (e) {
			console.error('Failed to retry:', e);
			addToast('error', `Failed to retry "${download.title || download.url}"`);
		}
	}

	async function deleteDownload(download: any) {
		const confirmed = await showConfirm(
			'Delete Download',
			'Are you sure you want to delete this download?',
			'Delete',
		);
		if (!confirmed) return;

		try {
			const res = await csrfFetch(`/api/downloads/${download.id}`, { method: 'DELETE' });
			if (res.ok || res.status === 404) {
				removeRow(download.id);
			} else {
				addToast('error', 'Failed to delete download');
			}
		} catch (e) {
			console.error('Failed to delete:', e);
			addToast('error', 'Failed to delete download');
		}
	}

	async function retryAll() {
		if (failedDownloads.length === 0 || retryingAll) return;

		// Iterate over a copy: each successful retry drops the row from
		// failedDownloads as it's re-queued.
		retryingAll = true;
		let failures = 0;
		for (const download of [...failedDownloads]) {
			try {
				const res = await csrfFetch(`/api/downloads/${download.id}/retry`, { method: 'POST' });
				if (res.ok || res.status === 404) {
					removeRow(download.id);
				} else {
					failures += 1;
				}
			} catch (e) {
				failures += 1;
				console.error(`Failed to retry ${download.id}:`, e);
			}
		}
		retryingAll = false;

		if (failures > 0) {
			addToast('error', `Failed to retry ${failures} download${failures !== 1 ? 's' : ''}`);
		}
	}

	// The SSE store reconnects silently after a drop — events emitted during
	// the gap are never replayed. Refetch when the connection comes back so
	// failures from the gap appear (and rows that left FAILED during it go).
	$effect(() => {
		const connected = sseState.connected;
		if (prevConnected === false && connected === true) {
			loadFailedDownloads();
		}
		prevConnected = connected;
	});

	onMount(() => {
		loadFailedDownloads();

		// download:failed only carries { id, error }, so refetch the failed
		// list to pick up the full record and show it live. Clearing the id
		// first lets a retried download that failed again reappear.
		const unsubFailed = onSSEEvent('download:failed', ({ id }: any) => {
			removedIds.delete(id);
			loadFailedDownloads();
		});
		// A retried download leaves the failed list as soon as it's re-queued.
		const unsubStatus = onSSEEvent('download:status', ({ id, status }: any) => {
			if (status !== 'FAILED') {
				removeRow(id);
			}
		});
		const unsubDeleted = onSSEEvent('download:deleted', ({ id }: any) => {
			removeRow(id);
		});

		return () => {
			unsubFailed();
			unsubStatus();
			unsubDeleted();
		};
	});
</script>

{#if failedDownloads.length > 0 || failedLoading}
	<section class="failed-section">
		<div class="failed-header">
			<button
				class="failed-toggle"
				onclick={() => (expanded = !expanded)}
				aria-expanded={expanded}
				aria-controls={expanded ? 'failed-downloads-body' : undefined}
			>
				<svg
					class="chevron"
					class:open={expanded}
					width="14"
					height="14"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M4 6l4 4 4-4" />
				</svg>
				<span class="failed-title">
					Failed <span class="failed-count"
						>({failedDownloads.length}{hasMoreFailed ? '+' : ''})</span
					>
				</span>
			</button>
			{#if failedDownloads.length > 0}
				<button
					class="btn btn-sm btn-secondary retry-all-btn"
					onclick={retryAll}
					disabled={retryingAll || failedLoading}
					title="Retry all failed downloads"
				>
					<RefreshIcon width={14} height={14} />
					{retryingAll ? 'Retrying…' : 'Retry All'}
				</button>
			{/if}
		</div>

		{#if expanded}
			<div class="failed-body" id="failed-downloads-body">
				{#if failedLoading && failedDownloads.length === 0}
					<Skeleton count={3} variant="table-row" columns={4} />
				{:else}
					<table class="failed-table">
						<colgroup>
							<col class="col-title" />
							<col class="col-error" />
							<col class="col-date" />
							<col class="col-actions" />
						</colgroup>
						<thead>
							<tr>
								<th class="col-title">Title</th>
								<th class="col-error">Error</th>
								<th class="col-date">Failed at</th>
								<th class="col-actions"><span class="visually-hidden">Actions</span></th>
							</tr>
						</thead>
						<tbody>
							{#each failedDownloads as download (download.id)}
								<tr>
									<td class="col-title">
										<span class="cell-text" title={download.title || download.url}>
											{download.title || download.url}
										</span>
									</td>
									<td class="col-error">
										<span class="cell-text error-text" title={download.error || ''}>
											{download.error || '—'}
										</span>
									</td>
									<td class="col-date">
										<span class="date-text">{formatShortDate(download.updatedAt)}</span>
									</td>
									<td class="col-actions">
										<div class="row-actions">
											<button
												class="btn btn-sm btn-primary"
												onclick={() => retryDownload(download)}
												disabled={retryingAll}
												title="Retry download"
												aria-label="Retry {download.title || download.url}"
											>
												<RefreshIcon width={12} height={12} />
												<span class="btn-label">Retry</span>
											</button>
											<button
												class="btn btn-sm btn-secondary"
												onclick={() => deleteDownload(download)}
												disabled={retryingAll}
												title="Delete download"
												aria-label="Delete {download.title || download.url}"
											>
												<TrashIcon width={12} height={12} />
												<span class="btn-label">Delete</span>
											</button>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
					{#if hasMoreFailed}
						<div class="load-more">
							<button
								class="btn btn-sm btn-secondary"
								onclick={loadMoreFailed}
								disabled={failedLoading || loadingMore}
							>
								{loadingMore ? 'Loading…' : 'Load more'}
							</button>
						</div>
					{/if}
				{/if}
			</div>
		{/if}
	</section>
{/if}

<style>
	.failed-section {
		margin-bottom: var(--spacing-lg);
		width: 100%;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}

	/* Slim bar: toggle (chevron + title) on the left, Retry All on the right. */
	.failed-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-sm);
		padding-right: var(--spacing-sm);
	}

	.failed-toggle {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		background: none;
		border: none;
		border-radius: 0;
		color: var(--color-text-primary);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium, 500);
		text-align: left;
		cursor: pointer;
		transition: background var(--transition-fast);
	}

	.failed-toggle:hover {
		background: var(--color-bg-hover);
	}

	.failed-toggle:focus-visible {
		outline: 2px solid var(--color-accent-primary);
		outline-offset: -2px;
	}

	.chevron {
		flex-shrink: 0;
		color: var(--color-text-tertiary);
		transition: transform var(--transition-fast);
	}

	.chevron.open {
		transform: rotate(180deg);
	}

	.failed-title {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.failed-count {
		color: var(--color-status-error);
		font-weight: 600;
	}

	.failed-body {
		border-top: 1px solid var(--color-border-default);
	}

	.failed-table {
		width: 100%;
		table-layout: fixed;
		border-collapse: collapse;
		font-size: var(--font-size-xs);
	}

	.col-title {
		width: 30%;
	}

	.col-error {
		width: 44%;
	}

	.col-date {
		width: 12%;
	}

	.col-actions {
		width: 14%;
	}

	.failed-table th {
		padding: var(--spacing-xs) var(--spacing-md);
		font-size: var(--font-size-2xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		text-align: left;
		color: var(--color-text-tertiary);
		border-bottom: 1px solid var(--color-border-default);
		white-space: nowrap;
	}

	.failed-table td {
		padding: var(--spacing-xs) var(--spacing-md);
		border-bottom: 1px solid var(--color-border-subtle);
		vertical-align: middle;
		white-space: nowrap;
	}

	.failed-table tbody tr:last-child td {
		border-bottom: none;
	}

	.failed-table tbody tr {
		transition: background var(--transition-fast);
	}

	.failed-table tbody tr:hover {
		background: var(--color-bg-hover);
	}

	.cell-text {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-primary);
	}

	.error-text {
		color: var(--color-status-error);
	}

	.date-text {
		font-size: var(--font-size-2xs);
		color: var(--color-text-tertiary);
	}

	.col-actions {
		text-align: right;
	}

	.row-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--spacing-xs);
	}

	.row-actions .btn {
		height: var(--control-height-sm);
		padding: 0 var(--spacing-sm);
		font-size: var(--font-size-2xs);
	}

	.load-more {
		display: flex;
		justify-content: center;
		padding: var(--spacing-sm) 0;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}

	@media (max-width: 768px) {
		.col-date {
			display: none;
		}

		.col-title {
			width: 38%;
		}

		.col-error {
			width: 42%;
		}

		.col-actions {
			width: 20%;
		}

		/* Icon-only row actions to keep the compact table from wrapping. */
		.btn-label {
			display: none;
		}

		.row-actions .btn {
			padding: 0 var(--spacing-xs);
		}

		.failed-toggle {
			min-height: 44px;
		}
	}
</style>
