<script lang="ts">
	import { onMount } from 'svelte';
	import { navigating } from '$app/stores';
	import { connectSSE, disconnectSSE, getSSEState } from '$lib/stores/sse.svelte';
	import { csrfFetch } from '$lib/utils/fetch';
	import Sidebar from '$lib/components/ui/Sidebar.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Toast from '$lib/components/ui/Toast.svelte';
	import HealthPanel from '$lib/components/ui/HealthPanel.svelte';
	import KeyboardShortcutHelp from '$lib/components/ui/KeyboardShortcutHelp.svelte';
	import { getKeyboardState } from '$lib/stores/keyboard.svelte';
	import type { LayoutData } from './$types';
	import '../app.css';

	let { children, data }: { children: any; data: LayoutData } = $props();
	let healthPanelOpen = $state(false);
	let keyboard = getKeyboardState();
	let sseState = getSSEState();
	let isAdmin = $derived(data.session?.user?.isAdmin ?? false);
	let sidebarCollapsed = $state(false);
	// Stats panel can be hidden from non-admins; total/global size separately gated.
	let statsVisible = $derived(isAdmin || (data.statsVisibleToNonAdmins ?? true));
	let showTotalSize = $derived(isAdmin || (data.showTotalSizeToNonAdmins ?? false));

	onMount(() => {
		connectSSE();
		return () => {
			disconnectSSE();
		};
	});

	async function handleSignout() {
		await csrfFetch('/auth/signout', { method: 'POST' });
		window.location.href = '/auth/signin';
	}
</script>

<div class="app-layout">
	<Sidebar
		{isAdmin}
		{statsVisible}
		connected={sseState.connected}
		userEmail={data.session?.user?.email}
		onHealthClick={() => (healthPanelOpen = true)}
		onSignout={handleSignout}
		bind:collapsed={sidebarCollapsed}
	/>

	<div class="main-area" class:collapsed={sidebarCollapsed}>
		<header class="top-header">
			<!-- Empty header bar for spacing -->
		</header>

		{#if $navigating}
			<div class="nav-progress">
				<div class="nav-progress-bar"></div>
			</div>
		{/if}

		<main class="main-content">
			{@render children()}
		</main>

		<footer class="footer">
			<div class="footer-inner">
				<span class="footer-brand">
					<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 128 128">
						<defs>
							<linearGradient id="footer-g" x1="0%" y1="0%" x2="100%" y2="100%">
								<stop offset="0%" stop-color="#7c3aed" />
								<stop offset="100%" stop-color="#3b82f6" />
							</linearGradient>
						</defs>
						<rect width="128" height="128" rx="28" fill="url(#footer-g)" />
						<path
							d="M64 30 L64 78 M44 62 L64 82 L84 62"
							stroke="#fff"
							stroke-width="10"
							stroke-linecap="round"
							stroke-linejoin="round"
							fill="none"
						/>
						<path
							d="M38 94 L90 94"
							stroke="#fff"
							stroke-width="10"
							stroke-linecap="round"
							fill="none"
						/>
					</svg>
					<span>wytui</span>
				</span>
				<span class="footer-divider"></span>
				<a
					href="https://github.com/willuhmjs/wytui"
					target="_blank"
					rel="noopener noreferrer"
					class="footer-link">GitHub</a
				>
			</div>
		</footer>
	</div>
</div>

<Modal />
<Toast />
<HealthPanel
	open={healthPanelOpen}
	onClose={() => (healthPanelOpen = false)}
	{isAdmin}
	{showTotalSize}
/>
<KeyboardShortcutHelp open={keyboard.showHelp} onClose={() => keyboard.closeHelp()} />

<style>
	.app-layout {
		display: flex;
		min-height: 100vh;
	}

	.main-area {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		margin-left: 240px;
		transition: margin-left 0.2s ease;
	}

	.main-area.collapsed {
		margin-left: 64px;
	}

	.top-header {
		background: var(--color-bg-secondary);
		border-bottom: 1px solid var(--color-border-default);
		padding: var(--spacing-md) var(--spacing-xl);
		position: sticky;
		top: 0;
		z-index: 50;
		backdrop-filter: blur(10px);
		background: rgba(20, 20, 20, 0.8);
	}

	.nav-progress {
		height: 2px;
		background: var(--color-bg-tertiary);
		overflow: hidden;
	}

	.nav-progress-bar {
		height: 100%;
		background: var(--color-accent-primary);
		animation: progress 1.5s ease-in-out infinite;
		width: 30%;
	}

	@keyframes progress {
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(400%);
		}
	}

	.main-content {
		flex: 1;
		padding: var(--spacing-xl) var(--spacing-xl);
		max-width: 1400px;
		width: 100%;
		margin: 0 auto;
	}

	.footer {
		border-top: 1px solid var(--color-border-default);
		padding: var(--spacing-sm) var(--spacing-xl);
	}

	.footer-inner {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-md);
	}

	.footer-brand {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		color: var(--color-text-tertiary);
		font-size: 0.75rem;
		font-weight: 500;
	}

	.footer-divider {
		width: 1px;
		height: 12px;
		background: var(--color-border-default);
	}

	.footer-link {
		color: var(--color-text-tertiary);
		font-size: 0.75rem;
		text-decoration: none;
		transition: color var(--transition-fast);
	}

	.footer-link:hover {
		color: var(--color-text-secondary);
	}

	@media (max-width: 768px) {
		.main-area {
			margin-left: 0;
			padding-bottom: 68px;
		}

		.top-header {
			display: none;
		}

		.main-content {
			padding: var(--spacing-md);
		}

		.footer {
			display: none;
		}
	}
</style>
