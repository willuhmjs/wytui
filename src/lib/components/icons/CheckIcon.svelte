<script lang="ts">
	interface Props {
		width?: number;
		height?: number;
		class?: string;
	}

	let { width = 16, height = 16, class: className = '' }: Props = $props();
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
	<polyline points="20 6 9 17 4 12" />
</svg>
