<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { REPO_URL } from '$lib/extension-links';
	import ExtensionMenu from '$lib/components/ExtensionMenu.svelte';

	interface Props {
		isAdmin: boolean;
		statsVisible?: boolean;
		connected: boolean;
		userEmail?: string;
		onHealthClick: () => void;
		onSignout: () => void;
		collapsed?: boolean;
	}

	let {
		isAdmin,
		statsVisible = true,
		connected,
		userEmail,
		onHealthClick,
		onSignout,
		collapsed = $bindable(false),
	}: Props = $props();

	type NavItem = {
		label: string;
		href: string;
		icon: string;
	};

	const libraryItems: NavItem[] = [
		{ label: 'Downloads', href: '/downloads', icon: 'download' },
		{ label: 'Search', href: '/search', icon: 'search' },
		{ label: 'Channels', href: '/channels', icon: 'channel' },
		{ label: 'Subscriptions', href: '/subscriptions', icon: 'broadcast' },
		{ label: 'Monitors', href: '/monitors', icon: 'eye' },
		{ label: 'Playlists', href: '/playlists', icon: 'playlist' },
	];

	// Settings is available to ALL users (Account tab: password + API keys).
	// Analytics/Scheduler are admin-only.
	const settingsItem: NavItem = { label: 'Settings', href: '/settings', icon: 'gear' };
	const adminItems: NavItem[] = [
		{ label: 'Analytics', href: '/analytics', icon: 'chart' },
		{ label: 'Scheduler', href: '/scheduler', icon: 'clock' },
	];
	let systemItems = $derived(isAdmin ? [settingsItem, ...adminItems] : [settingsItem]);

	function isActive(href: string): boolean {
		if (href === '/') return $page.url.pathname === '/';
		return $page.url.pathname === href || $page.url.pathname.startsWith(href + '/');
	}

	const mobileItems: NavItem[] = [
		{ label: 'Downloads', href: '/downloads', icon: 'download' },
		{ label: 'Subs', href: '/subscriptions', icon: 'broadcast' },
		{ label: 'Playlists', href: '/playlists', icon: 'playlist' },
		{ label: 'Settings', href: '/settings', icon: 'gear' },
	];

	let mobileMenuOpen = $state(false);

	// Version check
	let updateAvailable = $state(false);
	let commitsUrl = $state('');

	onMount(async () => {
		try {
			const res = await fetch('/api/version');
			if (res.ok) {
				const data = await res.json();
				updateAvailable = data.updateAvailable;
				commitsUrl = data.commitsUrl;
			}
		} catch {
			// Version check is best-effort
		}
	});
</script>

