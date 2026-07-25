<script lang="ts">
	import { onMount } from 'svelte';

	let container: HTMLDivElement;

	onMount(async () => {
		const { SwaggerUIBundle } = await import('swagger-ui-dist');
		await import('swagger-ui-dist/swagger-ui.css');

		SwaggerUIBundle({
			dom_id: '#swagger-ui',
			url: '/api/docs',
			deepLinking: true,
			tryItOutEnabled: true,
		});
	});
</script>

<svelte:head>
	<title>API Documentation - wytui</title>
</svelte:head>

<div class="docs-page">
	<div class="docs-header">
		<a href="/settings" class="back-link">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg
			>
			Back to Settings
		</a>
		<h1>API Documentation</h1>
	</div>
	<div id="swagger-ui" bind:this={container}></div>
</div>

<style>
	.docs-page {
		min-height: 100vh;
		background: var(--color-bg-primary);
	}

	.docs-header {
		display: flex;
		align-items: center;
		gap: var(--spacing-lg);
		padding: var(--spacing-lg) var(--spacing-xl);
		border-bottom: 1px solid var(--color-border-default);
	}

	.back-link {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		color: var(--color-text-secondary);
		text-decoration: none;
		font-size: 0.875rem;
		transition: color 0.15s;
	}

	.back-link:hover {
		color: var(--color-text-primary);
	}

	h1 {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	/* Dark theme overrides for Swagger UI */
	:global(.swagger-ui) {
		font-family: inherit;
	}

	:global(.swagger-ui .wrapper) {
		padding: var(--spacing-lg);
	}

	:global(.swagger-ui),
	:global(.swagger-ui .scheme-container),
	:global(.swagger-ui .opblock .opblock-section-header) {
		background: var(--color-bg-primary);
	}

	:global(.swagger-ui .topbar) {
		display: none;
	}

	:global(.swagger-ui .info .title),
	:global(.swagger-ui .info p),
	:global(.swagger-ui .info li),
	:global(.swagger-ui .opblock .opblock-summary-description),
	:global(.swagger-ui .opblock-description-wrapper p),
	:global(.swagger-ui .opblock-external-docs-wrapper p),
	:global(.swagger-ui .response-col_description__inner p),
	:global(.swagger-ui table thead tr th),
	:global(.swagger-ui table thead tr td),
	:global(.swagger-ui .parameter__name),
	:global(.swagger-ui .parameter__type),
	:global(.swagger-ui .response-col_status),
	:global(.swagger-ui .tab li),
	:global(.swagger-ui label),
	:global(.swagger-ui .model-title),
	:global(.swagger-ui .model),
	:global(.swagger-ui section.models h4) {
		color: var(--color-text-primary) !important;
	}

	:global(.swagger-ui .opblock-tag),
	:global(.swagger-ui .opblock-tag a) {
		color: var(--color-text-primary) !important;
		border-bottom-color: var(--color-border-default) !important;
	}

	:global(.swagger-ui .opblock) {
		border-color: var(--color-border-default);
		background: var(--color-bg-secondary);
	}

	:global(.swagger-ui .opblock .opblock-summary) {
		border-bottom-color: var(--color-border-default);
	}

	:global(.swagger-ui .opblock .opblock-section-header) {
		background: var(--color-bg-tertiary);
	}

	:global(.swagger-ui .opblock .opblock-section-header h4) {
		color: var(--color-text-primary) !important;
	}

	:global(.swagger-ui .btn) {
		color: var(--color-text-primary);
		border-color: var(--color-border-default);
	}

	:global(.swagger-ui select) {
		background: var(--color-bg-tertiary);
		color: var(--color-text-primary);
		border-color: var(--color-border-default);
	}

	:global(.swagger-ui input[type='text']),
	:global(.swagger-ui textarea) {
		background: var(--color-bg-tertiary);
		color: var(--color-text-primary);
		border-color: var(--color-border-default);
	}

	:global(.swagger-ui .model-box) {
		background: var(--color-bg-secondary);
	}

	:global(.swagger-ui section.models) {
		border-color: var(--color-border-default);
	}

	:global(.swagger-ui section.models.is-open h4) {
		border-bottom-color: var(--color-border-default);
	}

	:global(.swagger-ui .response-col_description__inner div.markdown p) {
		color: var(--color-text-secondary) !important;
	}

	:global(.swagger-ui .scheme-container) {
		box-shadow: none;
		border-bottom: 1px solid var(--color-border-default);
	}
</style>
