<script lang="ts">
	interface Props {
		count?: number;
		variant?: 'card' | 'row' | 'text' | 'list' | 'grid' | 'table-row';
		columns?: number;
		lineWidths?: string[];
	}

	let { count = 6, variant = 'card', columns = 4, lineWidths }: Props = $props();

	function widthFor(i: number): string {
		if (lineWidths && lineWidths[i]) return lineWidths[i];
		const presets = ['100%', '92%', '78%', '85%', '60%'];
		return presets[i % presets.length];
	}
</script>

{#if variant === 'card'}
	<div class="skeleton-grid">
		{#each Array(count) as _, i}
			<div class="skeleton-card skeleton-item">
				<div class="skeleton-thumbnail"></div>
				<div class="skeleton-content">
					<div class="skeleton-line skeleton-title"></div>
					<div class="skeleton-line skeleton-subtitle"></div>
					<div class="skeleton-line skeleton-meta"></div>
				</div>
			</div>
		{/each}
	</div>
{:else if variant === 'row'}
	<div class="skeleton-rows">
		{#each Array(count) as _, i}
			<div class="skeleton-row skeleton-item"></div>
		{/each}
	</div>
{:else if variant === 'text'}
	<div class="skeleton-text">
		{#each Array(count) as _, i}
			<div
				class="skeleton-line skeleton-item skeleton-text-line"
				style="width: {widthFor(i)}"
			></div>
		{/each}
	</div>
{:else if variant === 'list'}
	<div class="skeleton-list">
		{#each Array(count) as _, i}
			<div class="skeleton-list-item skeleton-item">
				<div class="skeleton-avatar"></div>
				<div class="skeleton-list-body">
					<div class="skeleton-line skeleton-title"></div>
					<div class="skeleton-line skeleton-subtitle"></div>
				</div>
			</div>
		{/each}
	</div>
{:else if variant === 'grid'}
	<div
		class="skeleton-grid-layout"
		style="grid-template-columns: repeat({columns}, minmax(0, 1fr));"
	>
		{#each Array(count) as _, i}
			<div class="skeleton-grid-cell skeleton-item"></div>
		{/each}
	</div>
{:else if variant === 'table-row'}
	<div class="skeleton-table">
		{#each Array(count) as _, i}
			<div class="skeleton-table-row skeleton-item">
				{#each Array(columns) as _, c}
					<div class="skeleton-cell" style="flex: {c === 0 ? '2' : '1'}"></div>
				{/each}
			</div>
		{/each}
	</div>
{/if}

<style>
	@keyframes shimmer {
		0% {
			background-position: -468px 0;
		}
		100% {
			background-position: 468px 0;
		}
	}

	.skeleton-item {
		background: linear-gradient(
			90deg,
			var(--color-bg-secondary) 25%,
			var(--color-bg-tertiary, var(--color-overlay-white-06)) 50%,
			var(--color-bg-secondary) 75%
		);
		background-size: 936px 100%;
		animation: shimmer 1.5s ease-in-out infinite;
	}

	.skeleton-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: var(--spacing-lg);
	}

	.skeleton-card {
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		overflow: hidden;
		min-height: 280px;
	}

	.skeleton-thumbnail {
		width: 100%;
		height: 180px;
		background: rgba(255, 255, 255, 0.03);
	}

	.skeleton-content {
		padding: var(--spacing-lg);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.skeleton-line {
		border-radius: var(--radius-sm, 4px);
		background: rgba(255, 255, 255, 0.04);
	}

	.skeleton-title {
		height: 16px;
		width: 80%;
	}

	.skeleton-subtitle {
		height: 12px;
		width: 50%;
	}

	.skeleton-meta {
		height: 12px;
		width: 30%;
	}

	.skeleton-rows {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.skeleton-row {
		height: 48px;
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
	}

	.skeleton-text {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.skeleton-text-line {
		height: 14px;
	}

	.skeleton-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.skeleton-list-item {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		padding: var(--spacing-md);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
	}

	.skeleton-avatar {
		flex-shrink: 0;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: var(--color-overlay-white-05);
	}

	.skeleton-list-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs, 6px);
		min-width: 0;
	}

	.skeleton-grid-layout {
		display: grid;
		gap: var(--spacing-md);
	}

	.skeleton-grid-cell {
		aspect-ratio: 1 / 1;
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
	}

	.skeleton-table {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs, 6px);
	}

	.skeleton-table-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		padding: var(--spacing-md);
		border-bottom: 1px solid var(--color-border-default);
		border-radius: var(--radius-sm, 4px);
	}

	.skeleton-cell {
		height: 14px;
		background: var(--color-overlay-white-05);
		border-radius: var(--radius-sm, 4px);
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton-item {
			animation: none;
		}
	}
</style>
