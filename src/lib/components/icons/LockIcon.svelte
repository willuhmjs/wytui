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
	<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
	<path d="M7 11V7a5 5 0 0 1 10 0v4" />
</svg>
