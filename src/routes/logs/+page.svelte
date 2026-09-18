<script lang="ts">
	import { addToast } from '$lib/stores/toast.svelte';
	import { showConfirm } from '$lib/stores/modal.svelte';
	import { csrfFetch } from '$lib/utils/fetch';
	import { formatDateTime } from '$lib/utils/format';
	import FilterDropdown from '$lib/components/ui/FilterDropdown.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import RefreshIcon from '$lib/components/icons/RefreshIcon.svelte';
	import TrashIcon from '$lib/components/icons/TrashIcon.svelte';

	interface EventLogEntry {
		id: string;
		type: string;
		message: string;
		userId: string | null;
		createdAt: string;
	}

	const PAGE_SIZE = 100;

	let events = $state<EventLogEntry[]>([]);
	let total = $state(0);
	let types = $state<string[]>([]);
	let typeFilter = $state<string>('all');
	let loading = $state(true);
	let loadingMore = $state(false);
	let clearing = $state(false);

	// Refresh, filter changes and Load more can be in flight at once (SSE-less
	// page, but the user can click freely). Only the newest request's response
	// may be applied — a stale unfiltered response must never overwrite a
	// filtered list (and vice versa).
	let loadSeq = 0;

	let hasMore = $derived(events.length < total);

	const typeOptions = $derived([
		{ value: 'all', label: 'All types' },
		...types.map((t) => ({ value: t, label: t })),
	]);

	// Fires on mount and on every filter change; passing the filter as an
	// argument reads it synchronously here, making the effect depend on it.
	$effect(() => {
		loadLogs(typeFilter);
	});

	function buildParams(offset: number, filter: string): URLSearchParams {
		const params = new URLSearchParams({
			limit: String(PAGE_SIZE),
			offset: String(offset),
		});
		if (filter !== 'all') params.set('type', filter);
		return params;
	}

	async function loadLogs(filter: string) {
		const seq = ++loadSeq;
		// Fresh load: reset pagination and replace the list from offset 0. The
		// reset happens up front (not on success) so a failed load cannot
		// leave the previous filter's rows standing under the new filter.
		events = [];
		total = 0;
		loading = true;
		try {
			const res = await fetch(`/api/logs?${buildParams(0, filter)}`);
			if (seq !== loadSeq) return; // superseded by a newer load
			if (res.ok) {
				const data = await res.json();
				events = data.events;
				total = data.total;
				types = data.types ?? [];
				// Reconcile the filter against the refreshed type list: if the
				// filtered type no longer exists server-side (retention sweep,
				// a Clear from another tab), the dropdown trigger would render
				// blank while an invisible filter stayed active. Resetting to
				// 'all' re-fires this effect with the unfiltered load.
				if (typeFilter !== 'all' && !types.includes(typeFilter)) {
					typeFilter = 'all';
				}
			} else {
				const data = await res.json().catch(() => null);
				addToast('error', data?.message || 'Failed to load logs');
			}
		} catch (e) {
			console.error('Failed to load logs:', e);
			addToast('error', 'Failed to load logs');
		} finally {
			if (seq === loadSeq) loading = false;
		}
	}

	async function loadMore() {
		if (loadingMore || !hasMore) return;
		const seq = ++loadSeq;
		loadingMore = true;
		try {
			const res = await fetch(`/api/logs?${buildParams(events.length, typeFilter)}`);
			if (seq !== loadSeq) return; // superseded (refresh/filter change)
			if (res.ok) {
				const data = await res.json();
				// The feed inserts at the head, so a row may have shifted into
				// this offset window while it was in flight — dedupe on append.
				const seen = new Set(events.map((e) => e.id));
				const fresh = (data.events as EventLogEntry[]).filter((e) => !seen.has(e.id));
				events = [...events, ...fresh];
				total = data.total;
				types = data.types ?? types;
			} else {
				const data = await res.json().catch(() => null);
				addToast('error', data?.message || 'Failed to load more logs');
			}
		} catch (e) {
			console.error('Failed to load more logs:', e);
			addToast('error', 'Failed to load more logs');
		} finally {
			if (seq === loadSeq) loadingMore = false;
		}
	}

	async function clearLogs() {
		const confirmed = await showConfirm(
			'Clear Logs',
			'Delete all logged events? This cannot be undone.',
			'Clear',
		);
		if (!confirmed) return;

		clearing = true;
		try {
			const res = await csrfFetch('/api/logs', { method: 'DELETE' });
			if (res.ok) {
				addToast('success', 'Logs cleared');
				await loadLogs(typeFilter);
			} else {
				const data = await res.json().catch(() => null);
				addToast('error', data?.message || 'Failed to clear logs');
			}
		} catch (e) {
			console.error('Failed to clear logs:', e);
			addToast('error', 'Failed to clear logs');
		} finally {
			clearing = false;
		}
	}

	/** Compact relative time, e.g. "5m ago". Falls back to a date past 30 days. */
	function timeAgo(date: string): string {
		const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
		if (seconds < 60) return 'just now';
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		if (days < 30) return `${days}d ago`;
		return new Date(date).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
		});
	}

	// Stable badge colors derived from the type's prefix (subscription.* /
	// download.* / cookies.*). Unknown prefixes fall back to a neutral gray.
	const TYPE_COLORS: Record<string, { bg: string; fg: string }> = {
		subscription: { bg: 'rgba(139, 92, 246, 0.15)', fg: '#a78bfa' },
		download: { bg: 'rgba(59, 130, 246, 0.15)', fg: '#60a5fa' },
		cookies: { bg: 'rgba(245, 158, 11, 0.15)', fg: '#f59e0b' },
	};

	function badgeStyle(type: string): string {
		const c = TYPE_COLORS[type.split('.')[0]] ?? {
			bg: 'rgba(156, 163, 175, 0.15)',
			fg: '#9ca3af',
		};
		return `background: ${c.bg}; color: ${c.fg};`;
	}
