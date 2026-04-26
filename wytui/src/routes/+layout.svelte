<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { connectSSE, disconnectSSE } from '$lib/stores/sse.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import type { LayoutData } from './$types';
	import '../app.css';

	let { children, data }: { children: any; data: LayoutData } = $props();

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
				<a href="/" class="logo">
					<h1 data-pronunciation="/ˈwaɪti/">wytui</h1>
				</a>
				<div class="nav-links">
					<a href="/" class:active={isActive('/')}>Dashboard</a>
					<a href="/settings" class:active={isActive('/settings')}>Settings</a>
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
		position: relative;
		cursor: pointer;
	}

	.logo h1::after {
		content: attr(data-pronunciation);
		position: absolute;
		bottom: -2.5rem;
		left: 50%;
		transform: translateX(-50%) translateY(10px);
		background: var(--bg-elevated);
		color: var(--text-secondary);
		padding: var(--spacing-sm) var(--spacing-md);
		border-radius: var(--border-radius-md);
		font-size: 0.875rem;
		font-weight: 400;
		white-space: nowrap;
		opacity: 0;
		pointer-events: none;
		transition: all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
		border: 1px solid var(--border);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}

	.logo h1:hover::after {
		opacity: 1;
		transform: translateX(-50%) translateY(0);
	}

	.nav-links {
		display: flex;
		gap: var(--spacing-lg);
	}

	.nav-links a {
		color: var(--text-secondary);
		text-decoration: none;
		font-weight: 500;
		transition: color var(--transition-fast);
	}

	.nav-links a:hover {
		color: var(--text-primary);
	}

	.nav-links a.active {
		color: var(--accent-primary);
		font-weight: 600;
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
