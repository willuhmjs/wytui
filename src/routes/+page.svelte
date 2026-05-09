<script lang="ts">
	import { onMount } from 'svelte';
	import DownloadForm from '$lib/components/download/DownloadForm.svelte';
	import DownloadCard from '$lib/components/download/DownloadCard.svelte';
	import { getSSEState, onSSEEvent } from '$lib/stores/sse.svelte';
	import { showConfirm } from '$lib/stores/modal.svelte';
	import { addToast } from '$lib/stores/toast.svelte';

	let activeTab = $state<'downloads' | 'subscriptions' | 'monitors'>('downloads');
	let sseState = getSSEState();

	// Completed downloads
	let completedDownloads = $state<any[]>([]);
	let completedLoading = $state(false);
	let completedFilter = $state<'all' | 'cache' | 'library'>('all');
	let channelFilter = $state<string>('all');
	let channelSearch = $state('');
	let channelDropdownOpen = $state(false);
	let sortOption = $state<'newest' | 'oldest' | 'largest' | 'smallest' | 'longest' | 'shortest' | 'uploader'>('newest');
	let sortDropdownOpen = $state(false);
	let titleSearch = $state('');
	let selectionMode = $state(false);
	let selectedIds = $state<Set<string>>(new Set());
	let bulkActing = $state(false);

	let poolFilteredDownloads = $derived(
		completedFilter === 'all'
			? completedDownloads
			: completedDownloads.filter((d) => d.storagePool === completedFilter)
	);

	let availableChannels = $derived(
		[...new Set(poolFilteredDownloads.map((d) => d.uploader).filter(Boolean))].sort() as string[]
	);

	$effect(() => {
		if (channelFilter !== 'all' && !availableChannels.includes(channelFilter)) {
			channelFilter = 'all';
		}
	});

	let filteredChannelOptions = $derived(
		channelSearch
			? availableChannels.filter((c) => c.toLowerCase().includes(channelSearch.toLowerCase()))
			: availableChannels
	);

	let filteredCompletedDownloads = $derived.by(() => {
		let filtered = channelFilter === 'all'
			? poolFilteredDownloads
			: poolFilteredDownloads.filter((d) => d.uploader === channelFilter);

		if (titleSearch) {
			const q = titleSearch.toLowerCase();
			filtered = filtered.filter((d) => d.title?.toLowerCase().includes(q));
		}

		const sorted = [...filtered];
		switch (sortOption) {
			case 'oldest':
				sorted.sort((a, b) => new Date(a.completedAt || a.createdAt).getTime() - new Date(b.completedAt || b.createdAt).getTime());
				break;
			case 'newest':
				sorted.sort((a, b) => new Date(b.completedAt || b.createdAt).getTime() - new Date(a.completedAt || a.createdAt).getTime());
				break;
			case 'largest':
				sorted.sort((a, b) => Number(b.filesize || 0) - Number(a.filesize || 0));
				break;
			case 'smallest':
				sorted.sort((a, b) => Number(a.filesize || 0) - Number(b.filesize || 0));
				break;
			case 'longest':
				sorted.sort((a, b) => (b.duration || 0) - (a.duration || 0));
				break;
			case 'shortest':
				sorted.sort((a, b) => (a.duration || 0) - (b.duration || 0));
				break;
			case 'uploader':
				sorted.sort((a, b) => (a.uploader || '').localeCompare(b.uploader || ''));
				break;
		}
		return sorted;
	});

	// Subscriptions state
	let subscriptions = $state<any[]>([]);
	let subsLoading = $state(false);
	let checkingNow = $state<Set<string>>(new Set());
	let checkResult = $state<{ id: string; message: string } | null>(null);
	let showSubsForm = $state(false);
	let subFormUrl = $state('');
	let subFormProfileId = $state('');
	let subFormCheckInterval = $state(1800);
	let subFormAutoDownload = $state(true);
	let subFormSaveToLibrary = $state(false);
	let subFormOptions = $state({ sponsorblock: false, subtitles: false, metadata: false });

	// Subscription edit state
	let editingSub = $state<any | null>(null);
	let editSubName = $state('');
	let editSubUrl = $state('');
	let editSubProfileId = $state('');
	let editSubCheckInterval = $state(1800);
	let editSubAutoDownload = $state(true);
	let editSubSaveToLibrary = $state(false);
	let editSubOptions = $state({ sponsorblock: false, subtitles: false, metadata: false });

	// Subscription backfill state
	let backfillDate = $state('');
	let showBackfillMenu = $state<string | null>(null);

	// Monitors state
	let monitors = $state<any[]>([]);
	let monitorsLoading = $state(false);
	let showMonitorsForm = $state(false);
	let monFormUrl = $state('');
	let monFormProfileId = $state('');
	let monFormType = $state('YOUTUBE_LIVE');
	let monFormAutoDownload = $state(true);
	let monFormOptions = $state({ sponsorblock: false, subtitles: false, metadata: false });

	// Monitor edit state
	let editingMonitor = $state<any | null>(null);
	let editMonName = $state('');
	let editMonUrl = $state('');
	let editMonType = $state('YOUTUBE_LIVE');
	let editMonProfileId = $state('');
	let editMonAutoDownload = $state(true);
	let editMonOptions = $state({ sponsorblock: false, subtitles: false, metadata: false });

	// Form error state
	let subFormError = $state('');
	let monFormError = $state('');

	// Shared state
	let profiles = $state<any[]>([]);
	let libraryConfigured = $state(false);
	let jellyfinUrl = $state('');
	let cacheUsage = $state<{ usedBytes: string; quotaBytes: string; percentage: number } | null>(null);
	let libraryUsage = $state<{ video: { usedBytes: string; count: number } | null; music: { usedBytes: string; count: number } | null } | null>(null);
	let clearingCache = $state(false);

	function buildOptionsFlags(opts: { sponsorblock: boolean; subtitles: boolean; metadata: boolean }, saveToLibrary = false): string[] {
		const flags: string[] = [];
		if (opts.sponsorblock) flags.push('--sponsorblock-remove', 'sponsor,selfpromo');
		if (opts.subtitles) flags.push('--write-subs', '--write-auto-subs', '--embed-subs', '--sub-langs', 'en');
		if (opts.metadata) flags.push('--embed-metadata', '--embed-chapters');
		if (saveToLibrary) flags.push('--write-thumbnail');
		return flags;
	}

	function parseOptionsFromFlags(flags: string[]): { sponsorblock: boolean; subtitles: boolean; metadata: boolean } {
		return {
			sponsorblock: flags.includes('--sponsorblock-remove'),
			subtitles: flags.includes('--write-subs') || flags.includes('--write-auto-subs'),
			metadata: flags.includes('--embed-metadata'),
		};
	}

	onMount(() => {
		loadProfiles();
		loadCompletedDownloads();
		loadCacheUsage();

		const unsubComplete = onSSEEvent('download:complete', ({ download }) => {
			const exists = completedDownloads.find((d) => d.id === download.id);
			if (!exists) {
				completedDownloads = [download, ...completedDownloads];
			}
			loadCacheUsage();
		});
		const unsubDeleted = onSSEEvent('download:deleted', ({ id }) => {
			completedDownloads = completedDownloads.filter((d) => d.id !== id);
			loadCacheUsage();
		});
		const unsubChecked = onSSEEvent('subscription:checked', ({ id, name, newVideos }) => {
			const message =
				newVideos > 0
					? `Found ${newVideos} new video${newVideos > 1 ? 's' : ''} for ${name}`
					: `No new videos for ${name}`;
			checkResult = { id, message };
			setTimeout(() => {
				if (checkResult?.id === id) checkResult = null;
			}, 5000);
			loadSubscriptions();
		});
		const unsubBackfill = onSSEEvent('subscription:backfill', ({ name, totalVideos, newVideos }) => {
			addToast('success', `Queued ${newVideos} new video${newVideos !== 1 ? 's' : ''} from ${name} (${totalVideos} total found)`);
		});
		const unsubMonitorLive = onSSEEvent('monitor:live', ({ name }) => {
			addToast('info', `Stream is live: ${name || 'Unknown'}`);
			loadMonitors();
		});
		const unsubMonitorUpdate = onSSEEvent('monitor:update', () => {
			loadMonitors();
		});

		return () => {
			unsubComplete();
			unsubDeleted();
			unsubChecked();
			unsubBackfill();
			unsubMonitorLive();
			unsubMonitorUpdate();
		};
	});

	async function loadCompletedDownloads() {
		completedLoading = true;
		try {
			const res = await fetch('/api/downloads?status=COMPLETED&limit=50');
			if (res.ok) {
				completedDownloads = await res.json();
			}
		} catch (e) {
			console.error('Failed to load completed downloads:', e);
		} finally {
			completedLoading = false;
		}
	}

	async function loadProfiles() {
		try {
			const [profilesRes, settingsRes] = await Promise.all([
				fetch('/api/profiles'),
				fetch('/api/settings'),
			]);
			if (profilesRes.ok) {
				profiles = await profilesRes.json();
				const defaultProfile = profiles.find((p) => p.isDefault);
				if (defaultProfile) {
					subFormProfileId = defaultProfile.id;
					monFormProfileId = defaultProfile.id;
				}
			}
			if (settingsRes.ok) {
				const settings = await settingsRes.json();
				libraryConfigured = !!settings.libraryPath;
				jellyfinUrl = settings.jellyfinUrl || '';
				if (libraryConfigured) {
					subFormSaveToLibrary = true;
				}
			}
		} catch (e) {
			console.error('Failed to load profiles:', e);
		}
	}

	async function loadCacheUsage() {
		try {
			const res = await fetch('/api/library/usage');
			if (res.ok) {
				const data = await res.json();
				cacheUsage = data.cache;
				libraryUsage = data.library;
			}
		} catch (e) {
			console.error('Failed to load usage:', e);
		}
	}

	async function clearCache() {
		const confirmed = await showConfirm(
			'Clear Cache',
			'This will delete all cached downloads. Library downloads will not be affected.',
			'Clear Cache'
		);
		if (!confirmed) return;

		clearingCache = true;
		try {
			await fetch('/api/library/clear', { method: 'POST' });
			await Promise.all([loadCompletedDownloads(), loadCacheUsage()]);
		} catch (e) {
			console.error('Failed to clear cache:', e);
		} finally {
			clearingCache = false;
		}
	}

	function toggleSelection(id: string) {
		const next = new Set(selectedIds);
		if (next.has(id)) next.delete(id); else next.add(id);
		selectedIds = next;
	}

	function selectAll() {
		selectedIds = new Set(filteredCompletedDownloads.map((d) => d.id));
	}

	function deselectAll() {
		selectedIds = new Set();
	}

	function exitSelectionMode() {
		selectionMode = false;
		selectedIds = new Set();
	}

	async function bulkDelete() {
		const count = selectedIds.size;
		const confirmed = await showConfirm(
			'Delete Selected',
			`Delete ${count} download${count !== 1 ? 's' : ''}? This cannot be undone.`,
			'Delete'
		);
		if (!confirmed) return;

		bulkActing = true;
		try {
			await Promise.all(
				[...selectedIds].map((id) => fetch(`/api/downloads/${id}`, { method: 'DELETE' }))
			);
			addToast('success', `Deleted ${count} download${count !== 1 ? 's' : ''}`);
			exitSelectionMode();
			await loadCompletedDownloads();
		} catch (e) {
			addToast('error', 'Failed to delete some downloads');
		} finally {
			bulkActing = false;
		}
	}

	async function bulkPromote() {
		const ids = [...selectedIds].filter((id) => {
			const d = completedDownloads.find((dl) => dl.id === id);
			return d?.storagePool === 'cache';
		});
		if (ids.length === 0) {
			addToast('info', 'No cache downloads selected to move');
			return;
		}
		bulkActing = true;
		try {
			await Promise.all(
				ids.map((id) => fetch(`/api/downloads/${id}/promote`, { method: 'POST' }))
			);
			addToast('success', `Moved ${ids.length} download${ids.length !== 1 ? 's' : ''} to library`);
			exitSelectionMode();
			await loadCompletedDownloads();
		} catch (e) {
			addToast('error', 'Failed to move some downloads');
		} finally {
			bulkActing = false;
		}
	}

	// Subscriptions functions
	async function loadSubscriptions() {
		subsLoading = true;
		try {
			const res = await fetch('/api/subscriptions');
			if (res.ok) {
				subscriptions = await res.json();
			}
		} catch (e) {
			console.error('Failed to load subscriptions:', e);
		} finally {
			subsLoading = false;
		}
	}

	async function handleSubsSubmit(e: Event) {
		e.preventDefault();
		subFormError = '';
		try {
			const res = await fetch('/api/subscriptions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					url: subFormUrl,
					name: subFormUrl,
					type: 'CHANNEL',
					profileId: subFormProfileId,
					checkInterval: subFormCheckInterval,
					autoDownload: subFormAutoDownload,
					saveToLibrary: subFormSaveToLibrary,
					customFlags: buildOptionsFlags(subFormOptions, subFormSaveToLibrary),
				}),
			});

			if (res.ok) {
				subFormUrl = '';
				subFormSaveToLibrary = false;
				subFormOptions = { sponsorblock: false, subtitles: false, metadata: false };
				showSubsForm = false;
				await loadSubscriptions();
			} else {
				const data = await res.json().catch(() => null);
				subFormError = data?.message || `Failed to create subscription (${res.status})`;
			}
		} catch (e) {
			subFormError = 'Failed to create subscription';
		}
	}

	async function toggleSubscription(id: string, enabled: boolean) {
		try {
			await fetch(`/api/subscriptions/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled: !enabled }),
			});
			await loadSubscriptions();
		} catch (e) {
			console.error('Failed to toggle subscription:', e);
		}
	}

	async function deleteSubscription(id: string) {
		const confirmed = await showConfirm(
			'Delete Subscription',
			'Are you sure you want to delete this subscription?',
			'Delete'
		);
		if (!confirmed) return;

		try {
			await fetch(`/api/subscriptions/${id}`, { method: 'DELETE' });
			await loadSubscriptions();
		} catch (e) {
			console.error('Failed to delete subscription:', e);
		}
	}

	async function checkNow(id: string) {
		if (checkingNow.has(id)) return;
		checkingNow = new Set([...checkingNow, id]);
		try {
			await fetch(`/api/subscriptions/${id}/check`, { method: 'POST' });
		} catch (e) {
			console.error('Failed to check subscription:', e);
		} finally {
			checkingNow = new Set([...checkingNow].filter((x) => x !== id));
		}
	}

	function startEditSub(sub: any) {
		editingSub = sub;
		editSubName = sub.name;
		editSubUrl = sub.url;
		editSubProfileId = sub.profileId;
		editSubCheckInterval = sub.checkInterval;
		editSubAutoDownload = sub.autoDownload;
		editSubSaveToLibrary = sub.saveToLibrary;
		editSubOptions = parseOptionsFromFlags(sub.customFlags || []);
	}

	function cancelEditSub() {
		editingSub = null;
	}

	async function saveEditSub() {
		if (!editingSub) return;
		try {
			const res = await fetch(`/api/subscriptions/${editingSub.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: editSubName,
					url: editSubUrl,
					profileId: editSubProfileId,
					checkInterval: editSubCheckInterval,
					autoDownload: editSubAutoDownload,
					saveToLibrary: editSubSaveToLibrary,
					customFlags: buildOptionsFlags(editSubOptions, editSubSaveToLibrary),
				}),
			});
			if (res.ok) {
				editingSub = null;
				await loadSubscriptions();
			}
		} catch (e) {
			console.error('Failed to update subscription:', e);
		}
	}

	async function backfillFromDate(id: string) {
		if (!backfillDate) return;
		try {
			await fetch(`/api/subscriptions/${id}/backfill`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ dateAfter: backfillDate }),
			});
			backfillDate = '';
			showBackfillMenu = null;
			activeTab = 'downloads';
		} catch (e) {
			console.error('Failed to backfill:', e);
		}
	}

	async function backfillAll(id: string) {
		const confirmed = await showConfirm(
			'Download All Videos',
			'This will download every video from this channel that hasn\'t been downloaded before. This could queue a large number of downloads.',
			'Download All'
		);
		if (!confirmed) return;
		try {
			await fetch(`/api/subscriptions/${id}/backfill`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			});
			showBackfillMenu = null;
			activeTab = 'downloads';
		} catch (e) {
			console.error('Failed to backfill:', e);
		}
	}

	function formatInterval(seconds: number): string {
		if (seconds < 60) return `${seconds}s`;
		if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
		if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
		return `${Math.floor(seconds / 86400)}d`;
	}

	function formatRelativeTime(date: string | Date): string {
		const ms = Date.now() - new Date(date).getTime();
		const seconds = Math.floor(ms / 1000);
		if (seconds < 60) return 'just now';
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		if (days < 30) return `${days}d ago`;
		const months = Math.floor(days / 30);
		return `${months}mo ago`;
	}

	// Monitors functions
	async function loadMonitors() {
		monitorsLoading = true;
		try {
			const res = await fetch('/api/monitors');
			if (res.ok) {
				monitors = await res.json();
			}
		} catch (e) {
			console.error('Failed to load monitors:', e);
		} finally {
			monitorsLoading = false;
		}
	}

	async function handleMonitorsSubmit(e: Event) {
		e.preventDefault();
		monFormError = '';
		try {
			const res = await fetch('/api/monitors', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					url: monFormUrl,
					name: monFormUrl,
					type: monFormType,
					profileId: monFormProfileId,
					autoDownload: monFormAutoDownload,
					customFlags: buildOptionsFlags(monFormOptions),
				}),
			});

			if (res.ok) {
				monFormUrl = '';
				monFormOptions = { sponsorblock: false, subtitles: false, metadata: false };
				showMonitorsForm = false;
				await loadMonitors();
			} else {
				const data = await res.json().catch(() => null);
				monFormError = data?.message || `Failed to create monitor (${res.status})`;
			}
		} catch (e) {
			monFormError = 'Failed to create monitor';
		}
	}

	async function toggleMonitor(id: string, enabled: boolean) {
		try {
			await fetch(`/api/monitors/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled: !enabled }),
			});
			await loadMonitors();
		} catch (e) {
			console.error('Failed to toggle monitor:', e);
		}
	}

	async function deleteMonitor(id: string) {
		const confirmed = await showConfirm(
			'Delete Monitor',
			'Are you sure you want to delete this monitor?',
			'Delete'
		);
		if (!confirmed) return;

		try {
			await fetch(`/api/monitors/${id}`, { method: 'DELETE' });
			await loadMonitors();
		} catch (e) {
			console.error('Failed to delete monitor:', e);
		}
	}

	function startEditMonitor(monitor: any) {
		editingMonitor = monitor;
		editMonName = monitor.name;
		editMonUrl = monitor.url;
		editMonType = monitor.type;
		editMonProfileId = monitor.profileId;
		editMonAutoDownload = monitor.autoDownload;
		editMonOptions = parseOptionsFromFlags(monitor.customFlags || []);
	}

	function cancelEditMonitor() {
		editingMonitor = null;
	}

	async function saveEditMonitor() {
		if (!editingMonitor) return;
		try {
			const res = await fetch(`/api/monitors/${editingMonitor.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: editMonName,
					url: editMonUrl,
					type: editMonType,
					profileId: editMonProfileId,
					autoDownload: editMonAutoDownload,
					customFlags: buildOptionsFlags(editMonOptions),
				}),
			});
			if (res.ok) {
				editingMonitor = null;
				await loadMonitors();
			}
		} catch (e) {
			console.error('Failed to update monitor:', e);
		}
	}

	function formatBytes(bytes: string): string {
		const b = Number(bytes);
		if (b === 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(b) / Math.log(1024));
		return `${(b / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
	}

	function formatWaitTime(seconds: number | null): string {
		if (!seconds) return 'Checking...';

		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		const secs = seconds % 60;

		if (hours > 0) return `${hours}h ${minutes}m`;
		if (minutes > 0) return `${minutes}m ${secs}s`;
		return `${secs}s`;
	}

	// Load data when switching tabs
	$effect(() => {
		if (activeTab === 'subscriptions') {
			loadSubscriptions();
		} else if (activeTab === 'monitors') {
			loadMonitors();
		}
	});
</script>

<svelte:head>
	<title>wytui - YouTube Downloader</title>
</svelte:head>

<div class="page">
	<!-- Tabs -->
	<div class="tabs">
		<button
			class="tab"
			class:active={activeTab === 'downloads'}
			onclick={() => (activeTab = 'downloads')}
		>
			Downloads{#if sseState.downloads.length > 0} <span class="tab-count">{sseState.downloads.length}</span>{/if}
		</button>
		<button
			class="tab"
			class:active={activeTab === 'subscriptions'}
			onclick={() => (activeTab = 'subscriptions')}
		>
			Subscriptions{#if subscriptions.length > 0} <span class="tab-count">{subscriptions.length}</span>{/if}
		</button>
		<button
			class="tab"
			class:active={activeTab === 'monitors'}
			onclick={() => (activeTab = 'monitors')}
		>
			Monitors{#if monitors.length > 0} <span class="tab-count">{monitors.length}</span>{/if}
		</button>
	</div>

	<!-- Downloads Tab -->
	{#if activeTab === 'downloads'}
		<div class="tab-content">
			<div class="downloads-layout">
				<div class="form-section">
					<h2>Download</h2>
					<DownloadForm />
				</div>

				<div class="active-section">
					<h2>Active ({sseState.downloads.length})</h2>
					{#if sseState.downloads.length === 0}
						<div class="empty-state">
							<p>No active downloads</p>
							<p class="text-muted">Paste a URL to get started</p>
						</div>
					{:else}
						<div class="downloads-list">
							{#each [...sseState.downloads].sort((a, b) => {
								const active = ['FETCHING_INFO', 'DOWNLOADING', 'PROCESSING'];
								const aActive = active.includes(a.status) ? 0 : 1;
								const bActive = active.includes(b.status) ? 0 : 1;
								if (aActive !== bActive) return aActive - bActive;
								return sseState.downloads.indexOf(b) - sseState.downloads.indexOf(a);
							}) as download (download.id)}
								<DownloadCard {download} {jellyfinUrl} />
							{/each}
						</div>
					{/if}
				</div>
			</div>

			{#if cacheUsage || libraryUsage}
				<div class="storage-row">
					{#if cacheUsage}
						<div class="storage-box">
							<div class="cache-usage-header">
								<div class="cache-usage-left">
									<span class="cache-usage-label">Cache</span>
									<span class="cache-usage-tooltip" data-tooltip="Downloads are stored in a temporary cache. When the cache fills up, the oldest downloads are automatically removed to free space. Save to Library to keep downloads permanently.">?</span>
								</div>
								<div class="cache-usage-right">
									<span class="cache-usage-value">{formatBytes(cacheUsage.usedBytes)} / {formatBytes(cacheUsage.quotaBytes)}</span>
									{#if Number(cacheUsage.usedBytes) > 0}
										<button class="btn btn-sm btn-secondary cache-clear-btn" onclick={clearCache} disabled={clearingCache}>
											{clearingCache ? 'Clearing...' : 'Clear'}
										</button>
									{/if}
								</div>
							</div>
							<div class="cache-usage-bar">
								<div class="cache-usage-fill" class:warning={cacheUsage.percentage > 80} class:critical={cacheUsage.percentage > 95} style="width: max({cacheUsage.percentage}%, {cacheUsage.percentage > 0 ? '4px' : '0px'})"></div>
							</div>
						</div>
					{/if}
					{#if libraryUsage?.video}
						<div class="storage-box">
							<div class="cache-usage-header">
								<div class="cache-usage-left">
									<span class="cache-usage-label">Video Library</span>
								</div>
								<div class="cache-usage-right">
									<span class="cache-usage-value">{formatBytes(libraryUsage.video.usedBytes)}</span>
									<span class="storage-count">{libraryUsage.video.count} file{libraryUsage.video.count !== 1 ? 's' : ''}</span>
								</div>
							</div>
						</div>
					{/if}
					{#if libraryUsage?.music}
						<div class="storage-box">
							<div class="cache-usage-header">
								<div class="cache-usage-left">
									<span class="cache-usage-label">Music Library</span>
								</div>
								<div class="cache-usage-right">
									<span class="cache-usage-value">{formatBytes(libraryUsage.music.usedBytes)}</span>
									<span class="storage-count">{libraryUsage.music.count} file{libraryUsage.music.count !== 1 ? 's' : ''}</span>
								</div>
							</div>
						</div>
					{/if}
				</div>
			{/if}

			<div class="section">
				<div class="section-header">
					<div class="section-header-left">
						<h2>Completed ({filteredCompletedDownloads.length})</h2>
						<button
							class="channel-dropdown-trigger"
							class:active={selectionMode}
							onclick={() => { if (selectionMode) exitSelectionMode(); else selectionMode = true; }}
						>
							{selectionMode ? 'Cancel' : 'Select'}
						</button>
					</div>
					<div class="section-header-right">
						<div class="tabs completed-filter">
							<button
								class="tab"
								class:active={completedFilter === 'all'}
								onclick={() => (completedFilter = 'all')}
							>
								All
							</button>
							<button
								class="tab"
								class:active={completedFilter === 'cache'}
								onclick={() => (completedFilter = 'cache')}
							>
								Cache
							</button>
							<button
								class="tab"
								class:active={completedFilter === 'library'}
								onclick={() => (completedFilter = 'library')}
							>
								Library
							</button>
						</div>
						{#if availableChannels.length > 1}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="channel-dropdown"
								onkeydown={(e) => { if (e.key === 'Escape') channelDropdownOpen = false; }}
							>
								<button
									class="channel-dropdown-trigger"
									onclick={() => { channelDropdownOpen = !channelDropdownOpen; channelSearch = ''; }}
								>
									<span class="channel-dropdown-label">{channelFilter === 'all' ? 'All channels' : channelFilter}</span>
									<svg width="12" height="12" viewBox="0 0 12 12" fill="none" class="channel-dropdown-chevron" class:open={channelDropdownOpen}>
										<path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
									</svg>
								</button>
								{#if channelDropdownOpen}
									<div class="channel-dropdown-menu">
										<input
											type="text"
											class="channel-dropdown-search"
											placeholder="Search channels..."
											bind:value={channelSearch}
											autofocus
										/>
										<div class="channel-dropdown-options">
											<button
												class="channel-dropdown-option"
												class:selected={channelFilter === 'all'}
												onclick={() => { channelFilter = 'all'; channelDropdownOpen = false; }}
											>
												All channels
											</button>
											{#each filteredChannelOptions as channel}
												<button
													class="channel-dropdown-option"
													class:selected={channelFilter === channel}
													onclick={() => { channelFilter = channel; channelDropdownOpen = false; }}
												>
													{channel}
												</button>
											{/each}
											{#if filteredChannelOptions.length === 0}
												<div class="channel-dropdown-empty">No channels found</div>
											{/if}
										</div>
									</div>
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<div class="channel-dropdown-backdrop" onclick={() => (channelDropdownOpen = false)}></div>
								{/if}
							</div>
						{/if}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="sort-dropdown"
							onkeydown={(e) => { if (e.key === 'Escape') sortDropdownOpen = false; }}
						>
						<button
							class="channel-dropdown-trigger"
							onclick={() => (sortDropdownOpen = !sortDropdownOpen)}
						>
							<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
								<path d="M2 4h10M4 7h6M6 10h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
							</svg>
							<span class="channel-dropdown-label">{
								({ newest: 'Newest', oldest: 'Oldest', largest: 'Largest', smallest: 'Smallest', longest: 'Longest', shortest: 'Shortest', uploader: 'Uploader' } as Record<string, string>)[sortOption]
							}</span>
							<svg width="12" height="12" viewBox="0 0 12 12" fill="none" class="channel-dropdown-chevron" class:open={sortDropdownOpen}>
								<path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
							</svg>
						</button>
						{#if sortDropdownOpen}
							<div class="channel-dropdown-menu">
								<div class="channel-dropdown-options">
									{#each [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['largest', 'Largest first'], ['smallest', 'Smallest first'], ['longest', 'Longest first'], ['shortest', 'Shortest first'], ['uploader', 'Uploader A–Z']] as [value, label]}
										<button
											class="channel-dropdown-option"
											class:selected={sortOption === value}
											onclick={() => { sortOption = value as typeof sortOption; sortDropdownOpen = false; }}
										>
											{label}
										</button>
									{/each}
								</div>
							</div>
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div class="channel-dropdown-backdrop" onclick={() => (sortDropdownOpen = false)}></div>
						{/if}
					</div>
					</div>
				</div>
				<div class="completed-search">
					<svg class="search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
						<circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5"/>
						<path d="M11 11l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
					</svg>
					<input
						type="text"
						class="search-input"
						placeholder="Search by title..."
						bind:value={titleSearch}
					/>
					{#if titleSearch}
						<button class="search-clear" aria-label="Clear search" onclick={() => (titleSearch = '')}>
							<svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" /></svg>
						</button>
					{/if}
				</div>
				{#if completedLoading}
					<div class="loading">Loading downloads...</div>
				{:else if filteredCompletedDownloads.length === 0}
					<div class="empty-state">
						<p>{completedFilter === 'all' ? 'No completed downloads yet' : `No ${completedFilter} downloads`}</p>
						<p class="text-muted">{completedFilter === 'all' ? 'Downloads will appear here once they finish' : `Try changing your filters`}</p>
					</div>
				{:else}
					<div class="downloads-grid">
						{#each filteredCompletedDownloads as download (download.id)}
							<DownloadCard
								{download}
								{jellyfinUrl}
								{selectionMode}
								selected={selectedIds.has(download.id)}
								onToggleSelect={() => toggleSelection(download.id)}
							/>
						{/each}
					</div>
				{/if}

				{#if selectionMode && selectedIds.size > 0}
					<div class="bulk-bar">
						<span class="bulk-count">{selectedIds.size} selected</span>
						<div class="bulk-actions">
							<button class="btn btn-sm btn-secondary" onclick={() => { selectedIds.size === filteredCompletedDownloads.length ? deselectAll() : selectAll(); }}>
								{selectedIds.size === filteredCompletedDownloads.length ? 'Deselect All' : 'Select All'}
							</button>
							<button class="btn btn-sm btn-accent" onclick={bulkPromote} disabled={bulkActing}>
								Move to Library
							</button>
							<button class="btn btn-sm btn-danger" onclick={bulkDelete} disabled={bulkActing}>
								Delete
							</button>
						</div>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Subscriptions Tab -->
	{#if activeTab === 'subscriptions'}
		<div class="tab-content">
			<div class="tab-header">
				<div>
					<h2>Subscriptions</h2>
					<p class="text-muted">Monitor channels and auto-download new videos</p>
				</div>
				<button class="btn btn-primary" onclick={() => (showSubsForm = !showSubsForm)}>
					{showSubsForm ? 'Cancel' : 'Add Subscription'}
				</button>
			</div>

			{#if showSubsForm}
				<form class="form-card" onsubmit={handleSubsSubmit}>
					<div class="form-row">
						<div class="form-group">
							<label for="sub-url">Channel/Playlist URL</label>
							<input type="url" id="sub-url" bind:value={subFormUrl} required placeholder="https://www.youtube.com/@channel" />
						</div>
						<div class="form-group">
							<label for="sub-profile">Download Profile</label>
							<select id="sub-profile" bind:value={subFormProfileId} required>
								{#each profiles as profile}
									<option value={profile.id}>{profile.name}</option>
								{/each}
							</select>
						</div>
					</div>

					<div class="form-group">
						<label for="sub-interval">Check Interval</label>
						<select id="sub-interval" bind:value={subFormCheckInterval}>
							<option value={900}>Every 15 minutes</option>
							<option value={1800}>Every 30 minutes</option>
							<option value={3600}>Every hour</option>
							<option value={21600}>Every 6 hours</option>
							<option value={43200}>Every 12 hours</option>
							<option value={86400}>Every 24 hours</option>
						</select>
					</div>

					<div class="checkbox-row">
						<label class="checkbox-label">
							<input type="checkbox" bind:checked={subFormAutoDownload} />
							Auto-download new videos
						</label>
						{#if libraryConfigured}
							<label class="checkbox-label">
								<input
									type="checkbox"
									bind:checked={subFormSaveToLibrary}
									onchange={() => {
										if (subFormSaveToLibrary) {
											subFormOptions = { sponsorblock: true, subtitles: true, metadata: true };
										}
									}}
								/>
								Save to Library
							</label>
						{/if}
					</div>

					<div class="options-row">
						<span class="options-label">Options</span>
						<div class="options-chips">
							<button type="button" class="option-chip" class:active={subFormOptions.sponsorblock} onclick={() => subFormOptions.sponsorblock = !subFormOptions.sponsorblock}>SponsorBlock</button>
							<button type="button" class="option-chip" class:active={subFormOptions.subtitles} onclick={() => subFormOptions.subtitles = !subFormOptions.subtitles}>Subtitles</button>
							<button type="button" class="option-chip" class:active={subFormOptions.metadata} onclick={() => subFormOptions.metadata = !subFormOptions.metadata}>Metadata</button>
						</div>
					</div>

					{#if subFormError}
						<p class="form-error">{subFormError}</p>
					{/if}
					<button type="submit" class="btn btn-primary">Create Subscription</button>
				</form>
			{/if}

			{#if subsLoading}
				<div class="loading">Loading subscriptions...</div>
			{:else if subscriptions.length === 0}
				<div class="empty-state">
					<p>No subscriptions yet</p>
					<p class="text-muted">Add a channel to start monitoring for new videos</p>
				</div>
			{:else}
				<div class="content-grid">
					{#each subscriptions as sub}
						<div class="content-card">
							{#if editingSub?.id === sub.id}
								<div class="edit-form">
									<div class="form-row">
										<div class="form-group">
											<label>Name</label>
											<input type="text" bind:value={editSubName} />
										</div>
										<div class="form-group">
											<label>URL</label>
											<input type="url" bind:value={editSubUrl} />
										</div>
									</div>
									<div class="form-row">
										<div class="form-group">
											<label>Profile</label>
											<select bind:value={editSubProfileId}>
												{#each profiles as profile}
													<option value={profile.id}>{profile.name}</option>
												{/each}
											</select>
										</div>
										<div class="form-group">
											<label>Check Interval</label>
											<select bind:value={editSubCheckInterval}>
												<option value={900}>Every 15 minutes</option>
												<option value={1800}>Every 30 minutes</option>
												<option value={3600}>Every hour</option>
												<option value={21600}>Every 6 hours</option>
												<option value={43200}>Every 12 hours</option>
												<option value={86400}>Every 24 hours</option>
											</select>
										</div>
									</div>
									<div class="checkbox-row">
										<label class="checkbox-label">
											<input type="checkbox" bind:checked={editSubAutoDownload} />
											Auto-download
										</label>
										{#if libraryConfigured}
											<label class="checkbox-label">
												<input
													type="checkbox"
													bind:checked={editSubSaveToLibrary}
													onchange={() => {
														if (editSubSaveToLibrary) {
															editSubOptions = { sponsorblock: true, subtitles: true, metadata: true };
														}
													}}
												/>
												Save to Library
											</label>
										{/if}
									</div>
									<div class="options-row">
										<span class="options-label">Options</span>
										<div class="options-chips">
											<button type="button" class="option-chip" class:active={editSubOptions.sponsorblock} onclick={() => editSubOptions.sponsorblock = !editSubOptions.sponsorblock}>SponsorBlock</button>
											<button type="button" class="option-chip" class:active={editSubOptions.subtitles} onclick={() => editSubOptions.subtitles = !editSubOptions.subtitles}>Subtitles</button>
											<button type="button" class="option-chip" class:active={editSubOptions.metadata} onclick={() => editSubOptions.metadata = !editSubOptions.metadata}>Metadata</button>
										</div>
									</div>
									<div class="actions">
										<button class="btn btn-sm btn-primary" onclick={saveEditSub}>Save</button>
										<button class="btn btn-sm btn-secondary" onclick={cancelEditSub}>Cancel</button>
									</div>
								</div>
							{:else}
								<div class="card-header">
									<h3>{sub.name}</h3>
									<span class="status" class:enabled={sub.enabled}>
										{sub.enabled ? 'Active' : 'Paused'}
									</span>
								</div>

								<p class="url">{sub.url}</p>

								<div class="meta">
									<span>Profile: {sub.profile.name}</span>
									<span>Check: {formatInterval(sub.checkInterval)}</span>
									{#if sub.videoCount}
										<span>{sub.videoCount} video{sub.videoCount !== 1 ? 's' : ''}</span>
									{/if}
									{#if sub.saveToLibrary}
										<span class="library-tag">Library</span>
									{/if}
									{#if sub.customFlags?.includes('--sponsorblock-remove')}
										<span class="option-tag">SB</span>
									{/if}
									{#if sub.customFlags?.includes('--write-subs')}
										<span class="option-tag">Subs</span>
									{/if}
									{#if sub.customFlags?.includes('--embed-metadata')}
										<span class="option-tag">Meta</span>
									{/if}
								</div>

								{#if sub.lastChecked || sub.lastVideoDate}
									<p class="text-muted text-sm">
										{#if sub.lastChecked}Last checked: {new Date(sub.lastChecked).toLocaleString()}{/if}
										{#if sub.lastChecked && sub.lastVideoDate} · {/if}
										{#if sub.lastVideoDate}Latest video: {formatRelativeTime(sub.lastVideoDate)}{/if}
									</p>
								{/if}

								{#if checkResult && checkResult.id === sub.id}
									<p class="check-result">{checkResult.message}</p>
								{/if}

								<div class="actions">
									<button
										class="btn btn-sm btn-primary"
										onclick={() => checkNow(sub.id)}
										disabled={checkingNow.has(sub.id)}
									>
										{checkingNow.has(sub.id) ? 'Checking...' : 'Check Now'}
									</button>
									<button class="btn btn-sm btn-secondary" onclick={() => startEditSub(sub)}>
										Edit
									</button>
									<button
										class="btn btn-sm btn-secondary"
										onclick={() => toggleSubscription(sub.id, sub.enabled)}
									>
										{sub.enabled ? 'Pause' : 'Resume'}
									</button>
									<button
										class="btn btn-sm btn-secondary"
										onclick={() => (showBackfillMenu = showBackfillMenu === sub.id ? null : sub.id)}
									>
										{showBackfillMenu === sub.id ? 'Close' : 'Backfill'}
									</button>
									<button class="btn btn-sm btn-danger" onclick={() => deleteSubscription(sub.id)}>
										Delete
									</button>
								</div>

								{#if showBackfillMenu === sub.id}
									<div class="backfill-menu">
										<div class="backfill-option">
											<label for="backfill-date-{sub.id}">Download videos uploaded after:</label>
											<div class="backfill-date-row">
												<input type="date" id="backfill-date-{sub.id}" bind:value={backfillDate} />
												<button
													class="btn btn-sm btn-primary"
													disabled={!backfillDate}
													onclick={() => backfillFromDate(sub.id)}
												>
													Go
												</button>
											</div>
										</div>
										<div class="backfill-divider"></div>
										<button
											class="btn btn-sm btn-primary"
											style="width: 100%;"
											onclick={() => backfillAll(sub.id)}
										>
											Download Entire Channel
										</button>
									</div>
								{/if}
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Monitors Tab -->
	{#if activeTab === 'monitors'}
		<div class="tab-content">
			<div class="tab-header">
				<div>
					<h2>Livestream Monitors</h2>
					<p class="text-muted">Monitor livestreams and auto-download when they go live</p>
				</div>
				<button class="btn btn-primary" onclick={() => (showMonitorsForm = !showMonitorsForm)}>
					{showMonitorsForm ? 'Cancel' : 'Add Monitor'}
				</button>
			</div>

			{#if showMonitorsForm}
				<form class="form-card" onsubmit={handleMonitorsSubmit}>
					<div class="form-row">
						<div class="form-group">
							<label for="mon-url">Stream URL</label>
							<input type="url" id="mon-url" bind:value={monFormUrl} required placeholder="https://www.youtube.com/@channel/live" />
						</div>
						<div class="form-group">
							<label for="mon-type">Platform</label>
							<select id="mon-type" bind:value={monFormType}>
								<option value="YOUTUBE_LIVE">YouTube Live</option>
								<option value="TWITCH">Twitch</option>
							</select>
						</div>
					</div>

					<div class="form-group">
						<label for="mon-profile">Download Profile</label>
						<select id="mon-profile" bind:value={monFormProfileId} required>
							{#each profiles as profile}
								<option value={profile.id}>{profile.name}</option>
							{/each}
						</select>
					</div>

					<label class="checkbox-label">
						<input type="checkbox" bind:checked={monFormAutoDownload} />
						Auto-download when live
					</label>

					<div class="options-row">
						<span class="options-label">Options</span>
						<div class="options-chips">
							<button type="button" class="option-chip" class:active={monFormOptions.sponsorblock} onclick={() => monFormOptions.sponsorblock = !monFormOptions.sponsorblock}>SponsorBlock</button>
							<button type="button" class="option-chip" class:active={monFormOptions.subtitles} onclick={() => monFormOptions.subtitles = !monFormOptions.subtitles}>Subtitles</button>
							<button type="button" class="option-chip" class:active={monFormOptions.metadata} onclick={() => monFormOptions.metadata = !monFormOptions.metadata}>Metadata</button>
						</div>
					</div>

					{#if monFormError}
						<p class="form-error">{monFormError}</p>
					{/if}
					<button type="submit" class="btn btn-primary">Create Monitor</button>
				</form>
			{/if}

			{#if monitorsLoading}
				<div class="loading">Loading monitors...</div>
			{:else if monitors.length === 0}
				<div class="empty-state">
					<p>No monitors yet</p>
					<p class="text-muted">Add a livestream URL to start monitoring</p>
				</div>
			{:else}
				<div class="content-grid">
					{#each monitors as monitor}
						<div class="content-card" class:live={monitor.isLive}>
							{#if editingMonitor?.id === monitor.id}
								<div class="edit-form">
									<div class="form-row">
										<div class="form-group">
											<label>URL</label>
											<input type="url" bind:value={editMonUrl} />
										</div>
										<div class="form-group">
											<label>Platform</label>
											<select bind:value={editMonType}>
												<option value="YOUTUBE_LIVE">YouTube Live</option>
												<option value="TWITCH">Twitch</option>
											</select>
										</div>
									</div>
									<div class="form-group">
										<label>Profile</label>
										<select bind:value={editMonProfileId}>
											{#each profiles as profile}
												<option value={profile.id}>{profile.name}</option>
											{/each}
										</select>
									</div>
									<label class="checkbox-label">
										<input type="checkbox" bind:checked={editMonAutoDownload} />
										Auto-download when live
									</label>
									<div class="options-row">
										<span class="options-label">Options</span>
										<div class="options-chips">
											<button type="button" class="option-chip" class:active={editMonOptions.sponsorblock} onclick={() => editMonOptions.sponsorblock = !editMonOptions.sponsorblock}>SponsorBlock</button>
											<button type="button" class="option-chip" class:active={editMonOptions.subtitles} onclick={() => editMonOptions.subtitles = !editMonOptions.subtitles}>Subtitles</button>
											<button type="button" class="option-chip" class:active={editMonOptions.metadata} onclick={() => editMonOptions.metadata = !editMonOptions.metadata}>Metadata</button>
										</div>
									</div>
									<div class="actions">
										<button class="btn btn-sm btn-primary" onclick={saveEditMonitor}>Save</button>
										<button class="btn btn-sm btn-secondary" onclick={cancelEditMonitor}>Cancel</button>
									</div>
								</div>
							{:else}
								<div class="card-header">
									<h3>{monitor.name}</h3>
									{#if monitor.isLive}
										<span class="live-badge">LIVE</span>
									{:else if monitor.enabled}
										<span class="status enabled">Monitoring</span>
									{:else}
										<span class="status">Paused</span>
									{/if}
								</div>

								<p class="url">{monitor.url}</p>

								<div class="meta">
									<span>{monitor.type === 'TWITCH' ? 'Twitch' : 'YouTube Live'}</span>
									<span>Profile: {monitor.profile.name}</span>
								</div>

								{#if monitor.waitTime && !monitor.isLive}
									<div class="wait-info">
										<span class="label">Goes live in:</span>
										<span class="time">{formatWaitTime(monitor.waitTime)}</span>
									</div>
								{/if}

								{#if monitor.liveDate && !monitor.isLive}
									<p class="text-muted text-sm">
										Expected: {new Date(monitor.liveDate).toLocaleString()}
									</p>
								{/if}

								{#if monitor.lastChecked}
									<p class="text-muted text-sm">
										Last checked: {new Date(monitor.lastChecked).toLocaleString()}
									</p>
								{/if}

								<div class="actions">
									<button class="btn btn-sm btn-secondary" onclick={() => startEditMonitor(monitor)}>
										Edit
									</button>
									<button
										class="btn btn-sm btn-secondary"
										onclick={() => toggleMonitor(monitor.id, monitor.enabled)}
									>
										{monitor.enabled ? 'Pause' : 'Resume'}
									</button>
									<button class="btn btn-sm btn-danger" onclick={() => deleteMonitor(monitor.id)}>
										Delete
									</button>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.page {
		max-width: 1400px;
		margin: 0 auto;
		width: 100%;
	}

	.tabs {
		display: flex;
		justify-content: center;
		gap: 4px;
		margin-bottom: var(--spacing-2xl);
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: 4px;
		width: fit-content;
		margin-left: auto;
		margin-right: auto;
	}

	.tab {
		padding: var(--spacing-sm) var(--spacing-xl);
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		font-weight: 500;
		font-size: 0.875rem;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.tab:hover:not(.active) {
		color: var(--text-primary);
		background: rgba(255, 255, 255, 0.05);
	}

	.tab-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: 9px;
		background: rgba(255, 255, 255, 0.12);
		font-size: 0.7rem;
		font-weight: 600;
		line-height: 1;
	}

	.tab.active .tab-count {
		background: rgba(255, 255, 255, 0.25);
	}

	.tab.active {
		background: var(--accent-primary);
		color: #fff;
		font-weight: 600;
	}

	.tab-content {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-2xl);
	}

	.tab-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: var(--spacing-lg);
	}

	.tab-header h2 {
		margin-bottom: var(--spacing-xs);
	}

	.tab-header p {
		margin-top: var(--spacing-xs);
	}

	.downloads-layout {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-xl);
		align-items: start;
	}

	.form-section {
		align-self: start;
	}

	.form-section h2 {
		margin-bottom: var(--spacing-lg);
	}

	.active-section {
		min-width: 0;
	}

	.active-section h2 {
		margin-bottom: var(--spacing-lg);
	}

	.downloads-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-lg);
		max-height: 70vh;
		overflow-y: auto;
	}

	.section {
		margin-bottom: var(--spacing-xl);
		width: 100%;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-lg);
		flex-wrap: wrap;
	}

	.section-header-left {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.section-header-right {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.section-header h2 {
		margin-bottom: 0;
	}

	.completed-filter {
		margin-bottom: 0;
		margin-left: 0;
		margin-right: 0;
	}

	.completed-filter .tab {
		padding: var(--spacing-xs) var(--spacing-md);
		font-size: 0.8rem;
	}

	.channel-dropdown {
		position: relative;
	}

	.channel-dropdown-trigger {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-xs) var(--spacing-md);
		background: var(--bg-tertiary);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: var(--border-radius-md);
		color: var(--text-primary);
		font-size: 0.85rem;
		cursor: pointer;
		white-space: nowrap;
		transition: border-color 0.15s;
	}

	.channel-dropdown-trigger:hover {
		border-color: rgba(255, 255, 255, 0.2);
	}

	.channel-dropdown-trigger.active {
		background: var(--accent-primary);
		border-color: var(--accent-primary);
		color: #fff;
	}

	.channel-dropdown-chevron {
		transition: transform 0.15s;
	}

	.channel-dropdown-chevron.open {
		transform: rotate(180deg);
	}

	.channel-dropdown-menu {
		position: absolute;
		top: calc(100% + 4px);
		right: 0;
		min-width: 220px;
		background: var(--bg-tertiary);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: var(--border-radius-md);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		z-index: 100;
		overflow: hidden;
	}

	.channel-dropdown-search {
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		background: transparent;
		border: none;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--text-primary);
		font-size: 0.85rem;
		outline: none;
	}

	.channel-dropdown-search::placeholder {
		color: var(--text-secondary);
	}

	.channel-dropdown-options {
		max-height: 200px;
		overflow-y: auto;
		padding: var(--spacing-xs) 0;
	}

	.channel-dropdown-option {
		display: block;
		width: 100%;
		padding: var(--spacing-xs) var(--spacing-md);
		background: transparent;
		border: none;
		color: var(--text-primary);
		font-size: 0.85rem;
		text-align: left;
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.channel-dropdown-option:hover {
		background: rgba(255, 255, 255, 0.06);
	}

	.channel-dropdown-option.selected {
		color: var(--accent-primary);
	}

	.channel-dropdown-empty {
		padding: var(--spacing-sm) var(--spacing-md);
		color: var(--text-secondary);
		font-size: 0.85rem;
	}

	.channel-dropdown-backdrop {
		position: fixed;
		inset: 0;
		z-index: 99;
	}

	.sort-dropdown {
		position: relative;
	}

	.completed-search {
		position: relative;
		display: flex;
		align-items: center;
		margin-bottom: var(--spacing-md);
	}

	.search-icon {
		position: absolute;
		left: var(--spacing-md);
		color: var(--text-tertiary);
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md) var(--spacing-sm) calc(var(--spacing-md) + 24px);
		background: var(--bg-tertiary);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: var(--border-radius-md);
		color: var(--text-primary);
		font-size: 0.875rem;
		transition: border-color 0.15s;
	}

	.search-input:focus {
		outline: none;
		border-color: var(--accent-primary);
	}

	.search-input::placeholder {
		color: var(--text-tertiary);
	}

	.search-clear {
		position: absolute;
		right: var(--spacing-sm);
		display: flex;
		align-items: center;
		padding: 4px;
		background: transparent;
		border: none;
		color: var(--text-tertiary);
		cursor: pointer;
		border-radius: var(--radius-sm);
	}

	.search-clear:hover {
		color: var(--text-primary);
		background: rgba(255, 255, 255, 0.06);
	}

	.bulk-bar {
		position: sticky;
		bottom: var(--spacing-lg);
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--spacing-sm) var(--spacing-lg);
		background: var(--bg-tertiary);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: var(--border-radius-md);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		margin-top: var(--spacing-lg);
		z-index: 50;
	}

	.bulk-count {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-primary);
	}

	.bulk-actions {
		display: flex;
		gap: var(--spacing-sm);
	}

	.section h2 {
		margin-bottom: var(--spacing-lg);
	}

	.form-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: var(--spacing-xl);
		margin-bottom: var(--spacing-xl);
	}

	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-lg);
	}

	.form-group {
		display: flex;
		flex-direction: column;
	}

	label {
		margin-bottom: var(--spacing-sm);
		color: var(--text-secondary);
		font-size: 0.875rem;
		font-weight: 500;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		margin-bottom: var(--spacing-lg);
	}

	.checkbox-label input {
		width: auto;
	}

	.empty-state {
		text-align: center;
		padding: var(--spacing-2xl);
		background: var(--bg-secondary);
		border: 1px dashed var(--border);
		border-radius: var(--radius-lg);
	}

	.empty-state p {
		margin-bottom: var(--spacing-sm);
	}

	.loading {
		text-align: center;
		padding: var(--spacing-2xl);
		color: var(--text-secondary);
	}

	.downloads-grid,
	.content-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
		gap: var(--spacing-lg);
		width: 100%;
	}

	.content-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: var(--spacing-lg);
		transition: all var(--transition-normal);
	}

	.content-card:hover {
		border-color: var(--border-light);
		transform: translateY(-2px);
		box-shadow: var(--shadow-md);
	}

	.content-card.live {
		border-color: var(--error);
		background: rgba(239, 68, 68, 0.05);
	}

	.edit-form {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-lg);
	}

	.edit-form .form-row {
		margin-bottom: 0;
	}

	.edit-form .form-group {
		margin-bottom: 0;
	}

	.edit-form .checkbox-row {
		margin-bottom: 0;
	}

	.edit-form .checkbox-label {
		margin-bottom: 0;
	}

	.edit-form .actions {
		margin-top: 0;
	}

	.backfill-menu {
		margin-top: var(--spacing-md);
		padding: var(--spacing-md);
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	.backfill-option label {
		display: block;
		margin-bottom: var(--spacing-sm);
		font-size: 0.8125rem;
		color: var(--text-secondary);
		font-weight: 500;
	}

	.backfill-date-row {
		display: flex;
		gap: var(--spacing-sm);
		align-items: center;
	}

	.backfill-date-row input[type='date'] {
		flex: 1;
	}

	.backfill-divider {
		height: 1px;
		background: var(--border);
	}

	.card-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-md);
	}

	.card-header h3 {
		font-size: 1rem;
		flex: 1;
	}

	.status {
		padding: var(--spacing-xs) var(--spacing-sm);
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		font-weight: 600;
		background: var(--bg-tertiary);
		color: var(--text-secondary);
	}

	.status.enabled {
		background: rgba(16, 185, 129, 0.1);
		color: var(--success);
	}

	.live-badge {
		padding: var(--spacing-xs) var(--spacing-sm);
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		font-weight: 600;
		background: var(--error);
		color: white;
		animation: pulse 2s infinite;
	}

	.url {
		font-size: 0.875rem;
		color: var(--text-secondary);
		margin-bottom: var(--spacing-md);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-md);
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	.wait-info {
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: var(--bg-tertiary);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
		margin-bottom: var(--spacing-md);
	}

	.wait-info .label {
		font-size: 0.875rem;
		color: var(--text-secondary);
	}

	.wait-info .time {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--accent-primary);
	}

	.check-result {
		font-size: 0.85rem;
		color: var(--accent-primary);
		margin: var(--spacing-xs) 0 0;
	}

	.form-error {
		color: var(--error, #ef4444);
		font-size: 0.85rem;
		margin: var(--spacing-xs) 0;
	}

	.checkbox-row {
		display: flex;
		gap: var(--spacing-xl);
		margin-bottom: var(--spacing-lg);
	}

	.storage-row {
		display: flex;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-lg);
	}

	.storage-box {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: var(--spacing-md) var(--spacing-lg);
		flex: 1;
		min-width: 0;
	}

	.storage-count {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.cache-usage-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-sm);
	}

	.cache-usage-left {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.cache-usage-right {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.cache-usage-label {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-tertiary);
	}

	.cache-usage-tooltip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--bg-tertiary);
		color: var(--text-tertiary);
		font-size: 0.625rem;
		font-weight: 700;
		cursor: help;
		border: 1px solid var(--border);
		position: relative;
	}

	.cache-usage-tooltip::after {
		content: attr(data-tooltip);
		position: absolute;
		bottom: calc(100% + 8px);
		left: 50%;
		transform: translateX(-50%);
		background: var(--bg-tertiary);
		color: var(--text-primary);
		border: 1px solid var(--border-light);
		border-radius: var(--radius-md);
		padding: 8px 12px;
		font-size: 0.75rem;
		font-weight: 400;
		line-height: 1.4;
		width: 260px;
		white-space: normal;
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.15s ease;
		z-index: 10;
		box-shadow: var(--shadow-lg);
	}

	.cache-usage-tooltip:hover::after {
		opacity: 1;
	}

	.cache-usage-value {
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}

	.cache-clear-btn {
		padding: 2px 8px !important;
		font-size: 0.6875rem !important;
	}

	.library-tag {
		background: rgba(16, 185, 129, 0.15);
		color: var(--success);
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		font-weight: 600;
	}

	.option-tag {
		background: rgba(99, 102, 241, 0.15);
		color: var(--accent-primary);
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		font-weight: 600;
	}

	.options-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		margin-bottom: var(--spacing-md);
	}

	.options-label {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		text-transform: uppercase;
		font-weight: 600;
		letter-spacing: 0.05em;
		white-space: nowrap;
	}

	.options-chips {
		display: flex;
		gap: var(--spacing-xs);
		flex-wrap: wrap;
	}

	.option-chip {
		padding: var(--spacing-xs) var(--spacing-sm);
		background: var(--bg-tertiary);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		font-size: 0.8125rem;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.option-chip:hover {
		background: var(--bg-hover);
		border-color: var(--accent-dim);
	}

	.option-chip.active {
		background: rgba(99, 102, 241, 0.15);
		border-color: var(--accent-primary);
		color: var(--accent-primary);
	}

	.cache-usage-bar {
		height: 6px;
		background: var(--bg-tertiary);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.cache-usage-fill {
		height: 100%;
		background: var(--accent-primary);
		border-radius: var(--radius-sm);
		transition: width 0.3s ease;
	}

	.cache-usage-fill.warning {
		background: var(--warning);
	}

	.cache-usage-fill.critical {
		background: var(--error);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-sm);
		margin-top: var(--spacing-md);
	}

	@media (max-width: 768px) {
		.page {
			padding: 0 var(--spacing-sm);
		}

		.tabs {
			width: 100%;
			flex-wrap: nowrap;
			overflow-x: auto;
			-webkit-overflow-scrolling: touch;
			scrollbar-width: none;
			margin-bottom: var(--spacing-lg);
		}

		.tabs::-webkit-scrollbar {
			display: none;
		}

		.tab {
			padding: var(--spacing-sm) var(--spacing-md);
			font-size: 0.8125rem;
			white-space: nowrap;
			flex-shrink: 0;
		}

		.tab-header {
			flex-direction: column;
			gap: var(--spacing-md);
		}

		.tab-header .btn {
			width: 100%;
		}

		.storage-row {
			flex-direction: column;
		}

		.downloads-layout {
			grid-template-columns: 1fr;
			gap: var(--spacing-lg);
		}

		.downloads-grid,
		.content-grid {
			grid-template-columns: 1fr;
		}

		.form-row {
			grid-template-columns: 1fr;
		}

		.form-card {
			padding: var(--spacing-md);
		}

		.content-card {
			padding: var(--spacing-md);
		}

		.card-header h3 {
			font-size: 0.9375rem;
		}

		.actions {
			flex-wrap: wrap;
		}

		.backfill-menu {
			padding: var(--spacing-md);
		}

		.section h2,
		.active-section h2,
		.form-section h2 {
			font-size: 1.25rem;
		}

		.download-card .thumbnail {
			height: 140px;
		}

		.download-card .content {
			padding: var(--spacing-md);
		}
	}
</style>
