<script lang="ts">
	interface Props {
		width?: number;
		height?: number;
		class?: string;
	}

	let { width = 16, height = 16, class: className = '' }: Props = $props();
</script>

<svg {width} {height} viewBox="0 0 16 16" fill="none" class={className}>
	<path
		d="M8 2v8M4 7l4 4 4-4M2 12v2h12v-2"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		stroke-linejoin="round"
	/>
</svg>
