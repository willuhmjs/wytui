<script lang="ts">
	interface Props {
		width?: number;
		height?: number;
		class?: string;
		checked?: boolean;
	}

	let { width = 16, height = 16, class: className = '', checked = false }: Props = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	{width}
	{height}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	class={className}
>
	{#if checked}
		<polyline points="9 11 12 14 22 4" />
		<path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
	{:else}
		<rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
	{/if}
</svg>