<!-- Desktop sidebar -->
<aside class="sidebar" class:collapsed>
	<div class="sidebar-header">
		<a href="/" class="logo" title="wytui (W-Y-T-U-I)">
			{#if !collapsed}
				<div class="logo-row">
					<h1>wytui</h1>
					{#if updateAvailable}
						<a
							href={commitsUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="update-badge"
							title="New commits available — pull the latest image"
						>
							<svg
								width="14"
								height="14"
								viewBox="0 0 20 20"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<path d="M10 3v10M6 9l4 4 4-4" />
								<path d="M4 15h12" />
							</svg>
						</a>
					{/if}
				</div>
			{:else}
				<div class="logo-row">
					<h1 class="logo-collapsed">w</h1>
					{#if updateAvailable}
						<span class="update-dot" title="New commits available — pull the latest image"></span>
					{/if}
				</div>
			{/if}
		</a>
		<button
			class="collapse-btn"
			onclick={() => (collapsed = !collapsed)}
			title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
		>
			<svg
				width="16"
				height="16"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<rect x="2" y="3" width="12" height="10" rx="1.5" />
				<path d="M6 3v10" />
			</svg>
		</button>
	</div>

	<nav class="sidebar-nav">
		<div class="nav-group">
			{#if !collapsed}<span class="nav-label">Library</span>{/if}
			{#each libraryItems as item}
				<a
					href={item.href}
					class="nav-item"
					class:active={isActive(item.href)}
					title={collapsed ? item.label : undefined}
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
						{#if item.icon === 'download'}
							<path d="M10 3v10M6 9l4 4 4-4" />
							<path d="M4 15h12" />
						{:else if item.icon === 'broadcast'}
							<circle cx="10" cy="10" r="2" />
							<path d="M6.5 6.5a5 5 0 0 0 0 7" />
							<path d="M13.5 6.5a5 5 0 0 1 0 7" />
							<path d="M4 4a8 8 0 0 0 0 12" />
							<path d="M16 4a8 8 0 0 1 0 12" />
						{:else if item.icon === 'eye'}
							<path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z" />
							<circle cx="10" cy="10" r="3" />
						{:else if item.icon === 'playlist'}
							<path d="M3 5h10" />
							<path d="M3 10h6" />
							<path d="M3 15h4" />
							<path d="M14 10v6l4-3-4-3z" />
						{:else if item.icon === 'channel'}
							<path d="M3 5h14" />
							<path d="M3 10h14" />
							<path d="M3 15h14" />
							<circle cx="17" cy="5" r="2" />
							<circle cx="17" cy="10" r="2" />
							<circle cx="17" cy="15" r="2" />
						{:else if item.icon === 'search'}
							<circle cx="9" cy="9" r="5" />
							<path d="M13 13l4 4" />
						{/if}
					</svg>
					{#if !collapsed}<span class="nav-text">{item.label}</span>{/if}
				</a>
			{/each}
		</div>

		<div class="nav-group">
			{#if !collapsed}<span class="nav-label">System</span>{/if}
			{#each systemItems as item}
				<a
					href={item.href}
					class="nav-item"
					class:active={isActive(item.href)}
					title={collapsed ? item.label : undefined}
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
						{#if item.icon === 'gear'}
							<circle cx="10" cy="10" r="3" />
							<path
								d="M10 2v2M10 16v2M2 10h2M16 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4"
							/>
						{:else if item.icon === 'chart'}
							<path d="M4 16V10" />
							<path d="M8 16V6" />
							<path d="M12 16V8" />
							<path d="M16 16V4" />
						{:else if item.icon === 'clock'}
							<circle cx="10" cy="10" r="7" />
							<path d="M10 6v4l3 2" />
						{/if}
					</svg>
					{#if !collapsed}<span class="nav-text">{item.label}</span>{/if}
				</a>
			{/each}
		</div>

		<div class="nav-group">
			{#if !collapsed}<span class="nav-label">Links</span>{/if}
			<div class="nav-extension-wrap" class:collapsed>
				<ExtensionMenu label="Extension" variant="nav" {collapsed} />
			</div>
			<a
				href={REPO_URL}
				class="nav-item"
				target="_blank"
				rel="noopener noreferrer"
				title={collapsed ? 'GitHub repository' : undefined}
			>
				<svg
					class="nav-icon"
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="currentColor"
					stroke="none"
				>
					<path
						d="M12 1.5a10.5 10.5 0 0 0-3.32 20.47c.53.1.72-.23.72-.5v-1.8c-2.92.63-3.54-1.4-3.54-1.4-.48-1.21-1.17-1.53-1.17-1.53-.95-.65.07-.64.07-.64 1.06.08 1.61 1.09 1.61 1.09.94 1.6 2.46 1.14 3.06.87.1-.68.37-1.14.67-1.4-2.33-.27-4.78-1.17-4.78-5.19 0-1.15.41-2.08 1.09-2.82-.11-.27-.47-1.34.1-2.79 0 0 .88-.28 2.88 1.08a10 10 0 0 1 5.24 0c2-1.36 2.88-1.08 2.88-1.08.57 1.45.21 2.52.1 2.79.68.74 1.09 1.67 1.09 2.82 0 4.03-2.46 4.91-4.8 5.17.38.33.71.97.71 1.96v2.9c0 .28.19.61.73.5A10.5 10.5 0 0 0 12 1.5z"
					/>
				</svg>
				{#if !collapsed}<span class="nav-text">GitHub</span>{/if}
			</a>
		</div>
	</nav>

	<div class="sidebar-footer">
		<button
			class="connection-status"
			class:connected
			onclick={statsVisible ? onHealthClick : undefined}
			style={statsVisible ? undefined : 'cursor: default'}
			title={collapsed ? (connected ? 'Connected' : 'Connecting...') : undefined}
		>
			<span class="status-dot"></span>
			{#if !collapsed}
				<span class="status-label">{connected ? 'Connected' : 'Connecting...'}</span>
			{/if}
		</button>

		{#if userEmail}
			<div class="user-card">
				<div class="user-avatar">
					{userEmail.charAt(0).toUpperCase()}
				</div>
				{#if !collapsed}
					<span class="user-email">{userEmail}</span>
					<button class="signout-btn" onclick={onSignout} title="Sign out">
						<svg
							width="16"
							height="16"
							viewBox="0 0 20 20"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M9 3H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
							<path d="M16 10H9M16 10l-3-3M16 10l-3 3" />
						</svg>
					</button>
				{:else}
					<button class="signout-btn signout-btn-collapsed" onclick={onSignout} title="Sign out">
						<svg
							width="16"
							height="16"
							viewBox="0 0 20 20"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M9 3H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
							<path d="M16 10H9M16 10l-3-3M16 10l-3 3" />
						</svg>
					</button>
				{/if}
			</div>
		{/if}
	</div>
</aside>

<!-- Mobile bottom tab bar -->
<nav class="mobile-tabbar">
	{#each mobileItems as item}
		<a href={item.href} class="mobile-tab" class:active={isActive(item.href)}>
			<svg
				class="mobile-tab-icon"
				width="20"
				height="20"
				viewBox="0 0 20 20"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				{#if item.icon === 'download'}
					<path d="M10 3v10M6 9l4 4 4-4" />
					<path d="M4 15h12" />
				{:else if item.icon === 'broadcast'}
					<circle cx="10" cy="10" r="2" />
					<path d="M6.5 6.5a5 5 0 0 0 0 7" />
					<path d="M13.5 6.5a5 5 0 0 1 0 7" />
				{:else if item.icon === 'playlist'}
					<path d="M3 5h10" />
					<path d="M3 10h6" />
					<path d="M3 15h4" />
					<path d="M14 10v6l4-3-4-3z" />
				{:else if item.icon === 'gear'}
					<circle cx="10" cy="10" r="3" />
					<path
						d="M10 2v2M10 16v2M2 10h2M16 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4"
					/>
				{/if}
			</svg>
			<span class="mobile-tab-label">{item.label}</span>
		</a>
	{/each}

	<button
		class="mobile-tab"
		class:active={mobileMenuOpen}
		onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
	>
		<svg
			class="mobile-tab-icon"
			width="20"
			height="20"
			viewBox="0 0 20 20"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="M3 5h14M3 10h14M3 15h14" />
		</svg>
		<span class="mobile-tab-label">More</span>
	</button>

	{#if mobileMenuOpen}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="mobile-menu-backdrop" onclick={() => (mobileMenuOpen = false)}></div>
		<div class="mobile-menu">
			<a
				href="/channels"
				class="mobile-menu-item"
				class:active={isActive('/channels')}
				onclick={() => (mobileMenuOpen = false)}
			>
				<svg
					width="20"
					height="20"
					viewBox="0 0 20 20"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M3 5h14" />
					<path d="M3 10h14" />
					<path d="M3 15h14" />
					<circle cx="17" cy="5" r="2" />
					<circle cx="17" cy="10" r="2" />
					<circle cx="17" cy="15" r="2" />
				</svg>
				<span>Channels</span>
			</a>
			<a
				href="/monitors"
				class="mobile-menu-item"
				class:active={isActive('/monitors')}
				onclick={() => (mobileMenuOpen = false)}
			>
				<svg
					width="20"
					height="20"
					viewBox="0 0 20 20"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z" />
					<circle cx="10" cy="10" r="3" />
				</svg>
				<span>Monitors</span>
			</a>
			<a
				href="/playlists"
				class="mobile-menu-item"
				class:active={isActive('/playlists')}
				onclick={() => (mobileMenuOpen = false)}
			>
				<svg
					width="20"
					height="20"
					viewBox="0 0 20 20"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M3 5h10" />
					<path d="M3 10h6" />
					<path d="M3 15h4" />
					<path d="M14 10v6l4-3-4-3z" />
				</svg>
				<span>Playlists</span>
			</a>
			{#if isAdmin}
				<a
					href="/scheduler"
					class="mobile-menu-item"
					class:active={isActive('/scheduler')}
					onclick={() => (mobileMenuOpen = false)}
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 20 20"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<circle cx="10" cy="10" r="7" />
						<path d="M10 6v4l3 2" />
					</svg>
					<span>Scheduler</span>
				</a>
			{/if}
		</div>
	{/if}
</nav>

<style>
	/* Desktop sidebar */
	.sidebar {
		position: fixed;
		top: 0;
		left: 0;
		width: 240px;
		height: 100vh;
		background: var(--color-bg-secondary);
		border-right: 1px solid var(--color-border-default);
		display: flex;
		flex-direction: column;
		z-index: 100;
		overflow-y: auto;
		/* Keep the wheel inside the sidebar: without this, scrolling over the
		   sidebar chains to the document and scrolls the main content instead. */
		overscroll-behavior: contain;
		transition: width 0.2s ease;
	}

	.sidebar.collapsed {
		width: 64px;
	}

	.sidebar-header {
		padding: var(--spacing-lg) var(--spacing-lg) var(--spacing-md);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-sm);
	}

	.sidebar.collapsed .sidebar-header {
		padding: var(--spacing-lg) var(--spacing-sm) var(--spacing-md);
		justify-content: center;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	.logo {
		text-decoration: none;
		display: block;
		min-width: 0;
	}

	.logo h1 {
		font-size: var(--font-size-2xl);
		background: linear-gradient(135deg, var(--color-accent-secondary), var(--color-accent-primary));
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
		cursor: pointer;
		transition: opacity var(--transition-fast);
		white-space: nowrap;
	}

	.logo-collapsed {
		font-size: 1.25rem !important;
		text-align: center;
	}

	.logo:hover h1 {
		opacity: 0.8;
	}

	.logo-row {
		display: flex;
		align-items: center;
		gap: 6px;
		position: relative;
	}

	.update-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: rgba(34, 197, 94, 0.15);
		color: var(--color-status-success, #22c55e);
		flex-shrink: 0;
		transition: all var(--transition-fast);
		text-decoration: none;
	}

	.update-badge:hover {
		background: rgba(34, 197, 94, 0.3);
	}

	.update-dot {
		position: absolute;
		top: -2px;
		right: -6px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--color-status-success, #22c55e);
	}

	.collapse-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border-radius: var(--radius-md);
		background: transparent;
		border: 1px solid transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: all var(--transition-fast);
		flex-shrink: 0;
	}

	.collapse-btn:hover {
		color: var(--color-text-primary);
		background: var(--color-overlay-white-08);
		border-color: var(--color-border-default);
	}

	.sidebar-nav {
		flex: 1;
		padding: var(--spacing-sm) var(--spacing-sm);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-lg);
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	.nav-group {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.nav-label {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-text-tertiary);
		padding: var(--spacing-sm) var(--spacing-md) var(--spacing-xs);
		user-select: none;
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: 10px 16px;
		border-radius: 8px;
		color: var(--color-text-secondary);
		text-decoration: none;
		font-size: 0.875rem;
		font-weight: 500;
		transition: all var(--transition-fast);
		white-space: nowrap;
		overflow: hidden;
	}

	.nav-extension-wrap {
		display: block;
	}

	.nav-extension-wrap :global(button.nav-item) {
		width: 100%;
	}

	.nav-extension-wrap.collapsed :global(.extension-menu-panel) {
		left: calc(100% + 8px);
		top: 0;
	}

	.nav-extension-wrap.collapsed :global(.chev) {
		display: none;
	}

	.sidebar.collapsed .nav-item {
		justify-content: center;
		padding: 10px;
	}

	.nav-item:hover {
		color: var(--color-text-primary);
		background: var(--color-overlay-white-05);
	}

	.nav-item.active {
		color: var(--color-accent-primary);
		background: rgba(59, 130, 246, 0.1);
	}

	.nav-icon {
		flex-shrink: 0;
	}

	.nav-text {
		line-height: 1;
	}

	/* Sidebar footer */
	.sidebar-footer {
		padding: var(--spacing-sm);
		border-top: 1px solid var(--color-border-default);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.connection-status {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border-radius: var(--radius-md);
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid var(--color-border-default);
		cursor: pointer;
		transition: all var(--transition-fast);
		font: inherit;
		color: inherit;
		width: 100%;
	}

	.sidebar.collapsed .connection-status {
		justify-content: center;
		padding: 8px;
	}

	.connection-status:hover {
		border-color: var(--color-accent-primary);
		background: var(--color-overlay-white-06);
	}

	.status-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--color-status-error);
		flex-shrink: 0;
	}

	.connection-status.connected .status-dot {
		background: var(--color-status-success);
		animation: pulse 2s infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}

	.status-label {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		white-space: nowrap;
	}

	.user-card {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: 8px 12px;
		border-radius: var(--radius-md);
		background: rgba(255, 255, 255, 0.03);
		overflow: hidden;
	}

	.sidebar.collapsed .user-card {
		justify-content: center;
		padding: 8px;
		flex-direction: column;
		gap: var(--spacing-lg);
	}

	.sidebar.collapsed .sidebar-footer {
		gap: var(--spacing-sm);
	}

	.user-avatar {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--color-accent-primary), var(--color-accent-hover));
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.75rem;
		font-weight: 600;
		color: white;
		flex-shrink: 0;
	}

	.user-email {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
		min-width: 0;
	}

	.signout-btn {
		background: transparent;
		border: none;
		color: var(--color-text-tertiary);
		padding: 4px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
		transition: all var(--transition-fast);
		flex-shrink: 0;
	}

	.signout-btn:hover {
		color: var(--color-text-primary);
		background: var(--color-overlay-white-05);
	}

	.signout-btn-collapsed {
		padding: 0;
	}

	/* Mobile bottom tab bar */
	.mobile-tabbar {
		display: none;
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		height: 60px;
		background: var(--color-bg-secondary);
		border-top: 1px solid var(--color-border-default);
		z-index: 100;
		align-items: center;
		justify-content: space-around;
		padding: 0 var(--spacing-xs);
	}

	.mobile-tab {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		flex: 1;
		padding: var(--spacing-xs) 0;
		color: var(--color-text-tertiary);
		text-decoration: none;
		background: none;
		border: none;
		cursor: pointer;
		transition: color var(--transition-fast);
		-webkit-tap-highlight-color: rgba(59, 130, 246, 0.1);
	}

	.mobile-tab:hover,
	.mobile-tab.active {
		color: var(--color-accent-primary);
	}

	.mobile-tab-icon {
		flex-shrink: 0;
	}

	.mobile-tab-label {
		font-size: 0.625rem;
		font-weight: 500;
		line-height: 1;
	}

	.mobile-menu-backdrop {
		position: fixed;
		inset: 0;
		z-index: 99;
	}

	.mobile-menu {
		position: absolute;
		bottom: calc(100% + var(--spacing-sm));
		right: var(--spacing-sm);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		padding: var(--spacing-xs);
		z-index: 101;
		min-width: 180px;
	}

	.mobile-menu-item {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		border-radius: var(--radius-md);
		color: var(--color-text-secondary);
		text-decoration: none;
		font-size: 0.875rem;
		font-weight: 500;
		transition: all var(--transition-fast);
	}

	.mobile-menu-item:hover {
		color: var(--color-text-primary);
		background: var(--color-overlay-white-05);
	}

	.mobile-menu-item.active {
		color: var(--color-accent-primary);
		background: rgba(59, 130, 246, 0.1);
	}

	@media (max-width: 768px) {
		.sidebar {
			display: none;
		}

		.mobile-tabbar {
			display: flex;
		}
	}
</style>