</script>

<svelte:head>
	<title>Logs - wytui</title>
</svelte:head>

<div class="page">
	<div class="page-content">
		<div class="page-header">
			<div>
				<h2>Logs</h2>
				<p class="text-muted">Recent activity — downloads, subscription checks, and more</p>
			</div>
			<div class="header-actions">
				<FilterDropdown
					label="Filter by event type"
					bind:value={typeFilter}
					options={typeOptions}
				/>
				<button
					class="btn btn-secondary"
					onclick={() => loadLogs(typeFilter)}
					disabled={loading || loadingMore}
				>
					<RefreshIcon />
					Refresh
				</button>
				<button
					class="btn btn-secondary"
					onclick={clearLogs}
					disabled={clearing ||
						loading ||
						(total === 0 && events.length === 0 && types.length === 0)}
				>
					<TrashIcon />
					{clearing ? 'Clearing...' : 'Clear'}
				</button>
			</div>
		</div>

		{#if loading}
			<div class="settings-section">
				<Skeleton variant="table-row" count={6} columns={3} />
			</div>
		{:else}
			<div class="settings-section">
				<div class="section-heading">
					<h3>Events</h3>
					<span class="text-muted">
						{total}
						{total === 1 ? 'event' : 'events'}{typeFilter !== 'all'
							? ` matching "${typeFilter}"`
							: ''}
					</span>
				</div>

				{#if events.length === 0}
					{#if typeFilter !== 'all'}
						<EmptyState
							title="No events of this type"
							description={`No "${typeFilter}" events have been recorded in the retention window.`}
							variant="subtle"
						/>
					{:else}
						<EmptyState
							title="No events yet"
							description="Recent activity — completed downloads, subscription checks, deletions, and more — will appear here."
							variant="subtle"
						/>
					{/if}
				{:else}
					<div class="table-wrapper">
						<table class="data-table">
							<thead>
								<tr>
									<th>Time</th>
									<th>Type</th>
									<th>Message</th>
								</tr>
							</thead>
							<tbody>
								{#each events as event (event.id)}
									<tr>
										<td
											class="time-cell"
											title={formatDateTime(event.createdAt) ?? event.createdAt}
										>
											{timeAgo(event.createdAt)}
										</td>
										<td>
											<span class="type-badge" style={badgeStyle(event.type)}>{event.type}</span>
										</td>
										<td class="message-cell">{event.message}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>

					{#if hasMore}
						<div class="load-more">
							<button class="btn btn-secondary" onclick={loadMore} disabled={loadingMore}>
								{loadingMore ? 'Loading...' : 'Load more'}
							</button>
						</div>
					{/if}
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.page {
		max-width: 1400px;
		margin: 0 auto;
		width: 100%;
	}

	.page-content {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-2xl);
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: var(--spacing-lg);
	}

	.page-header h2 {
		margin-bottom: var(--spacing-xs);
	}

	.page-header p {
		margin-top: var(--spacing-xs);
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		flex-shrink: 0;
	}

	.settings-section {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		padding: var(--spacing-xl);
	}

	.section-heading {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-lg);
	}

	.settings-section h3 {
		font-size: 1rem;
		font-weight: 600;
	}

	.table-wrapper {
		overflow-x: auto;
	}

	.data-table {
		width: 100%;
		border-collapse: collapse;
	}

	.data-table th {
		text-align: left;
		padding: var(--spacing-sm) var(--spacing-md);
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-tertiary);
		border-bottom: 1px solid var(--color-border-default);
		white-space: nowrap;
	}

	.data-table td {
		padding: var(--spacing-md);
		border-bottom: 1px solid var(--color-border-default);
		font-size: 0.875rem;
		vertical-align: top;
	}

	.data-table tbody tr:last-child td {
		border-bottom: none;
	}

	.data-table tbody tr:hover {
		background: rgba(255, 255, 255, 0.02);
	}

	.time-cell {
		white-space: nowrap;
		color: var(--color-text-secondary);
	}

	.type-badge {
		display: inline-block;
		padding: 2px var(--spacing-sm);
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		font-weight: 600;
		font-family: var(--font-family-mono);
		white-space: nowrap;
	}

	.message-cell {
		/* Wrap long messages instead of truncating. */
		word-break: break-word;
		min-width: 200px;
	}

	.load-more {
		display: flex;
		justify-content: center;
		margin-top: var(--spacing-lg);
	}

	/* Buttons use the global .btn system (src/app.css). */

	@media (max-width: 768px) {
		.page {
			padding: 0 var(--spacing-sm);
		}

		.page-header {
			flex-direction: column;
			gap: var(--spacing-md);
		}

		.header-actions {
			width: 100%;
			flex-wrap: wrap;
		}

		.header-actions :global(.filter-dropdown) {
			flex: 1;
			min-width: 150px;
		}

		.header-actions .btn {
			flex: 1;
		}

		.settings-section {
			padding: var(--spacing-md);
		}

		.data-table th,
		.data-table td {
			padding: var(--spacing-sm);
		}
	}
</style>
