<script lang="ts">
	interface Props {
		size?: number;
		color?: string;
		ariaLabel?: string;
	}

	let {
		size = 24,
		color = 'var(--color-status-success, #22c55e)',
		ariaLabel = 'Success',
	}: Props = $props();

	let strokeLength = $derived(size * 0.6);
</script>

<svg
	class="success-icon"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	role="img"
	aria-label={ariaLabel}
	style="--icon-color: {color}; --check-dash: {strokeLength}px;"
>
	<circle
		class="success-circle"
		cx="12"
		cy="12"
		r="11"
		fill="none"
		stroke="var(--icon-color)"
		stroke-width="1.5"
	/>
	<path
		class="success-check"
		d="M7 12.5l3.5 3.5L17 9"
		fill="none"
		stroke="var(--icon-color)"
		stroke-width="2.2"
		stroke-linecap="round"
		stroke-linejoin="round"
	/>
</svg>

<style>
	.success-icon {
		display: inline-block;
	}

	.success-circle {
		stroke-dasharray: 70;
		stroke-dashoffset: 70;
		animation: success-circle-draw 0.4s ease-out forwards;
		transform-origin: center;
	}

	.success-check {
		stroke-dasharray: var(--check-dash);
		stroke-dashoffset: var(--check-dash);
		animation:
			success-check-draw 0.3s ease-out 0.3s forwards,
			success-pop 0.4s ease-out 0.55s;
	}

	@keyframes success-circle-draw {
		to {
			stroke-dashoffset: 0;
		}
	}

	@keyframes success-check-draw {
		to {
			stroke-dashoffset: 0;
		}
	}

	@keyframes success-pop {
		0% {
			transform: scale(1);
		}
		50% {
			transform: scale(1.15);
		}
		100% {
			transform: scale(1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.success-circle,
		.success-check {
			animation: none;
			stroke-dashoffset: 0;
		}
	}
</style>
