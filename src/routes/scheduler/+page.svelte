<script lang="ts">
	import { onMount } from 'svelte';
	import { addToast } from '$lib/stores/toast.svelte';
	import { csrfFetch } from '$lib/utils/fetch';
	import RefreshIcon from '$lib/components/icons/RefreshIcon.svelte';
	import PlayIcon from '$lib/components/icons/PlayIcon.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';

	interface Job {
		name: string;
		cron: string;
		enabled: boolean;
		description: string;
	}

	interface JobRun {
		id: string;
		jobName: string;
		status: string;
		startedAt: string;
		endedAt: string | null;
		error: string | null;
		details: string | null;
	}

	let jobs = $state<Job[]>([]);
	let history = $state<JobRun[]>([]);
	let loading = $state(true);
	let runningJobs = $state<Set<string>>(new Set());

	onMount(() => {
		loadScheduler();
	});

	async function loadScheduler() {
		loading = true;
		try {
			const res = await fetch('/api/scheduler');
			if (res.ok) {
				const data = await res.json();
				jobs = data.jobs;
				history = data.history;
			} else {
				addToast('error', 'Failed to load scheduler data');
			}
		} catch (e) {
			console.error('Failed to load scheduler:', e);
			addToast('error', 'Failed to load scheduler data');
		} finally {
			loading = false;
		}
	}

	async function runJob(jobName: string) {
		runningJobs = new Set([...runningJobs, jobName]);
		try {
			const res = await csrfFetch(`/api/scheduler/${jobName}/run`, {
				method: 'POST',
			});
			if (res.ok) {
				addToast('success', `Job "${jobName}" completed successfully`);
				await loadScheduler();
			} else {
				const data = await res.json().catch(() => null);
				addToast('error', data?.message || `Failed to run job "${jobName}"`);
				await loadScheduler();
			}
		} catch {
			addToast('error', `Failed to run job "${jobName}"`);
		} finally {
			runningJobs = new Set([...runningJobs].filter((j) => j !== jobName));
		}
	}

	function formatDate(date: string): string {
		const d = new Date(date);
		return d.toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		});
	}

	function formatTime(date: string): string {
		const d = new Date(date);
		return d.toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
		});
	}

	function formatDuration(startedAt: string, endedAt: string | null): string {
		if (!endedAt) return '...';
		const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
		if (ms < 1000) return `${ms}ms`;
		const seconds = Math.floor(ms / 1000);
		if (seconds < 60) return `${seconds}s`;
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		return `${minutes}m ${remainingSeconds}s`;
	}

	function describeCron(cron: string): string {
		if (cron === '0 3 * * *') return 'Daily at 3:00 AM';
		if (cron === '0 * * * *') return 'Every hour';
		if (cron === '*/5 * * * *') return 'Every 5 minutes';
		if (cron === '*/30 * * * *') return 'Every 30 minutes';
		return cron;
	}
</script>

<svelte:head>
	<title>Scheduled Tasks - wytui</title>
</svelte:head>

