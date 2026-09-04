<script lang="ts">
	import { onMount } from 'svelte';
	import { EXTENSION_STORE_URLS, detectBrowser } from '$lib/extension-links';

	interface Props {
		/** Button label (e.g. "Extension" or "Browser extension"). */
		label?: string;
		/** Render as a compact nav item (sidebar) or a .btn.btn-secondary (settings). */
		variant?: 'nav' | 'button';
		/** Hide the label (collapsed sidebar). */
		collapsed?: boolean;
	}

	let { label = 'Extension', variant = 'nav', collapsed = false }: Props = $props();

	let open = $state(false);
	let container: HTMLElement;
	let browser = $state<'firefox' | 'chrome'>('chrome');

	onMount(() => {
		browser = detectBrowser();
	});

	function toggle(e: MouseEvent) {
		e.preventDefault();
		open = !open;
	}

	function close() {
		open = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="extension-menu" class:open bind:this={container}>
	{#if variant === 'nav'}
		<button
			class="nav-item"
			onclick={toggle}
			title={collapsed ? 'Browser extension stores' : undefined}
		>
			<svg
				class="nav-icon"
				width="20"
				height="20"
				viewBox="0 0 20 20"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path
					d="M7 3.5a1.5 1.5 0 0 1 3 0V5h2.5A1.5 1.5 0 0 1 14 6.5V9h1.5a1.5 1.5 0 0 1 0 3H14v2.5a1.5 1.5 0 0 1-1.5 1.5H10v-1.5a1.5 1.5 0 0 0-3 0V16H4.5A1.5 1.5 0 0 1 3 14.5V12h1.5a1.5 1.5 0 0 0 0-3H3V6.5A1.5 1.5 0 0 1 4.5 5H7V3.5z"
				/>
			</svg>
			{#if !collapsed}<span class="nav-text">{label}</span>{/if}
			{#if !collapsed}
				<svg
					class="chev"
					width="12"
					height="12"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
				>
					<path d="M4 6l4 4 4-4" />
				</svg>
			{/if}
		</button>
	{:else}
		<button class="btn btn-secondary" onclick={toggle}>
			{label}
			<svg
				class="chev"
				width="12"
				height="12"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
			>
				<path d="M4 6l4 4 4-4" />
			</svg>
		</button>
	{/if}

	{#if open}
		<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
		<div class="extension-menu-backdrop" onclick={close}></div>
		<div class="extension-menu-panel" role="menu">
			<div class="extension-menu-hint">Install for your browser</div>
			<a
				href={EXTENSION_STORE_URLS.firefox}
				target="_blank"
				rel="noopener noreferrer"
				class="extension-menu-item"
				class:recommended={browser === 'firefox'}
				role="menuitem"
			>
				<span class="item-name">
					Firefox
					{#if browser === 'firefox'}<span class="badge">Detected</span>{/if}
				</span>
				<span class="item-sub">addons.mozilla.org</span>
			</a>
			<a
				href={EXTENSION_STORE_URLS.chrome}
				target="_blank"
				rel="noopener noreferrer"
				class="extension-menu-item"
				class:recommended={browser !== 'firefox'}
				role="menuitem"
			>
				<span class="item-name">
					Chrome / Chromium
					{#if browser !== 'firefox'}<span class="badge">Detected</span>{/if}
				</span>
				<span class="item-sub">Chrome Web Store</span>
			</a>
		</div>
	{/if}
</div>

<style>
	.extension-menu {
		position: relative;
	}

	.chev {
		margin-left: auto;
		transition: transform 0.15s ease;
		flex-shrink: 0;
	}

	.extension-menu.open .chev {
		transform: rotate(180deg);
	}

	.extension-menu-backdrop {
		position: fixed;
		inset: 0;
		z-index: 98;
	}

	.extension-menu-panel {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		min-width: 210px;
		background: var(--color-bg-tertiary, var(--color-bg-secondary));
		border: 1px solid var(--color-border-translucent, var(--color-border-default));
		border-radius: var(--radius-md, 8px);
		box-shadow: var(--shadow-lg);
		z-index: 100;
		overflow: hidden;
		padding: 4px;
		animation: extension-menu-in 140ms ease both;
	}

	@keyframes extension-menu-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.extension-menu-panel {
			animation: none;
		}
	}

	.extension-menu-hint {
		padding: 6px 10px;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-muted, var(--color-text-secondary));
	}

	.extension-menu-item {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 7px 10px;
		border-radius: 6px;
		text-decoration: none;
		color: var(--color-text-primary, inherit);
		transition: background var(--transition-fast, 0.15s);
	}

	.extension-menu-item:hover {
		background: var(--color-bg-hover, rgba(128, 128, 128, 0.12));
	}

	.item-name {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.85rem;
		font-weight: 500;
	}

	.item-sub {
		font-size: 0.72rem;
		color: var(--color-text-muted, var(--color-text-secondary));
	}

	.badge {
		font-size: 0.6rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 1px 5px;
		border-radius: 999px;
		background: var(--color-accent, #4f8cff);
		color: #fff;
	}

	/* "Detected" browser entry gets a subtle highlight */
	.extension-menu-item.recommended .item-name {
		color: var(--color-text-primary, inherit);
	}
</style>
