<script lang="ts">
	let { width = 16, height = 16 } = $props();
</script>

<svg
	{width}
	{height}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
>
	<line x1="8" y1="6" x2="21" y2="6" />
	<line x1="8" y1="12" x2="21" y2="12" />
	<line x1="8" y1="18" x2="21" y2="18" />
	<line x1="3" y1="6" x2="3.01" y2="6" />
	<line x1="3" y1="12" x2="3.01" y2="12" />
	<line x1="3" y1="18" x2="3.01" y2="18" />
	<line x1="19" y1="3" x2="19" y2="9" />
	<line x1="16" y1="6" x2="22" y2="6" />
</svg>