<div class="page">
	<div class="page-content">
		<div class="page-header">
			<div>
				<h2>Scheduled Tasks</h2>
				<p class="text-muted">Background jobs and their run history</p>
			</div>
			<button class="btn btn-secondary" onclick={loadScheduler} disabled={loading}>
				<RefreshIcon />
				Refresh
			</button>
		</div>

		{#if loading}
			<div class="settings-section">
				<Skeleton variant="table-row" count={5} columns={5} />
			</div>
		{:else}
			<div class="settings-section">
				<h3>Registered Jobs</h3>
				<div class="table-wrapper">
					<table class="data-table">
						<thead>
							<tr>
								<th>Name</th>
								<th>Schedule</th>
								<th>Description</th>
								<th>Status</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each jobs as job}
								<tr>
									<td class="job-name">{job.name}</td>
									<td>
										<span class="cron-badge" title={job.cron}>{describeCron(job.cron)}</span>
									</td>
									<td class="text-muted">{job.description}</td>
									<td>
										{#if job.enabled}
											<span class="status-badge status-active">Active</span>
										{:else}
											<span class="status-badge status-disabled">Disabled</span>
										{/if}
									</td>
									<td>
										<button
											class="btn btn-sm btn-primary"
											disabled={runningJobs.has(job.name)}
											onclick={() => runJob(job.name)}
										>
											<PlayIcon width={14} height={14} />
											{runningJobs.has(job.name) ? 'Running...' : 'Run Now'}
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>

			<div class="settings-section">
				<h3>Recent Runs</h3>
				{#if history.length === 0}
					<EmptyState
						title="No job runs recorded yet"
						description="Run a job manually or wait for scheduled execution"
						variant="subtle"
					/>
				{:else}
					<div class="table-wrapper">
						<table class="data-table">
							<thead>
								<tr>
									<th>Job Name</th>
									<th>Status</th>
									<th>Started</th>
									<th>Duration</th>
									<th>Error</th>
								</tr>
							</thead>
							<tbody>
								{#each history as run}
									<tr>
										<td class="job-name">{run.jobName}</td>
										<td>
											{#if run.status === 'completed'}
												<span class="status-badge status-completed">Completed</span>
											{:else if run.status === 'failed'}
												<span class="status-badge status-failed">Failed</span>
											{:else if run.status === 'running'}
												<span class="status-badge status-running">Running</span>
											{:else}
												<span class="status-badge">{run.status}</span>
											{/if}
										</td>
										<td class="date-cell">
											<span>{formatDate(run.startedAt)}</span>
											<span class="text-muted">{formatTime(run.startedAt)}</span>
										</td>
										<td>{formatDuration(run.startedAt, run.endedAt)}</td>
										<td class="error-cell">
											{#if run.error}
												<span class="error-text" title={run.error}>{run.error}</span>
											{:else}
												<span class="text-muted">-</span>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
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

	.settings-section {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		padding: var(--spacing-xl);
	}

	.settings-section h3 {
		margin-bottom: var(--spacing-lg);
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
		vertical-align: middle;
	}

	.data-table tbody tr:last-child td {
		border-bottom: none;
	}

	.data-table tbody tr:hover {
		background: rgba(255, 255, 255, 0.02);
	}

	.job-name {
		font-weight: 500;
		font-family: var(--font-family-mono);
		font-size: 0.8125rem;
	}

	.cron-badge {
		padding: 2px var(--spacing-sm);
		border-radius: var(--radius-sm);
		font-size: 0.8125rem;
		background: rgba(99, 102, 241, 0.1);
		color: var(--color-accent-primary);
		white-space: nowrap;
	}

	.status-badge {
		display: inline-block;
		padding: 2px var(--spacing-sm);
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		font-weight: 600;
		white-space: nowrap;
	}

	.status-active {
		background: rgba(34, 197, 94, 0.15);
		color: #22c55e;
	}

	.status-disabled {
		background: rgba(156, 163, 175, 0.15);
		color: #9ca3af;
	}

	.status-completed {
		background: rgba(34, 197, 94, 0.15);
		color: #22c55e;
	}

	.status-failed {
		background: rgba(239, 68, 68, 0.15);
		color: #ef4444;
	}

	.status-running {
		background: rgba(59, 130, 246, 0.15);
		color: #3b82f6;
	}

	.date-cell {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.error-cell {
		max-width: 300px;
	}

	.error-text {
		color: #ef4444;
		font-size: 0.8125rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		display: block;
		max-width: 300px;
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

		.page-header .btn-secondary {
			width: 100%;
		}

		.settings-section {
			padding: var(--spacing-md);
		}

		.data-table th,
		.data-table td {
			padding: var(--spacing-sm);
		}

		.error-cell {
			max-width: 150px;
		}

		.error-text {
			max-width: 150px;
		}
	}
</style>
