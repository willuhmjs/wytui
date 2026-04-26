<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { connectSSE, disconnectSSE } from '$lib/stores/sse.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import type { LayoutData } from './$types';
	import '../app.css';

	let { children, data }: { children: any; data: LayoutData } = $props();
	let logoHovered = $state(false);

	onMount(() => {
		// Connect to SSE on mount
		connectSSE();

		// Cleanup on unmount
		return () => {
			disconnectSSE();
		};
	});

	async function handleSignout() {
		await fetch('/auth/signout', { method: 'POST' });
		window.location.href = '/auth/signin';
	}

	function isActive(path: string): boolean {
		if (path === '/') {
			return $page.url.pathname === '/';
		}
		return $page.url.pathname.startsWith(path);
	}
</script>

<div class="app">
	<header class="header">
		<div class="container">
			<nav class="nav">
				<a
					href="/"
					class="logo"
					onmouseenter={() => logoHovered = true}
					onmouseleave={() => logoHovered = false}
				>
					<h1>{logoHovered ? '/ˈwaɪti/' : 'wytui'}</h1>
				</a>
				<div class="nav-links">
					<a href="/settings" class="settings-btn" class:active={isActive('/settings')} title="Settings">
						<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
							<circle cx="12" cy="12" r="3"/>
						</svg>
					</a>
					{#if data.session?.user}
						<button class="signout-btn" onclick={handleSignout}>
							Sign Out
						</button>
					{/if}
				</div>
			</nav>
		</div>
	</header>

	<main class="main">
		<div class="container">
			{@render children()}
		</div>
	</main>
</div>

<Modal />

<style>
	.app {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		overflow: visible;
	}

	.header {
		background: var(--bg-secondary);
		border-bottom: 1px solid var(--border);
		padding: var(--spacing-md) 0;
		position: sticky;
		top: 0;
		z-index: 100;
	}

	.nav {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.logo {
		text-decoration: none;
	}

	.logo h1 {
		font-size: 1.5rem;
		background: linear-gradient(135deg, var(--accent-primary), var(--accent-hover));
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
		cursor: pointer;
		transition: all var(--transition-fast);
		min-width: 110px;
		text-align: center;
	}

	.nav-links {
		display: flex;
		align-items: center;
		gap: var(--spacing-lg);
	}

	.settings-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-sm);
		color: var(--text-secondary);
		text-decoration: none;
		transition: all var(--transition-fast);
		border-radius: var(--radius-md);
	}

	.settings-btn:hover {
		color: var(--text-primary);
		background: rgba(255, 255, 255, 0.05);
	}

	.settings-btn.active {
		color: var(--accent-primary);
	}

	.settings-btn svg {
		transition: transform var(--transition-normal);
	}

	.settings-btn:hover svg {
		transform: rotate(45deg);
	}

	.signout-btn {
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.2);
		color: var(--text-secondary);
		padding: var(--spacing-sm) var(--spacing-md);
		border-radius: var(--border-radius-md);
		font-weight: 500;
		cursor: pointer;
		transition: var(--transition-fast);
	}

	.signout-btn:hover {
		background: rgba(255, 255, 255, 0.05);
		color: var(--text-primary);
		border-color: rgba(255, 255, 255, 0.3);
	}

	.main {
		flex: 1 1 auto;
		padding: var(--spacing-2xl) 0;
		min-height: 0;
		overflow: visible;
	}

	@media (max-width: 768px) {
		.nav-links {
			display: none;
		}
	}
</style>
