<script lang="ts">
	interface Step {
		label: string;
		status?: 'pending' | 'active' | 'completed' | 'failed';
	}

	interface Props {
		steps?: Step[];
		currentStep?: number;
		current?: number;
		total?: number;
		label?: string;
		variant?: 'bar' | 'steps';
	}

	let {
		steps = [],
		currentStep = 0,
		current = 0,
		total = 0,
		label,
		variant = 'bar',
	}: Props = $props();

	const percent = $derived(total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0);

	function getStepStatus(index: number, step: Step): 'pending' | 'active' | 'completed' | 'failed' {
		if (step.status) return step.status;
		if (index < currentStep) return 'completed';
		if (index === currentStep) return 'active';
		return 'pending';
	}
</script>

{#if variant === 'steps' && steps.length > 0}
	<ol class="step-list" aria-label={label ?? 'Progress'}>
		{#each steps as step, i}
			{@const status = getStepStatus(i, step)}
			<li class="step status-{status}">
				<span class="step-marker" aria-hidden="true">
					{#if status === 'completed'}
						<svg
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="3"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<polyline points="20 6 9 17 4 12"></polyline>
						</svg>
					{:else if status === 'failed'}
						<svg
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="3"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<line x1="18" y1="6" x2="6" y2="18"></line>
							<line x1="6" y1="6" x2="18" y2="18"></line>
						</svg>
					{:else}
						<span class="step-index">{i + 1}</span>
					{/if}
				</span>
				<span class="step-label">{step.label}</span>
			</li>
		{/each}
	</ol>
{:else}
	<div
		class="progress-wrapper"
		role="progressbar"
		aria-valuemin="0"
		aria-valuemax={total || 100}
		aria-valuenow={current}
		aria-label={label ?? 'Progress'}
	>
		{#if label || total > 0}
			<div class="progress-meta">
				{#if label}<span class="progress-label">{label}</span>{/if}
				{#if total > 0}<span class="progress-count">{current} / {total}</span>{/if}
			</div>
		{/if}
		<div class="progress-track">
			<div class="progress-fill" style:width="{percent}%"></div>
		</div>
	</div>
{/if}

<style>
	.progress-wrapper {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		width: 100%;
	}

	.progress-meta {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--spacing-sm);
		font-size: var(--font-size-xs);
		color: var(--color-text-secondary);
	}

	.progress-count {
		font-variant-numeric: tabular-nums;
		color: var(--color-text-tertiary);
	}

	.progress-track {
		position: relative;
		width: 100%;
		height: 6px;
		background: var(--color-bg-tertiary);
		border-radius: var(--radius-full);
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: var(--color-accent-primary);
		border-radius: var(--radius-full);
		transition: width var(--transition-normal);
	}

	.step-list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		margin: 0;
		padding: 0;
	}

	.step {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
	}

	.step-marker {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: var(--radius-full);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border-default);
		color: var(--color-text-tertiary);
		flex-shrink: 0;
		transition: var(--transition-fast);
	}

	.step-index {
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-semibold);
		line-height: 1;
	}

	.step.status-active .step-marker {
		background: var(--color-accent-primary);
		border-color: var(--color-accent-primary);
		color: var(--color-text-on-accent);
		box-shadow: 0 0 0 3px var(--color-focus-ring);
	}

	.step.status-active .step-label {
		color: var(--color-text-primary);
		font-weight: var(--font-weight-medium);
	}

	.step.status-completed .step-marker {
		background: var(--color-status-success);
		border-color: var(--color-status-success);
		color: var(--color-text-on-accent);
	}

	.step.status-completed .step-label {
		color: var(--color-text-primary);
	}

	.step.status-failed .step-marker {
		background: var(--color-status-error);
		border-color: var(--color-status-error);
		color: var(--color-text-on-accent);
	}

	.step.status-failed .step-label {
		color: var(--color-status-error);
	}

	@media (prefers-reduced-motion: reduce) {
		.progress-fill {
			transition: none;
		}

		.step-marker {
			transition: none;
		}
	}
</style>
