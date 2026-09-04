<script lang="ts">
	import { onMount } from 'svelte';
	import { showConfirm } from '$lib/stores/modal.svelte';
	import { addToast } from '$lib/stores/toast.svelte';
	import { csrfFetch } from '$lib/utils/fetch';
	import { trapFocus } from '$lib/utils/a11y';
	import PathBrowser from '$lib/components/ui/PathBrowser.svelte';
	import PasswordInput from '$lib/components/ui/PasswordInput.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import RefreshIcon from '$lib/components/icons/RefreshIcon.svelte';
	import ZapIcon from '$lib/components/icons/ZapIcon.svelte';
	import BellIcon from '$lib/components/icons/BellIcon.svelte';
	import UsersIcon from '$lib/components/icons/UsersIcon.svelte';
	import LockIcon from '$lib/components/icons/LockIcon.svelte';
	import ShieldIcon from '$lib/components/icons/ShieldIcon.svelte';
	import TrashIcon from '$lib/components/icons/TrashIcon.svelte';
	import ExternalLinkIcon from '$lib/components/icons/ExternalLinkIcon.svelte';
	import ImportSubscriptionsModal from '$lib/components/youtube/ImportSubscriptionsModal.svelte';
	import { getExtensionStoreUrl, REPO_URL } from '$lib/extension-links';

	// Store URL matches the current browser; resolved client-side in onMount.
	let extensionStoreUrl = $state(getExtensionStoreUrl());

	interface Props {
		data: {
			session: {
				user: {
					id: string;
					email: string;
					isAdmin: boolean;
				};
			} | null;
		};
	}

	let { data }: Props = $props();

	let settings = $state<any>(null);
	let settingsError = $state<string | null>(null);
	let users = $state<any[]>([]);

	// Users tab: search + pagination state.
	const USERS_PAGE_SIZE = 25;
	let userSearch = $state('');
	let usersOffset = $state(0);
	let usersTotal = $state(0);
	let usersLoading = $state(false);
	let userSearchTimeout: ReturnType<typeof setTimeout> | undefined;
	let loading = $state(true);
	let saving = $state(false);
	let settingsLoaded = $state(false);
	let settingsSnapshot = $state('');
	// Textarea mirror of settings.ytdlpExtraFlags — one flag per line.
	let ytdlpExtraFlagsText = $state('');
	let saveTimeout: ReturnType<typeof setTimeout> | undefined;
	let isAdmin = $derived(data.session?.user?.isAdmin ?? false);
	let activeTab = $state<'account' | 'app' | 'users'>('account');
	let activeSection = $state<string>('account');

	// Settings sections grouped into labeled categories. The flat list of
	// section ids (derived below) is used for scroll-spy / IntersectionObserver.
	const settingsGroups = [
		{
			label: 'Storage & Library',
			sections: [
				{ id: 'storage', label: 'Storage' },
				{ id: 'library-access', label: 'Access' },
			],
		},
		{
			label: 'Downloading',
			sections: [
				{ id: 'ytdlp', label: 'yt-dlp' },
				{ id: 'cookies', label: 'Cookies' },
				{ id: 'ryd', label: 'Return YouTube Dislike' },
				{ id: 'jellyfin', label: 'Jellyfin' },
				{ id: 'plex', label: 'Plex' },
			],
		},
		{
			label: 'Automation',
			sections: [
				{ id: 'auto-delete', label: 'Auto-Delete' },
				{ id: 'rescan', label: 'Rescan Library' },
				{ id: 'backup', label: 'Backup' },
				{ id: 'notifications', label: 'Notifications' },
			],
		},
		{
			label: 'Access & Privacy',
			sections: [
				{ id: 'ldap', label: 'LDAP' },
				{ id: 'proxy-auth', label: 'Reverse Proxy Auth' },
				{ id: 'oidc', label: 'OIDC / SSO' },
				{ id: 'auth-mode', label: 'Authentication' },
				{ id: 'privacy', label: 'Stats & Privacy' },
				{ id: 'config', label: 'Import / Export' },
			],
		},
	];

	// The Account and Users tabs get the same grouped quick-nav as App Settings.
	const accountGroups = [
		{
			label: 'Profile',
			sections: [
				{ id: 'account', label: 'Account' },
				{ id: 'api-keys', label: 'API Keys' },
			],
		},
		{
			label: 'Integrations',
			sections: [{ id: 'youtube', label: 'YouTube' }],
		},
	];

	const usersGroups = [
		{
			label: 'People',
			sections: [
				{ id: 'user-management', label: 'User Management' },
				{ id: 'library-requests', label: 'Library Requests' },
			],
		},
		{
			label: 'Maintenance',
			sections: [{ id: 'danger-zone', label: 'Danger Zone' }],
		},
	];

	// Quick-nav groups for whichever tab is showing.
	const navGroups = $derived(
		activeTab === 'account' ? accountGroups : activeTab === 'users' ? usersGroups : settingsGroups,
	);

	// Flat list of section ids for the current tab (used by the scroll-spy observer).
	const settingsSections = $derived(navGroups.flatMap((g) => g.sections));

	// Switching tabs swaps the quick-nav out, so point the scroll-spy at the new
	// tab's first section rather than leaving it on a section that is gone.
	function selectTab(tab: 'account' | 'app' | 'users') {
		if (activeTab === tab) return;
		activeTab = tab;
		const groups =
			tab === 'account' ? accountGroups : tab === 'users' ? usersGroups : settingsGroups;
		activeSection = groups[0].sections[0].id;
	}

	// Scroll-spy suppression: while a nav link is being clicked we smooth-scroll
	// and pin the active section so the observer doesn't flash through
	// intermediate sections. Cleared once the scroll settles (scrollend / fallback).
	let suppressSpy = false;
	let suppressSpyTimeout: ReturnType<typeof setTimeout> | undefined;

	function scrollToSection(sectionId: string) {
		const element = document.getElementById(sectionId);
		if (!element) return;
		suppressSpy = true;
		activeSection = sectionId;
		clearTimeout(suppressSpyTimeout);

		element.scrollIntoView({ behavior: 'smooth', block: 'start' });

		const clear = () => {
			suppressSpy = false;
			clearTimeout(suppressSpyTimeout);
			document.removeEventListener('scrollend', onScrollEnd);
		};
		const onScrollEnd = () => clear();
		// Prefer the native scrollend event (fires when smooth scroll settles);
		// fall back to a timeout for browsers without scrollend support.
		document.addEventListener('scrollend', onScrollEnd, { once: true });
		suppressSpyTimeout = setTimeout(clear, 600);
	}

	// Create user form
	let showCreateUser = $state(false);
	let newUser = $state({ email: '', password: '', name: '', isAdmin: false });
	let createUserError = $state('');

	// API Keys
	let apiKeys = $state<any[]>([]);
	let newKeyName = $state('');
	let newKeyResult = $state<string | null>(null);

	// YouTube
	let youtubeLink = $state<any>(null);
	let youtubeLoading = $state(false);
	let showImportModal = $state(false);

	// Library requests (admin)
	let libraryRequests = $state<any[]>([]);
	let loadingRequests = $state(false);
	let processingRequestId = $state<string | null>(null);

	// Per-user inline edit buffers (cache quota override), keyed by user id
	let userQuotaDrafts = $state<Record<string, string>>({});

	// Password change form
	let passwordChangeUserId = $state<string | null>(null);
	let passwordModalEl: HTMLDivElement | null = $state(null);

	$effect(() => {
		if (passwordChangeUserId && passwordModalEl) {
			const release = trapFocus(passwordModalEl);
			return release;
		}
	});
	let passwordForm = $state({
		newPassword: '',
		confirmPassword: '',
	});
	let passwordError = $state('');

	// Rescan
	let rescanning = $state(false);
	let rescanReport = $state<{
		missing: { id: string; title: string | null; filepath: string }[];
		ok: number;
	} | null>(null);
	let reconciling = $state(false);

	async function runRescan() {
		rescanning = true;
		rescanReport = null;
		try {
			const res = await fetch('/api/rescan');
			if (res.ok) {
				rescanReport = await res.json();
			} else {
				addToast('error', 'Rescan failed');
			}
		} catch {
			addToast('error', 'Rescan failed');
		} finally {
			rescanning = false;
		}
	}

	async function deleteRescanRecords(ids: string[]) {
		const confirmed = await showConfirm(
			'Delete Records',
			`Delete ${ids.length} download record${ids.length === 1 ? '' : 's'} with missing files? This cannot be undone.`,
			'Delete',
		);
		if (!confirmed) return;

		reconciling = true;
		try {
			const res = await csrfFetch('/api/rescan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ deleteRecords: ids }),
			});
			if (res.ok) {
				const result = await res.json();
				addToast('success', `Deleted ${result.deleted} record${result.deleted === 1 ? '' : 's'}`);
				// Re-run scan to refresh the list
				await runRescan();
			} else {
				addToast('error', 'Reconciliation failed');
			}
		} catch {
			addToast('error', 'Reconciliation failed');
		} finally {
			reconciling = false;
		}
	}

	async function markRescanMissing(ids: string[]) {
		reconciling = true;
		try {
			const res = await csrfFetch('/api/rescan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ markMissing: ids }),
			});
			if (res.ok) {
				const result = await res.json();
				addToast(
					'success',
					`Marked ${result.marked} record${result.marked === 1 ? '' : 's'} as deleted`,
				);
				await runRescan();
			} else {
				addToast('error', 'Failed to mark records');
			}
		} catch {
			addToast('error', 'Failed to mark records');
		} finally {
			reconciling = false;
		}
	}

	let observer: IntersectionObserver | null = null;
	let observerRaf: number | null = null;

	function setupScrollSpy() {
		teardownScrollSpy();
		// Sections scroll with the page (the document is the scrolling element),
		// so the observer uses the default viewport root.
		observer = new IntersectionObserver(
			(entries) => {
				// Don't fight a programmatic (nav-click) scroll in progress.
				if (suppressSpy) return;
				if (observerRaf) cancelAnimationFrame(observerRaf);
				observerRaf = requestAnimationFrame(() => {
					if (suppressSpy) return;
					let mostVisible = null;
					let maxRatio = 0;
					entries.forEach((entry) => {
						if (entry.isIntersecting && entry.intersectionRatio > maxRatio) {
							maxRatio = entry.intersectionRatio;
							mostVisible = entry.target.id;
						}
					});
					if (mostVisible && activeSection !== mostVisible) {
						activeSection = mostVisible;
					}
				});
			},
			{
				threshold: [0, 0.25, 0.5, 0.75, 1],
				rootMargin: '-20% 0px -70% 0px',
			},
		);
		settingsSections.forEach(({ id }) => {
			const element = document.getElementById(id);
			if (element) observer!.observe(element);
		});
	}

	function teardownScrollSpy() {
		if (observerRaf) cancelAnimationFrame(observerRaf);
		observer?.disconnect();
		observer = null;
	}

	// (Re)attach the scroll-spy whenever a tab is shown and its sections have been
	// rendered. Every tab has a quick-nav, so this re-runs on each tab switch.
	$effect(() => {
		const ready =
			activeTab === 'account' ||
			(isAdmin && !loading && (activeTab === 'users' || (activeTab === 'app' && !!settings)));
		if (ready) {
			// Wait for the sections to be in the DOM before observing.
			requestAnimationFrame(() => setupScrollSpy());
			return () => teardownScrollSpy();
		}
	});

	onMount(() => {
		// Re-resolve now that navigator is available (avoids an SSR hydration mismatch).
		extensionStoreUrl = getExtensionStoreUrl();
		loadApiKeys();
		loadYouTubeLink();
		if (isAdmin) {
			// Fire-and-forget: onMount must stay synchronous.
			void Promise.all([
				loadSettings(),
				loadUsers(),
				loadDiskInfo(),
				loadCookieStatus(),
				loadLibraryRequests(),
			]);
		}
		return () => teardownScrollSpy();
	});

	async function loadSettings() {
		loading = true;
		settingsError = null;
		try {
			const res = await fetch('/api/settings');
			if (res.ok) {
				settings = await res.json();
				settingsSnapshot = JSON.stringify(settings);
				ytdlpExtraFlagsText = (settings.ytdlpExtraFlags ?? []).join('\n');
				settingsLoaded = true;
				if (settings.cleanupEnabled && settings.jellyfinUrl && settings.jellyfinApiKey) {
					loadJellyfinUsers();
				}
			} else {
				const body = await res.json().catch(() => ({}));
				settingsError = body.error || `Failed to load settings (${res.status})`;
				console.error('Failed to load settings:', res.status, body);
			}
		} catch (e) {
			settingsError = 'Failed to load settings';
			console.error('Failed to load settings:', e);
		} finally {
			loading = false;
		}
	}

	async function loadUsers() {
		usersLoading = true;
		try {
			const params = new URLSearchParams({
				limit: String(USERS_PAGE_SIZE),
				offset: String(usersOffset),
			});
			if (userSearch.trim()) params.set('search', userSearch.trim());
			const res = await fetch(`/api/users?${params.toString()}`);
			if (res.ok) {
				const body = await res.json();
				users = body.users ?? [];
				usersTotal = body.total ?? 0;
			}
		} catch (e) {
			console.error('Failed to load users:', e);
		} finally {
			usersLoading = false;
		}
	}

	// Debounced search: reset to the first page and reload.
	function onUserSearchInput(value: string) {
		userSearch = value;
		clearTimeout(userSearchTimeout);
		userSearchTimeout = setTimeout(() => {
			usersOffset = 0;
			void loadUsers();
		}, 300);
	}

	function usersPrevPage() {
		if (usersOffset === 0) return;
		usersOffset = Math.max(0, usersOffset - USERS_PAGE_SIZE);
		void loadUsers();
	}

	function usersNextPage() {
		if (usersOffset + USERS_PAGE_SIZE >= usersTotal) return;
		usersOffset += USERS_PAGE_SIZE;
		void loadUsers();
	}

	// Reload the current page after a create/delete, clamping the offset if the
	// last item on the final page was removed.
	async function reloadUsersClamped() {
		if (usersOffset > 0 && usersOffset >= usersTotal - 1) {
			usersOffset = Math.max(0, usersOffset - USERS_PAGE_SIZE);
		}
		await loadUsers();
	}

	const SAVEABLE_FIELDS = [
		'maxConcurrentDownloads',
		'downloadPath',
		'ytdlpPath',
		'autoUpdateYtdlp',
		'updateCheckInterval',
		'enableArchive',
		'archivePath',
		'authMode',
		'libraryPath',
		'musicLibraryPath',
		'cacheQuotaBytes',
		'totalCacheQuotaBytes',
		'jellyfinUrl',
		'jellyfinApiKey',
		'maxDurationSeconds',
		'jellyfinExternalUrl',
		'plexUrl',
		'plexToken',
		'cleanupEnabled',
		'cleanupUserIds',
		'cleanupIntervalSeconds',
		'cleanupProfileTypes',
		'cleanupGraceHours',
		'autoDeleteWatchedDays',
		'appriseUrl',
		'notifyOnComplete',
		'notifyOnFail',
		'backupEnabled',
		'backupCron',
		'backupPath',
		'ldapEnabled',
		'ldapUrl',
		'ldapBindDn',
		'ldapBindPassword',
		'ldapSearchBase',
		'ldapSearchFilter',
		'oidcEnabled',
		'oidcIssuerUrl',
		'oidcClientId',
		'oidcClientSecret',
		'oidcDisplayName',
		'rateLimit',
		'sleepInterval',
		'proxyAuthEnabled',
		'proxyAuthHeader',
		'versionCheckEnabled',
		'rydEnabled',
		'libraryAccessMode',
		'statsVisibleToNonAdmins',
		'showTotalSizeToNonAdmins',
		'concurrentFragments',
		'useAria2c',
		'httpChunkSize',
		'generateJellyfinPosters',
		'ytdlpProxyUrl',
		'ytdlpExtraFlags',
	];

	let diskInfo = $state<{
		totalBytes: string;
		availableBytes: string;
	} | null>(null);
	let diskTotalGB = $derived(
		diskInfo ? Number(BigInt(diskInfo.totalBytes)) / (1024 * 1024 * 1024) : null,
	);
	let cacheQuotaGB = $derived(
		settings
			? Math.floor(Number(BigInt(settings.cacheQuotaBytes || '10737418240')) / (1024 * 1024 * 1024))
			: 10,
	);
	let cacheQuotaExceedsDisk = $derived(diskTotalGB !== null && cacheQuotaGB > diskTotalGB);
	// Global total cache cap: blank input = auto (disk − 5 GB).
	let totalCacheGB = $derived(
		settings && settings.totalCacheQuotaBytes
			? Math.floor(Number(BigInt(settings.totalCacheQuotaBytes)) / (1024 * 1024 * 1024))
			: '',
	);
	let autoTotalCacheGB = $derived(
		diskTotalGB !== null ? Math.max(0, Math.floor(diskTotalGB - 5)) : null,
	);
	let totalCacheExceedsDisk = $derived(
		diskTotalGB !== null && totalCacheGB !== '' && Number(totalCacheGB) > diskTotalGB,
	);
	let libraryEnabled = $derived(settings ? !!settings.libraryPath : false);
	let jellyfinEnabled = $derived(
		settings ? !!(settings.jellyfinUrl || settings.jellyfinApiKey) : false,
	);
	let plexEnabled = $derived(settings ? !!(settings.plexUrl || settings.plexToken) : false);
	let cleanupEnabled = $derived(settings ? !!settings.cleanupEnabled : false);

	async function loadDiskInfo() {
		try {
			const res = await fetch('/api/settings/disk');
			if (res.ok) {
				diskInfo = await res.json();
			}
		} catch {
			// disk info is best-effort
		}
	}

	let cleaningDownloads = $state(false);
	let downloadsCleanupResult = $state<string | null>(null);

	async function runDownloadsCleanup() {
		cleaningDownloads = true;
		downloadsCleanupResult = null;
		try {
			const res = await csrfFetch('/api/settings/cleanup', { method: 'POST' });
			if (res.ok) {
				const data = await res.json();
				const freedMB = Math.round(Number(BigInt(data.freedBytes)) / (1024 * 1024));
				downloadsCleanupResult =
					data.deletedFiles > 0 || data.husksRemoved > 0
						? `Removed ${data.deletedFiles} orphaned file(s)${freedMB > 0 ? ` (${freedMB} MB)` : ''} and ${data.husksRemoved} empty library folder(s)`
						: 'Nothing to clean — no orphaned files found';
				addToast('success', 'Cleanup complete');
				loadDiskInfo();
			} else {
				addToast('error', 'Cleanup failed');
			}
		} catch {
			addToast('error', 'Cleanup failed');
		} finally {
			cleaningDownloads = false;
		}
	}

	function updateCacheQuota(gb: number) {
		if (settings) {
			settings.cacheQuotaBytes = String(Math.round(gb * 1024 * 1024 * 1024));
		}
	}

	function updateTotalCacheQuota(raw: string) {
		if (!settings) return;
		const trimmed = raw.trim();
		settings.totalCacheQuotaBytes =
			trimmed === '' ? null : String(Math.round(parseFloat(trimmed) * 1024 * 1024 * 1024));
	}

	function toggleLibrary(enabled: boolean) {
		if (!settings) return;
		if (enabled) {
			settings.libraryPath = settings.libraryPath || '/media';
		} else {
			settings.libraryPath = null;
			settings.musicLibraryPath = null;
		}
	}

	let testingJellyfin = $state(false);
	let jellyfinTestResult = $state<{
		success: boolean;
		message: string;
	} | null>(null);
	let jellyfinUsers = $state<{ id: string; name: string }[]>([]);
	let loadingJellyfinUsers = $state(false);
	let jellyfinUsersError = $state<string | null>(null);

	async function loadJellyfinUsers() {
		if (!settings?.jellyfinUrl || !settings?.jellyfinApiKey) return;
		loadingJellyfinUsers = true;
		jellyfinUsersError = null;
		try {
			const res = await fetch('/api/settings/jellyfin-users');
			if (res.ok) {
				jellyfinUsers = await res.json();
				if (jellyfinUsers.length === 0) {
					jellyfinUsersError = 'No users found on Jellyfin server';
				}
			} else {
				const data = await res.json().catch(() => null);
				jellyfinUsersError = data?.message || `Failed to fetch users (${res.status})`;
			}
		} catch {
			jellyfinUsersError = 'Could not connect to Jellyfin';
			jellyfinUsers = [];
		} finally {
			loadingJellyfinUsers = false;
		}
	}

	function toggleCleanupUser(userId: string) {
		if (!settings) return;
		const current: string[] = settings.cleanupUserIds || [];
		if (current.includes(userId)) {
			settings.cleanupUserIds = current.filter((id: string) => id !== userId);
		} else {
			settings.cleanupUserIds = [...current, userId];
		}
	}

	// Cookie management
	let cookieStatus = $state<{ hasCookies: boolean; path: string | null }>({
		hasCookies: false,
		path: null,
	});
	let uploadingCookies = $state(false);
	let cookieError = $state<string | null>(null);

	async function loadCookieStatus() {
		try {
			const res = await fetch('/api/settings/cookies');
			if (res.ok) {
				cookieStatus = await res.json();
			}
		} catch {
			// best-effort
		}
	}

	async function uploadCookieFile(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		uploadingCookies = true;
		cookieError = null;

		try {
			const formData = new FormData();
			formData.append('file', file);

			const res = await csrfFetch('/api/settings/cookies', {
				method: 'POST',
				body: formData,
			});

			if (res.ok) {
				await loadCookieStatus();
				addToast('success', 'Cookie file uploaded');
			} else {
				const data = await res.json().catch(() => null);
				cookieError = data?.message || 'Failed to upload cookie file';
			}
		} catch {
			cookieError = 'Failed to upload cookie file';
		} finally {
			uploadingCookies = false;
			input.value = '';
		}
	}

	async function deleteCookieFile() {
		try {
			const res = await csrfFetch('/api/settings/cookies', {
				method: 'DELETE',
			});
			if (res.ok) {
				cookieStatus = { hasCookies: false, path: null };
				addToast('success', 'Cookie file removed');
			} else {
				addToast('error', 'Failed to remove cookie file');
			}
		} catch {
			addToast('error', 'Failed to remove cookie file');
		}
	}

	// Config export/import
	let exportingConfig = $state(false);
	let importingConfig = $state(false);
	let applyingImport = $state(false);
	let importError = $state<string | null>(null);
	let pendingImportYaml = $state<string | null>(null);
	let importPreview = $state<{
		changes: { field: string; from: unknown; to: unknown }[];
		skipped?: string[];
	} | null>(null);

	async function exportConfig() {
		exportingConfig = true;
		try {
			const res = await fetch('/api/settings/export');
			if (!res.ok) {
				addToast('error', 'Failed to export config');
				return;
			}
			const blob = await res.blob();
			const disposition = res.headers.get('Content-Disposition') || '';
			const match = disposition.match(/filename="([^"]+)"/);
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = match?.[1] || 'wytui-config.yaml';
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
		} catch {
			addToast('error', 'Failed to export config');
		} finally {
			exportingConfig = false;
		}
	}

	async function handleImportFile(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		importError = null;
		importingConfig = true;
		try {
			const yaml = await file.text();
			const res = await csrfFetch('/api/settings/import', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ yaml, confirm: false }),
			});
			const data = await res.json().catch(() => null);
			if (!res.ok) {
				importError = data?.message || 'Failed to parse config file';
				return;
			}
			pendingImportYaml = yaml;
			importPreview = data;
		} catch {
			importError = 'Failed to read config file';
		} finally {
			importingConfig = false;
			input.value = '';
		}
	}

	function closeImportPreview() {
		importPreview = null;
		pendingImportYaml = null;
		importError = null;
	}

	function formatSettingValue(value: unknown): string {
		if (value === null || value === undefined) return '(not set)';
		if (Array.isArray(value)) return value.length ? value.join(', ') : '(empty)';
		if (typeof value === 'boolean') return value ? 'enabled' : 'disabled';
		return String(value);
	}

	async function applyImport() {
		if (!pendingImportYaml) return;
		applyingImport = true;
		try {
			const res = await csrfFetch('/api/settings/import', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ yaml: pendingImportYaml, confirm: true }),
			});
			const data = await res.json().catch(() => null);
			if (!res.ok) {
				importError = data?.message || 'Failed to apply config';
				return;
			}
			settings = data.settings;
			addToast('success', 'Config imported');
			closeImportPreview();
		} catch {
			importError = 'Failed to apply config';
		} finally {
			applyingImport = false;
		}
	}

	let testingNotification = $state(false);
	let notificationTestResult = $state<{
		success: boolean;
		message: string;
	} | null>(null);

	async function testNotification() {
		testingNotification = true;
		notificationTestResult = null;
		try {
			const res = await csrfFetch('/api/notifications/test', {
				method: 'POST',
			});
			if (res.ok) {
				notificationTestResult = {
					success: true,
					message: 'Notification sent',
				};
			} else {
				const data = await res.json().catch(() => null);
				notificationTestResult = {
					success: false,
					message: data?.message || 'Failed to send',
				};
			}
		} catch {
			notificationTestResult = {
				success: false,
				message: 'Request failed',
			};
		} finally {
			testingNotification = false;
		}
	}

	function toggleJellyfin(enabled: boolean) {
		if (!settings) return;
		jellyfinTestResult = null;
		if (enabled) {
			settings.jellyfinUrl = settings.jellyfinUrl || 'http://jellyfin:8096';
			settings.jellyfinApiKey = settings.jellyfinApiKey || '';
		} else {
			settings.jellyfinUrl = null;
			settings.jellyfinApiKey = null;
			settings.jellyfinExternalUrl = null;
		}
	}

	async function testJellyfinConnection() {
		if (!settings?.jellyfinUrl || !settings?.jellyfinApiKey) return;
		testingJellyfin = true;
		jellyfinTestResult = null;
		try {
			const res = await csrfFetch('/api/settings/jellyfin-test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					url: settings.jellyfinUrl,
					apiKey: settings.jellyfinApiKey,
				}),
			});
			const data = await res.json();
			if (data.success) {
				jellyfinTestResult = {
					success: true,
					message: `Connected to ${data.serverName}`,
				};
			} else {
				jellyfinTestResult = { success: false, message: data.error };
			}
		} catch {
			jellyfinTestResult = { success: false, message: 'Request failed' };
		} finally {
			testingJellyfin = false;
		}
	}

	let testingPlex = $state(false);
	let plexTestResult = $state<{ success: boolean; message: string } | null>(null);

	function togglePlex(enabled: boolean) {
		if (!settings) return;
		plexTestResult = null;
		if (enabled) {
			settings.plexUrl = settings.plexUrl || 'http://localhost:32400';
			settings.plexToken = settings.plexToken || '';
		} else {
			settings.plexUrl = null;
			settings.plexToken = null;
		}
	}

	async function testPlexConnection() {
		if (!settings?.plexUrl || !settings?.plexToken) return;
		testingPlex = true;
		plexTestResult = null;
		try {
			const res = await csrfFetch('/api/settings/plex/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					url: settings.plexUrl,
					token: settings.plexToken,
				}),
			});
			const data = await res.json();
			if (data.success) {
				plexTestResult = {
					success: true,
					message: `Connected to ${data.serverName}`,
				};
			} else {
				plexTestResult = { success: false, message: data.error };
			}
		} catch {
			plexTestResult = { success: false, message: 'Request failed' };
		} finally {
			testingPlex = false;
		}
	}

	// Mirrors the scheme allow-list in settings-validation.ts so the debounced
	// auto-save never PATCHes a half-typed proxy URL (empty clears the setting).
	const YT_DLP_PROXY_SCHEMES = ['http:', 'https:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'];
	let ytdlpProxyUrlError = $derived.by(() => {
		if (!settings) return null;
		const value = (settings.ytdlpProxyUrl ?? '').trim();
		if (value === '') return null;
		try {
			if (YT_DLP_PROXY_SCHEMES.includes(new URL(value).protocol)) return null;
		} catch {
			// fall through to the error
		}
		return 'Needs a complete proxy URL, e.g. socks5://host:port (schemes: http, https, socks4, socks4a, socks5, socks5h)';
	});

	// aria2c only understands HTTP proxies; with a SOCKS proxy yt-dlp hands it
	// `--all-proxy socks5://...`, which aria2c rejects — every download fails.
	let aria2cSocksConflict = $derived.by(() => {
		if (!settings) return false;
		if (!settings.useAria2c) return false;
		const proxy = (settings.ytdlpProxyUrl ?? '').trim().toLowerCase();
		return proxy.startsWith('socks');
	});

	async function saveSettings() {
		saving = true;
		try {
			const payload: Record<string, any> = {};
			for (const key of SAVEABLE_FIELDS) {
				if (key in settings) {
					let value = settings[key];
					// Coerce empty string to null for optional text fields
					if (key === 'httpChunkSize' && value === '') {
						value = null;
					}
					if (key === 'ytdlpProxyUrl' && value === '') {
						value = null;
					}
					// A half-typed proxy URL stays out of the payload; the
					// auto-save effect re-saves it once it passes validation.
					if (key === 'ytdlpProxyUrl' && ytdlpProxyUrlError) {
						continue;
					}
					// aria2c + a SOCKS proxy breaks every download; keep that
					// combination out of the payload while the warning is showing.
					if (key === 'useAria2c' && aria2cSocksConflict) {
						continue;
					}
					payload[key] = value;
				}
			}
			const res = await csrfFetch('/api/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});
			if (!res.ok) {
				addToast('error', 'Failed to save settings');
			}
		} catch (e) {
			console.error('Failed to save settings:', e);
			addToast('error', 'Failed to save settings');
		} finally {
			saving = false;
		}
	}

	function debouncedSave() {
		clearTimeout(saveTimeout);
		saveTimeout = setTimeout(() => saveSettings(), 800);
	}

	$effect(() => {
		if (!settingsLoaded || !settings) return;
		const current = JSON.stringify(settings);
		if (current === settingsSnapshot) return;
		settingsSnapshot = current;
		debouncedSave();
	});

	async function toggleAdmin(user: any) {
		const confirmed = await showConfirm(
			`${user.isAdmin ? 'Demote' : 'Promote'} User`,
			`Are you sure you want to ${user.isAdmin ? 'demote' : 'promote'} ${user.name}?`,
			user.isAdmin ? 'Demote' : 'Promote',
		);
		if (!confirmed) return;

		try {
			const res = await csrfFetch(`/api/users/${user.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ isAdmin: !user.isAdmin }),
			});

			if (res.ok) {
				await loadUsers();
			} else {
				const data = await res.json();
				addToast('error', data.message || 'Failed to update user');
			}
		} catch (e: any) {
			addToast('error', e.message || 'Failed to update user');
		}
	}

	async function deleteUser(user: any) {
		const confirmed = await showConfirm(
			'Delete User',
			`Are you sure you want to delete ${user.name}? This action cannot be undone.`,
			'Delete',
			'Cancel',
		);
		if (!confirmed) return;

		try {
			const res = await csrfFetch(`/api/users/${user.id}`, {
				method: 'DELETE',
			});

			if (res.ok) {
				await reloadUsersClamped();
			} else {
				const data = await res.json();
				addToast('error', data.message || 'Failed to delete user');
			}
		} catch (e: any) {
			addToast('error', e.message || 'Failed to delete user');
		}
	}

	let clearingDownloads = $state(false);

	async function clearUserDownloads(user: any) {
		const confirmed = await showConfirm(
			'Clear Downloads',
			`Delete ALL of ${user.name}'s downloads (${user._count.downloads})? Files are removed from disk. This cannot be undone.`,
			'Clear Downloads',
			'Cancel',
		);
		if (!confirmed) return;

		try {
			const res = await csrfFetch('/api/admin/downloads/clear', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId: user.id }),
			});
			const body = await res.json().catch(() => ({}));
			if (res.ok) {
				addToast('success', `Cleared ${body.deleted ?? 0} download(s) for ${user.name}`);
				await reloadUsersClamped();
			} else {
				addToast('error', body.message || 'Failed to clear downloads');
			}
		} catch (e: any) {
			addToast('error', e.message || 'Failed to clear downloads');
		}
	}

	async function clearAllDownloads() {
		const confirmed = await showConfirm(
			'Clear All Downloads',
			'Delete EVERY user’s downloads across the entire app? Files are removed from disk. This cannot be undone.',
			'Clear Everything',
			'Cancel',
		);
		if (!confirmed) return;

		clearingDownloads = true;
		try {
			const res = await csrfFetch('/api/admin/downloads/clear', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			});
			const body = await res.json().catch(() => ({}));
			if (res.ok) {
				addToast('success', `Cleared ${body.deleted ?? 0} download(s)`);
				await reloadUsersClamped();
			} else {
				addToast('error', body.message || 'Failed to clear downloads');
			}
		} catch (e: any) {
			addToast('error', e.message || 'Failed to clear downloads');
		} finally {
			clearingDownloads = false;
		}
	}

	async function createUser() {
		createUserError = '';

		if (!newUser.email || !newUser.password || !newUser.name) {
			createUserError = 'All fields are required';
			return;
		}

		try {
			const res = await csrfFetch('/api/users', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(newUser),
			});

			if (res.ok) {
				await loadUsers();
				usersTotal += 1;
				showCreateUser = false;
				newUser = { email: '', password: '', name: '', isAdmin: false };
			} else {
				const data = await res.json();
				createUserError = data.message || 'Failed to create user';
			}
		} catch (e: any) {
			createUserError = e.message || 'Failed to create user';
		}
	}

	function openPasswordChange(userId: string) {
		passwordChangeUserId = userId;
		passwordForm = {
			newPassword: '',
			confirmPassword: '',
		};
		passwordError = '';
	}

	function closePasswordChange() {
		passwordChangeUserId = null;
		passwordForm = {
			newPassword: '',
			confirmPassword: '',
		};
		passwordError = '';
	}

	async function loadApiKeys() {
		try {
			const res = await fetch('/api/keys');
			if (res.ok) apiKeys = await res.json();
		} catch {
			// best-effort
		}
	}

	async function createApiKey() {
		if (!newKeyName.trim()) return;
		try {
			const res = await csrfFetch('/api/keys', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newKeyName }),
			});
			if (res.ok) {
				const data = await res.json();
				newKeyResult = data.key;
				newKeyName = '';
				await loadApiKeys();
				addToast('success', 'API key created');
			}
		} catch {
			addToast('error', 'Failed to create API key');
		}
	}

	async function revokeApiKey(id: string) {
		const confirmed = await showConfirm(
			'Revoke API Key',
			'This key will stop working immediately.',
			'Revoke',
		);
		if (!confirmed) return;
		try {
			const res = await csrfFetch(`/api/keys/${id}`, {
				method: 'DELETE',
			});
			if (res.ok) {
				await loadApiKeys();
				addToast('success', 'API key revoked');
			}
		} catch {
			addToast('error', 'Failed to revoke key');
		}
	}

	// YouTube functions
	async function loadYouTubeLink() {
		youtubeLoading = true;
		try {
			const res = await fetch('/api/youtube/link');
			if (res.ok) {
				youtubeLink = await res.json();
			}
		} catch {
			// best-effort
		} finally {
			youtubeLoading = false;
		}
	}

	async function updateYouTubeToggle(toggle: string, value: boolean) {
		try {
			const res = await csrfFetch('/api/youtube/link', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ [toggle]: value }),
			});
			if (res.ok) {
				const data = await res.json();
				if (data.needsRelink) {
					addToast('error', 'YouTube session expired — re-link via the extension');
					youtubeLink = { linked: false };
				} else {
					youtubeLink = data;
					addToast('success', 'Setting updated');
				}
			} else {
				addToast('error', 'Failed to update setting');
				await loadYouTubeLink();
			}
		} catch {
			addToast('error', 'Failed to update setting');
			await loadYouTubeLink();
		}
	}

	async function unlinkYouTube() {
		const confirmed = await showConfirm(
			'Unlink YouTube',
			'This will remove your YouTube connection. You can re-link anytime via the extension.',
			'Unlink',
		);
		if (!confirmed) return;
		try {
			const res = await csrfFetch('/api/youtube/link', {
				method: 'DELETE',
			});
			if (res.ok) {
				youtubeLink = { linked: false };
				addToast('success', 'YouTube unlinked');
			} else {
				addToast('error', 'Failed to unlink');
			}
		} catch {
			addToast('error', 'Failed to unlink');
		}
	}

	let syncingWatchLater = $state(false);
	let syncingHistory = $state(false);
	let exportingOPML = $state(false);
	let exportingCSV = $state(false);

	async function syncWatchLater() {
		if (syncingWatchLater) return;
		syncingWatchLater = true;
		try {
			const res = await csrfFetch('/api/youtube/watch-later', {
				method: 'POST',
			});
			if (res.ok) {
				const data = await res.json();
				if (data.needsRelink) {
					addToast('error', 'YouTube session expired — re-link via the extension');
					youtubeLink = { linked: false };
				} else {
					addToast('success', 'Playlists synced');
				}
			} else {
				addToast('error', 'Failed to sync playlists');
			}
		} catch {
			addToast('error', 'Failed to sync playlists');
		} finally {
			syncingWatchLater = false;
		}
	}

	async function syncHistory() {
		if (syncingHistory) return;
		syncingHistory = true;
		try {
			const res = await csrfFetch('/api/youtube/history', {
				method: 'POST',
			});
			if (res.ok) {
				const data = await res.json();
				if (data.needsRelink) {
					addToast('error', 'YouTube session expired — re-link via the extension');
					youtubeLink = { linked: false };
				} else {
					addToast('success', 'History synced');
				}
			} else {
				addToast('error', 'Failed to sync history');
			}
		} catch {
			addToast('error', 'Failed to sync history');
		} finally {
			syncingHistory = false;
		}
	}

	async function exportSubscriptions(format: 'opml' | 'csv') {
		if (format === 'opml') {
			if (exportingOPML) return;
			exportingOPML = true;
		} else {
			if (exportingCSV) return;
			exportingCSV = true;
		}
		try {
			const res = await fetch(`/api/youtube/subscriptions/export?format=${format}`);
			if (!res.ok) {
				addToast('error', `Failed to export ${format.toUpperCase()}`);
				return;
			}
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `subscriptions.${format}`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
		} catch {
			addToast('error', `Failed to export ${format.toUpperCase()}`);
		} finally {
			if (format === 'opml') exportingOPML = false;
			else exportingCSV = false;
		}
	}

	async function loadLibraryRequests() {
		loadingRequests = true;
		try {
			const res = await fetch('/api/library-requests?status=pending');
			if (res.ok) libraryRequests = await res.json();
		} catch {
			// best-effort
		} finally {
			loadingRequests = false;
		}
	}

	async function handleLibraryRequest(id: string, action: 'approve' | 'deny') {
		processingRequestId = id;
		try {
			const res = await csrfFetch(`/api/library-requests/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action }),
			});
			if (res.ok) {
				addToast('success', action === 'approve' ? 'Request approved' : 'Request denied');
				await loadLibraryRequests();
			} else {
				const body = await res.json().catch(() => null);
				addToast('error', body?.message || `Failed to ${action} request`);
			}
		} catch {
			addToast('error', `Failed to ${action} request`);
		} finally {
			processingRequestId = null;
		}
	}

	// Library access: null = inherit (default), true = allowed, false = denied.
	async function updateUserLibraryAccess(user: any, value: string) {
		const libraryAccess = value === 'default' ? null : value === 'allowed';
		try {
			const res = await csrfFetch(`/api/users/${user.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ libraryAccess }),
			});
			if (res.ok) {
				user.libraryAccess = libraryAccess;
				addToast('success', 'Library access updated');
			} else {
				const body = await res.json().catch(() => null);
				addToast('error', body?.message || 'Failed to update access');
				await loadUsers();
			}
		} catch {
			addToast('error', 'Failed to update access');
			await loadUsers();
		}
	}

	function userAccessValue(user: any): string {
		if (user.libraryAccess === null || user.libraryAccess === undefined) return 'default';
		return user.libraryAccess ? 'allowed' : 'denied';
	}

	// Cache quota override (GB in the UI, bytes on the wire; blank = default).
	function userQuotaDisplay(user: any): string {
		if (userQuotaDrafts[user.id] !== undefined) return userQuotaDrafts[user.id];
		if (!user.cacheQuotaBytes) return '';
		return String(Math.floor(Number(BigInt(user.cacheQuotaBytes)) / (1024 * 1024 * 1024)));
	}

	async function saveUserQuota(user: any) {
		const raw = (userQuotaDrafts[user.id] ?? '').trim();
		const cacheQuotaBytes =
			raw === '' ? null : String(Math.round(parseFloat(raw) * 1024 * 1024 * 1024));
		try {
			const res = await csrfFetch(`/api/users/${user.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ cacheQuotaBytes }),
			});
			if (res.ok) {
				user.cacheQuotaBytes = cacheQuotaBytes;
				delete userQuotaDrafts[user.id];
				addToast('success', 'Cache quota updated');
			} else {
				const body = await res.json().catch(() => null);
				addToast('error', body?.message || 'Failed to update quota');
			}
		} catch {
			addToast('error', 'Failed to update quota');
		}
	}

	async function changePassword() {
		passwordError = '';

		if (!passwordChangeUserId) return;

		// Validation
		if (!passwordForm.newPassword) {
			passwordError = 'New password is required';
			return;
		}

		if (passwordForm.newPassword !== passwordForm.confirmPassword) {
			passwordError = 'Passwords do not match';
			return;
		}

		try {
			const res = await csrfFetch(`/api/users/${passwordChangeUserId}/password`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					newPassword: passwordForm.newPassword,
				}),
			});

			if (res.ok) {
				addToast('success', 'Password changed successfully');
				closePasswordChange();
			} else {
				const data = await res.json();
				passwordError = data.message || 'Failed to change password';
			}
		} catch (e: any) {
			passwordError = e.message || 'Failed to change password';
		}
	}
</script>

<svelte:head>
	<title>Settings - wytui</title>
</svelte:head>

<div class="page">
	<div class="tabs-wrapper">
		<a href="/" class="back-arrow" aria-label="Back to home">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg
			>
		</a>
		<div class="tabs">
			<button
				class="tab"
				class:active={activeTab === 'account'}
				onclick={() => selectTab('account')}
			>
				Account
			</button>
			{#if isAdmin}
				<button class="tab" class:active={activeTab === 'app'} onclick={() => selectTab('app')}>
					App Settings
				</button>
				<button class="tab" class:active={activeTab === 'users'} onclick={() => selectTab('users')}>
					Admin
				</button>
			{/if}
		</div>
	</div>

	{#snippet quickNav()}
		<nav class="settings-nav">
			<div class="settings-nav-inner">
				<h3>Quick Navigation</h3>
				{#each navGroups as group}
					<div class="nav-group">
						<span class="nav-group-label">{group.label}</span>
						<ul>
							{#each group.sections as section}
								<li>
									<button
										class="nav-link"
										class:active={activeSection === section.id}
										onclick={() => scrollToSection(section.id)}
									>
										{section.label}
									</button>
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>
		</nav>
	{/snippet}

	{#if activeTab === 'account'}
		<div class="settings-container">
			{@render quickNav()}
			<div class="general-settings">
				<div class="settings-section" id="account">
					<h2>Account</h2>
					<p class="text-muted">Manage your account password.</p>
					<button
						class="btn btn-primary"
						onclick={() => openPasswordChange(data.session?.user?.id || '')}
					>
						Change Password
					</button>
				</div>

				<div class="settings-section api-keys-section" id="api-keys">
					<h2>API Keys</h2>
					<p class="text-muted">
						Create keys for programmatic access. Use as <code
							>Authorization: Bearer &lt;key&gt;</code
						>
					</p>

					{#if newKeyResult}
						<div class="info-box warning-box">
							<strong>Copy your key now — it won't be shown again:</strong>
							<code class="api-key-display">{newKeyResult}</code>
							<button
								class="btn btn-secondary btn-sm btn-icon"
								onclick={() => {
									navigator.clipboard.writeText(newKeyResult!);
									addToast('success', 'Copied');
								}}
								aria-label="Copy key"
								title="Copy key"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path
										d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
									/></svg
								>
							</button>
							<button
								class="btn btn-secondary btn-sm btn-icon"
								onclick={() => (newKeyResult = null)}
								aria-label="Dismiss"
								title="Dismiss"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg
								>
							</button>
						</div>
					{/if}

					<div class="create-key-form">
						<input type="text" bind:value={newKeyName} placeholder="Key name (e.g. CI/CD)" />
						<button
							class="btn btn-primary btn-sm"
							onclick={createApiKey}
							disabled={!newKeyName.trim()}>Create Key</button
						>
					</div>

					{#if apiKeys.length > 0}
						<div class="api-keys-list">
							{#each apiKeys as key}
								<div class="api-key-item">
									<div class="api-key-info">
										<span class="api-key-name">{key.name}</span>
										<code class="api-key-prefix">{key.keyPrefix}...</code>
										<span class="api-key-meta">
											Created {new Date(key.createdAt).toLocaleDateString()}
											{#if key.lastUsedAt}
												· Last used {new Date(key.lastUsedAt).toLocaleDateString()}
											{/if}
										</span>
									</div>
									<button
										class="btn btn-danger btn-sm btn-icon"
										onclick={() => revokeApiKey(key.id)}
										aria-label="Revoke key"
										title="Revoke key"
									>
										<svg
											xmlns="http://www.w3.org/2000/svg"
											width="16"
											height="16"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
											><polyline points="3 6 5 6 21 6" /><path
												d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
											/></svg
										>
									</button>
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-muted">No API keys yet.</p>
					{/if}
				</div>

				<div class="settings-section" id="youtube">
					<h2>YouTube</h2>
					<p class="text-muted">
						Link your YouTube account to sync watch history, subscriptions, and playlists.
					</p>

					{#if youtubeLoading}
						<p class="text-muted">Loading YouTube status...</p>
					{:else if youtubeLink?.linked}
						<div class="youtube-status">
							<p class="youtube-link-info">
								Linked as <strong>{youtubeLink.channelName}</strong> · updated {new Date(
									youtubeLink.cookieUpdatedAt,
								).toLocaleDateString()}
							</p>
						</div>

						{#if youtubeLink.lastError}
							<div class="info-box error-box">
								<strong>Session problem:</strong> your YouTube cookies are expired or authentication
								failed. Re-link your account using the wytui browser extension to keep syncing.
								<span class="error-detail">({youtubeLink.lastError})</span>
							</div>
						{/if}

						<div class="youtube-toggles">
							<label>
								<input
									type="checkbox"
									checked={youtubeLink.toggles?.syncWatchedToYouTube ?? false}
									onchange={(e) =>
										updateYouTubeToggle('syncWatchedToYouTube', e.currentTarget.checked)}
								/>
								Sync watched status to YouTube
							</label>
							<label>
								<input
									type="checkbox"
									checked={youtubeLink.toggles?.syncHistoryToWytui ?? false}
									onchange={(e) =>
										updateYouTubeToggle('syncHistoryToWytui', e.currentTarget.checked)}
								/>
								Sync YouTube history to wytui
							</label>
							<label>
								<input
									type="checkbox"
									checked={youtubeLink.toggles?.syncWatchLater ?? false}
									onchange={(e) => updateYouTubeToggle('syncWatchLater', e.currentTarget.checked)}
								/>
								Sync playlists
							</label>
							<label>
								<input
									type="checkbox"
									checked={youtubeLink.toggles?.useFeedForNewVideos ?? false}
									onchange={(e) =>
										updateYouTubeToggle('useFeedForNewVideos', e.currentTarget.checked)}
								/>
								Use feed for new videos
							</label>
						</div>

						<div class="youtube-actions">
							<button class="btn btn-primary" onclick={() => (showImportModal = true)}>
								Import Subscriptions
							</button>
							<button
								class="btn btn-secondary"
								onclick={() => exportSubscriptions('opml')}
								disabled={exportingOPML}
							>
								{exportingOPML ? 'Exporting…' : 'Export OPML'}
							</button>
							<button
								class="btn btn-secondary"
								onclick={() => exportSubscriptions('csv')}
								disabled={exportingCSV}
							>
								{exportingCSV ? 'Exporting…' : 'Export CSV'}
							</button>
							<button
								class="btn btn-secondary"
								onclick={syncWatchLater}
								disabled={syncingWatchLater}
							>
								{syncingWatchLater ? 'Syncing…' : 'Sync playlists'}
							</button>
							<button class="btn btn-secondary" onclick={syncHistory} disabled={syncingHistory}>
								{syncingHistory ? 'Syncing…' : 'Sync History Now'}
							</button>
							<button class="btn btn-danger" onclick={unlinkYouTube}> Unlink </button>
						</div>
					{:else}
						<p class="text-muted">
							Not linked — use the wytui browser extension to link your YouTube account.
						</p>
					{/if}

					<div class="youtube-links">
						<h3>Links</h3>
						<div class="link-buttons">
							<a
								class="btn btn-secondary"
								href={extensionStoreUrl}
								target="_blank"
								rel="noopener noreferrer"
							>
								Browser extension
								<ExternalLinkIcon width={14} height={14} />
							</a>
							<a
								class="btn btn-secondary"
								href={REPO_URL}
								target="_blank"
								rel="noopener noreferrer"
							>
								Source code
								<ExternalLinkIcon width={14} height={14} />
							</a>
						</div>
					</div>
				</div>
			</div>
		</div>
	{:else if !isAdmin}
		<!-- Non-admins only ever see the Account tab. -->
	{:else if loading}
		<div class="settings-container">
			<nav class="settings-nav" aria-hidden="true">
				<div class="settings-nav-inner">
					<Skeleton
						count={6}
						variant="text"
						lineWidths={['70%', '60%', '80%', '55%', '65%', '50%']}
					/>
				</div>
			</nav>
			<div class="general-settings">
				<div class="settings-section">
					<Skeleton count={1} variant="text" lineWidths={['40%']} />
					<Skeleton count={4} variant="row" />
				</div>
				<div class="settings-section">
					<Skeleton count={1} variant="text" lineWidths={['35%']} />
					<Skeleton count={3} variant="row" />
				</div>
			</div>
		</div>
	{:else}
		{#if settingsError}
			<div class="settings-section">
				<p style="color: var(--color-status-error)">{settingsError}</p>
				<button class="btn btn-secondary" onclick={loadSettings}>Retry</button>
			</div>
		{:else if activeTab === 'app' && settings}
			<div class="settings-container">
				{@render quickNav()}

				<div class="general-settings">
					<h3 class="category-heading">Storage &amp; Library</h3>
					<div class="settings-section" id="storage">
						<h2>Storage</h2>

						<div class="form-row">
							<div class="form-group">
								<label for="downloadPath">Cache Path</label>
								<input type="text" id="downloadPath" bind:value={settings.downloadPath} readonly />
								<p class="help-text">Temporary storage for downloads</p>
							</div>

							<div class="form-group">
								<label for="cacheQuota">Default Per-User Cache Limit (GB)</label>
								<input
									type="number"
									id="cacheQuota"
									value={cacheQuotaGB}
									oninput={(e) => updateCacheQuota(parseFloat(e.currentTarget.value) || 0)}
									min="1"
									max={diskTotalGB ? Math.floor(diskTotalGB) : undefined}
									step="1"
								/>
								{#if cacheQuotaExceedsDisk && diskTotalGB}
									<p class="help-text error-text">
										Exceeds total disk space ({diskTotalGB.toFixed(1)} GB)
									</p>
								{:else if diskTotalGB}
									<p class="help-text">
										Default cache budget per user. {diskTotalGB.toFixed(1)} GB total on disk. Override
										per user in the Users tab.
									</p>
								{:else}
									<p class="help-text">
										Default cache budget per user. Oldest downloads are auto-removed when exceeded.
										Override per user in the Users tab.
									</p>
								{/if}
							</div>
						</div>

						<div class="form-row">
							<div class="form-group">
								<label for="totalCacheQuota">Total Cache Limit (GB)</label>
								<input
									type="number"
									id="totalCacheQuota"
									value={totalCacheGB}
									oninput={(e) => updateTotalCacheQuota(e.currentTarget.value)}
									placeholder={autoTotalCacheGB !== null ? `Auto (${autoTotalCacheGB})` : 'Auto'}
									min="1"
									max={diskTotalGB ? Math.floor(diskTotalGB) : undefined}
									step="1"
								/>
								{#if totalCacheExceedsDisk && diskTotalGB}
									<p class="help-text error-text">
										Exceeds total disk space ({diskTotalGB.toFixed(1)} GB)
									</p>
								{:else}
									<p class="help-text">
										Global cap across all users. Blank = auto{autoTotalCacheGB !== null
											? ` (disk − 5 GB ≈ ${autoTotalCacheGB} GB)`
											: ' (disk − 5 GB)'}. Oldest cached items across all users are auto-removed
										when exceeded. Use this when not bounded by a PVC.
									</p>
								{/if}
							</div>
						</div>

						<div class="form-group">
							<label>Downloads Cleanup</label>
							<button
								type="button"
								class="btn btn-secondary"
								onclick={runDownloadsCleanup}
								disabled={cleaningDownloads}
							>
								{cleaningDownloads ? 'Cleaning…' : 'Clean up downloads directory'}
							</button>
							<p class="help-text">
								Removes stale partial downloads and leftover temporary files that no download owns,
								plus empty artwork-only library folders. Runs automatically every 5 minutes; this
								forces it immediately. In-flight downloads are never touched.
							</p>
							{#if downloadsCleanupResult}
								<p class="help-text">{downloadsCleanupResult}</p>
							{/if}
						</div>

						<div class="form-group">
							<label class="toggle-label">
								<input
									type="checkbox"
									checked={libraryEnabled}
									onchange={(e) => toggleLibrary(e.currentTarget.checked)}
								/>
								Enable Library
							</label>
							<p class="help-text">Save downloads permanently, organized by uploader</p>
						</div>

						{#if libraryEnabled}
							<div class="form-group nested-field">
								<label for="libraryPath">Video Library Path</label>
								<PathBrowser
									id="libraryPath"
									bind:value={settings.libraryPath}
									placeholder="/media"
								/>
							</div>

							<div class="form-group nested-field">
								<label for="musicLibraryPath">Music Library Path</label>
								<PathBrowser
									id="musicLibraryPath"
									bind:value={settings.musicLibraryPath}
									placeholder="/media/music"
								/>
								<p class="help-text">
									Audio-only downloads go here instead. Leave empty to use the video library path
									for everything.
								</p>
							</div>
						{/if}

						<div class="form-row">
							<div class="form-group">
								<label for="maxConcurrent">Max Concurrent Downloads</label>
								<input
									type="number"
									id="maxConcurrent"
									bind:value={settings.maxConcurrentDownloads}
									min="1"
									max="10"
								/>
							</div>

							<div class="form-group">
								<label for="maxDuration">Max Duration (hours)</label>
								<input
									type="number"
									id="maxDuration"
									value={settings.maxDurationSeconds
										? Math.round(settings.maxDurationSeconds / 3600)
										: 3}
									oninput={(e) => {
										const hours = parseFloat(e.currentTarget.value) || 3;
										settings.maxDurationSeconds = Math.round(hours * 3600);
									}}
									min="0"
									step="0.5"
								/>
								<p class="help-text">Skip downloads longer than this (0 = no limit)</p>
							</div>
						</div>

						<div class="form-row">
							<div class="form-group">
								<label for="rateLimit">Speed Limit</label>
								<input
									type="text"
									id="rateLimit"
									bind:value={settings.rateLimit}
									placeholder="Unlimited"
								/>
								<p class="help-text">e.g. "5M" for 5 MB/s, "500K" for 500 KB/s</p>
							</div>

							<div class="form-group">
								<label for="sleepInterval">Sleep Between Downloads (seconds)</label>
								<input
									type="number"
									id="sleepInterval"
									bind:value={settings.sleepInterval}
									min="0"
									max="3600"
									placeholder="0"
								/>
								<p class="help-text">Wait time between consecutive downloads</p>
							</div>
						</div>

						<div class="form-row">
							<div class="form-group">
								<label for="concurrentFragments">Concurrent Fragments</label>
								<input
									type="number"
									id="concurrentFragments"
									bind:value={settings.concurrentFragments}
									min="0"
									max="16"
								/>
								<p class="help-text">Parallel fragment downloads (0/1 = off)</p>
							</div>

							<div class="form-group">
								<label for="httpChunkSize">HTTP Chunk Size</label>
								<input
									type="text"
									id="httpChunkSize"
									bind:value={settings.httpChunkSize}
									placeholder="10M"
								/>
								<p class="help-text">Fragment size for chunked downloads</p>
							</div>
						</div>

						<div class="form-group">
							<label>
								<input type="checkbox" bind:checked={settings.useAria2c} />
								Use aria2c accelerated downloader
							</label>
							{#if aria2cSocksConflict}
								<p class="help-text error-text" role="alert">
									aria2c only supports HTTP proxies — it can't be combined with a SOCKS proxy URL,
									every download would fail. This toggle won't be saved while a socks5:// proxy is
									set.
								</p>
							{:else}
								<p class="help-text">
									Use aria2c accelerated downloader (requires aria2 in image). Note: aria2c only
									supports HTTP proxies, not SOCKS.
								</p>
							{/if}
						</div>

						<div class="form-group">
							<label>
								<input type="checkbox" bind:checked={settings.generateJellyfinPosters} />
								Generate Jellyfin posters
							</label>
							<p class="help-text">Generate 2:3 posters + 16:9 backdrops for Jellyfin</p>
						</div>

						<div class="form-group">
							<label>
								<input type="checkbox" bind:checked={settings.enableArchive} />
								Deduplicate downloads
							</label>
							<p class="help-text">
								Track downloaded videos to prevent re-downloading the same content
							</p>
						</div>
					</div>

					<div class="settings-section" id="library-access">
						<h2>Access</h2>
						<div class="form-group">
							<label for="libraryAccessMode">Library Access Mode</label>
							<select id="libraryAccessMode" bind:value={settings.libraryAccessMode}>
								<option value="free">Free — anyone can add to the library</option>
								<option value="request">Request — adds require admin approval</option>
								<option value="disabled">Disabled — only admins can add to the library</option>
							</select>
							<p class="help-text">
								Controls whether non-admin users can save downloads to the permanent library.
								Per-user overrides are available in the Users tab.
							</p>
						</div>
					</div>

					<h3 class="category-heading">Downloading</h3>
					<div class="settings-section" id="ytdlp">
						<h2>yt-dlp</h2>
						<div class="form-group">
							<label>
								<input type="checkbox" bind:checked={settings.autoUpdateYtdlp} />
								Auto-update yt-dlp
							</label>
						</div>

						{#if settings.ytdlpVersion}
							<div class="info-box">
								<strong>Current version:</strong>
								{settings.ytdlpVersion}
							</div>
						{/if}

						<div class="form-group">
							<label>
								<input type="checkbox" bind:checked={settings.versionCheckEnabled} />
								Check for new versions
							</label>
							<p class="help-text">
								Periodically check GitHub for new releases and show an indicator in the sidebar
							</p>
						</div>

						<div class="form-group">
							<label for="ytdlpProxyUrl">Proxy URL</label>
							<input
								type="text"
								id="ytdlpProxyUrl"
								bind:value={settings.ytdlpProxyUrl}
								placeholder="socks5://user:pass@host:port"
								class:invalid={!!ytdlpProxyUrlError}
								aria-invalid={ytdlpProxyUrlError ? 'true' : undefined}
							/>
							{#if ytdlpProxyUrlError}
								<p class="help-text error-text" role="alert">
									{ytdlpProxyUrlError}
								</p>
							{:else}
								<p class="help-text">
									Route all yt-dlp traffic (downloads, metadata fetches, subscription checks)
									through an http(s)/socks4/socks5/socks5h proxy. Use <code>socks5h</code> to resolve
									DNS through the proxy too.
								</p>
							{/if}
						</div>

						<div class="form-group">
							<label for="ytdlpExtraFlags">Extra flags</label>
							<textarea
								id="ytdlpExtraFlags"
								rows="3"
								bind:value={ytdlpExtraFlagsText}
								oninput={() => {
									settings.ytdlpExtraFlags = ytdlpExtraFlagsText
										.split('\n')
										.map((line: string) => line.trim())
										.filter(Boolean);
								}}
								placeholder={'--extractor-args youtube:player_client=web_safari\n--sleep-requests 1'}
							></textarea>
							<p class="help-text">
								Default yt-dlp flags applied to every download and subscription check. One token per
								line — a flag and its value go on separate lines. Profile and per-subscription flags
								override these.
							</p>
						</div>
					</div>

					<div class="settings-section" id="cookies">
						<h2>Cookies</h2>
						<p class="help-text" style="margin-bottom: var(--spacing-lg);">
							Upload a Netscape-format cookies.txt file to access member-only and age-restricted
							content.
						</p>

						{#if cookieStatus.hasCookies}
							<div class="info-box" style="margin-bottom: var(--spacing-md);">
								Cookie file is active.
							</div>
							<button class="btn btn-danger btn-sm btn-with-icon" onclick={deleteCookieFile}>
								<TrashIcon width={14} height={14} />
								Remove Cookies
							</button>
						{:else}
							<label class="cookie-upload-label btn-secondary btn-sm btn-with-icon">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline
										points="17 8 12 3 7 8"
									/><line x1="12" y1="3" x2="12" y2="15" /></svg
								>
								{uploadingCookies ? 'Uploading...' : 'Upload cookies.txt'}
								<input
									type="file"
									accept=".txt"
									onchange={uploadCookieFile}
									disabled={uploadingCookies}
									style="display: none;"
								/>
							</label>
						{/if}

						{#if cookieError}
							<div class="error-message" style="margin-top: var(--spacing-md);">
								{cookieError}
							</div>
						{/if}
					</div>

					<div class="settings-section" id="ryd">
						<h2>Return YouTube Dislike</h2>
						<div class="form-group">
							<label>
								<input type="checkbox" bind:checked={settings.rydEnabled} />
								Enable dislike counts
							</label>
							<p class="help-text">
								Fetch dislike counts from the Return YouTube Dislike API when downloading videos.
								When enabled, video IDs are sent to an external service (<a
									href="https://returnyoutubedislike.com"
									target="_blank"
									rel="noopener noreferrer">returnyoutubedislike.com</a
								>).
							</p>
						</div>
					</div>

					<div class="settings-section" id="jellyfin">
						<h2>Jellyfin</h2>

						<div class="form-group">
							<label class="toggle-label">
								<input
									type="checkbox"
									checked={jellyfinEnabled}
									onchange={(e) => toggleJellyfin(e.currentTarget.checked)}
								/>
								Enable Jellyfin Integration
							</label>
							<p class="help-text">Triggers a library scan when downloads are saved to library</p>
						</div>

						{#if jellyfinEnabled}
							<div class="form-row nested-field">
								<div class="form-group">
									<label for="jellyfinUrl">Server URL</label>
									<input
										type="text"
										id="jellyfinUrl"
										bind:value={settings.jellyfinUrl}
										placeholder="http://jellyfin:8096"
									/>
								</div>

								<div class="form-group">
									<label for="jellyfinApiKey">API Key</label>
									<PasswordInput
										id="jellyfinApiKey"
										bind:value={settings.jellyfinApiKey}
										placeholder="Enter API key"
									/>
									<p class="help-text">Dashboard > API Keys in Jellyfin</p>
								</div>

								<div class="form-group">
									<label for="jellyfinExternalUrl">External URL</label>
									<input
										type="text"
										id="jellyfinExternalUrl"
										bind:value={settings.jellyfinExternalUrl}
										placeholder="https://jellyfin.example.com"
									/>
									<p class="help-text">
										Public URL used for "Open in Jellyfin" links. Defaults to Server URL if empty.
									</p>
								</div>
							</div>
							<div class="jellyfin-test nested-field">
								<button
									type="button"
									class="btn btn-secondary btn-sm btn-with-icon"
									onclick={testJellyfinConnection}
									disabled={testingJellyfin || !settings.jellyfinUrl || !settings.jellyfinApiKey}
								>
									<ZapIcon width={14} height={14} />
									{testingJellyfin ? 'Testing...' : 'Test Connection'}
								</button>
								{#if jellyfinTestResult}
									<span
										class="test-result"
										class:success={jellyfinTestResult.success}
										class:error={!jellyfinTestResult.success}
									>
										{jellyfinTestResult.message}
									</span>
								{/if}
							</div>

							<div class="cleanup-section nested-field">
								<div class="form-group">
									<label class="toggle-label">
										<input
											type="checkbox"
											bind:checked={settings.cleanupEnabled}
											onchange={() => {
												if (settings.cleanupEnabled && jellyfinUsers.length === 0) {
													loadJellyfinUsers();
												}
											}}
										/>
										Auto-Cleanup Watched Items
									</label>
									<p class="help-text">
										Automatically delete library items after all selected users have watched them
									</p>
								</div>

								{#if cleanupEnabled}
									<div class="form-group nested-field">
										<label>Watch Users</label>
										{#if loadingJellyfinUsers}
											<p class="text-muted">Loading users...</p>
										{:else if jellyfinUsers.length === 0}
											<button
												class="btn btn-secondary btn-sm btn-with-icon"
												onclick={loadJellyfinUsers}
											>
												<UsersIcon width={14} height={14} />
												{jellyfinUsersError ? 'Retry' : 'Load Jellyfin Users'}
											</button>
											{#if jellyfinUsersError}
												<span class="test-result error">{jellyfinUsersError}</span>
											{/if}
										{:else}
											<div class="user-checkboxes">
												{#each jellyfinUsers as user}
													<label class="checkbox-label">
														<input
															type="checkbox"
															checked={(settings.cleanupUserIds || []).includes(user.id)}
															onchange={() => toggleCleanupUser(user.id)}
														/>
														{user.name}
													</label>
												{/each}
											</div>
											<button
												class="btn btn-secondary btn-sm btn-with-icon"
												onclick={loadJellyfinUsers}
												style="margin-top: var(--spacing-sm); align-self: flex-start;"
											>
												<RefreshIcon width={14} height={14} />
												Refresh
											</button>
										{/if}
										<p class="help-text">
											Item is deleted only when ALL selected users have watched it
										</p>
									</div>

									<div class="form-row nested-field">
										<div class="form-group">
											<label for="cleanupInterval">Check Interval (hours)</label>
											<input
												type="number"
												id="cleanupInterval"
												value={settings.cleanupIntervalSeconds
													? Math.round(settings.cleanupIntervalSeconds / 3600)
													: 1}
												oninput={(e) => {
													const hours = parseFloat(e.currentTarget.value) || 1;
													settings.cleanupIntervalSeconds = Math.round(hours * 3600);
												}}
												min="1"
												max="24"
												step="1"
											/>
										</div>

										<div class="form-group">
											<label for="cleanupGraceHours">Grace Period (hours)</label>
											<input
												type="number"
												id="cleanupGraceHours"
												bind:value={settings.cleanupGraceHours}
												min="0"
												max="720"
												step="1"
											/>
											<p class="help-text">Wait time after all users watched before deleting</p>
										</div>
									</div>

									<div class="form-group nested-field">
										<label>Profile Types</label>
										<div class="user-checkboxes">
											<label class="checkbox-label">
												<input
													type="checkbox"
													checked={(settings.cleanupProfileTypes || []).includes('video')}
													onchange={() => {
														const types: string[] = settings.cleanupProfileTypes || [];
														settings.cleanupProfileTypes = types.includes('video')
															? types.filter((t: string) => t !== 'video')
															: [...types, 'video'];
													}}
												/>
												Video
											</label>
											<label class="checkbox-label">
												<input
													type="checkbox"
													checked={(settings.cleanupProfileTypes || []).includes('music')}
													onchange={() => {
														const types: string[] = settings.cleanupProfileTypes || [];
														settings.cleanupProfileTypes = types.includes('music')
															? types.filter((t: string) => t !== 'music')
															: [...types, 'music'];
													}}
												/>
												Music
											</label>
										</div>
										<p class="help-text">Which download types to auto-clean</p>
									</div>
								{/if}
							</div>
						{/if}
					</div>

					<div class="settings-section" id="plex">
						<h2>Plex</h2>

						<div class="form-group">
							<label class="toggle-label">
								<input
									type="checkbox"
									checked={plexEnabled}
									onchange={(e) => togglePlex(e.currentTarget.checked)}
								/>
								Enable Plex Integration
							</label>
							<p class="help-text">Triggers a library scan when downloads are saved to library</p>
						</div>

						{#if plexEnabled}
							<div class="form-row nested-field">
								<div class="form-group">
									<label for="plexUrl">Server URL</label>
									<input
										type="text"
										id="plexUrl"
										bind:value={settings.plexUrl}
										placeholder="http://localhost:32400"
									/>
								</div>

								<div class="form-group">
									<label for="plexToken">Token</label>
									<PasswordInput
										id="plexToken"
										bind:value={settings.plexToken}
										placeholder="Enter Plex token"
									/>
									<p class="help-text">Find your token at plex.tv/claim or in Plex server XML</p>
								</div>
							</div>
							<div class="jellyfin-test nested-field">
								<button
									type="button"
									class="btn btn-secondary btn-sm btn-with-icon"
									onclick={testPlexConnection}
									disabled={testingPlex || !settings.plexUrl || !settings.plexToken}
								>
									<ZapIcon width={14} height={14} />
									{testingPlex ? 'Testing...' : 'Test Connection'}
								</button>
								{#if plexTestResult}
									<span
										class="test-result"
										class:success={plexTestResult.success}
										class:error={!plexTestResult.success}
									>
										{plexTestResult.message}
									</span>
								{/if}
							</div>
						{/if}
					</div>

					<h3 class="category-heading">Automation</h3>
					<div class="settings-section" id="auto-delete">
						<h2>Auto-Delete</h2>
						<div class="form-group">
							<label for="autoDeleteDays">Delete watched videos after (days)</label>
							<input
								type="number"
								id="autoDeleteDays"
								bind:value={settings.autoDeleteWatchedDays}
								min="0"
								placeholder="Disabled"
							/>
							<p class="help-text">
								Automatically delete watched cache downloads after this many days. Set to 0 or leave
								empty to disable. Library items are never auto-deleted.
							</p>
						</div>
					</div>

					<div class="settings-section" id="rescan">
						<h2>Rescan Library</h2>
						<p class="help-text" style="margin-bottom: var(--spacing-lg);">
							Check that downloaded files still exist on disk. Finds completed downloads whose files
							are missing.
						</p>

						<div class="rescan-actions">
							<button
								class="btn btn-secondary btn-sm btn-with-icon"
								onclick={runRescan}
								disabled={rescanning}
							>
								<RefreshIcon width={14} height={14} />
								{rescanning ? 'Scanning...' : 'Rescan Now'}
							</button>
						</div>

						{#if rescanReport}
							<div class="rescan-results">
								<div class="rescan-summary">
									<span class="rescan-stat ok">{rescanReport.ok} OK</span>
									<span class="rescan-stat" class:missing={rescanReport.missing.length > 0}
										>{rescanReport.missing.length} missing</span
									>
								</div>

								{#if rescanReport.missing.length > 0}
									<div class="rescan-missing-list">
										<div class="rescan-bulk-actions">
											<button
												class="btn btn-secondary btn-sm btn-with-icon"
												onclick={() => markRescanMissing(rescanReport!.missing.map((m) => m.id))}
												disabled={reconciling}
											>
												Mark all as deleted
											</button>
											<button
												class="btn btn-danger btn-sm btn-with-icon"
												onclick={() => deleteRescanRecords(rescanReport!.missing.map((m) => m.id))}
												disabled={reconciling}
											>
												<TrashIcon width={14} height={14} />
												Delete all records
											</button>
										</div>

										{#each rescanReport.missing as item}
											<div class="rescan-missing-item">
												<div class="rescan-missing-info">
													<span class="rescan-missing-title">{item.title || 'Untitled'}</span>
													<code class="rescan-missing-path">{item.filepath}</code>
												</div>
												<div class="rescan-missing-actions">
													<button
														class="btn btn-danger btn-sm btn-icon"
														onclick={() => deleteRescanRecords([item.id])}
														disabled={reconciling}
														aria-label="Delete record"
														title="Delete record"
													>
														<TrashIcon width={14} height={14} />
													</button>
												</div>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
					</div>

					<div class="settings-section" id="backup">
						<h2>Backup</h2>
						<div class="form-group">
							<label>
								<input type="checkbox" bind:checked={settings.backupEnabled} />
								Enable scheduled backups
							</label>
						</div>

						{#if settings.backupEnabled}
							<div class="form-row nested-field">
								<div class="form-group">
									<label for="backupCron">Backup schedule (cron)</label>
									<input
										type="text"
										id="backupCron"
										bind:value={settings.backupCron}
										placeholder="0 2 * * *"
									/>
									<p class="help-text">Cron expression (e.g. "0 2 * * *" for daily at 2 AM)</p>
								</div>
								<div class="form-group">
									<label for="backupPath">Backup path</label>
									<input
										type="text"
										id="backupPath"
										bind:value={settings.backupPath}
										placeholder="/backups"
									/>
								</div>
							</div>
						{/if}
					</div>

					<div class="settings-section" id="notifications">
						<h2>Notifications</h2>
						<div class="form-group">
							<label for="appriseUrl">Apprise URL</label>
							<input
								type="text"
								id="appriseUrl"
								bind:value={settings.appriseUrl}
								placeholder="http://apprise:8000"
							/>
							<p class="help-text">URL of your Apprise API server for push notifications</p>
						</div>

						{#if settings.appriseUrl}
							<div class="form-group">
								<label>
									<input type="checkbox" bind:checked={settings.notifyOnComplete} />
									Notify on download complete
								</label>
							</div>
							<div class="form-group">
								<label>
									<input type="checkbox" bind:checked={settings.notifyOnFail} />
									Notify on download failure
								</label>
							</div>
							<div class="jellyfin-test nested-field">
								<button
									type="button"
									class="btn btn-secondary btn-sm btn-with-icon"
									onclick={testNotification}
									disabled={testingNotification}
								>
									<BellIcon width={14} height={14} />
									{testingNotification ? 'Sending...' : 'Test Notification'}
								</button>
								{#if notificationTestResult}
									<span
										class="test-result"
										class:success={notificationTestResult.success}
										class:error={!notificationTestResult.success}
									>
										{notificationTestResult.message}
									</span>
								{/if}
							</div>
						{/if}
					</div>

					<h3 class="category-heading">Access &amp; Privacy</h3>
					<div class="settings-section" id="ldap">
						<h2>LDAP</h2>
						{#if settings.ldapManagedByEnv}
							<div class="info-box managed-box" style="margin-bottom: var(--spacing-lg);">
								Managed by environment variables. LDAP settings are controlled by <code>LDAP_*</code
								> env vars and cannot be changed here.
							</div>
						{/if}
						<div class="form-group">
							<label>
								<input
									type="checkbox"
									bind:checked={settings.ldapEnabled}
									disabled={settings.ldapManagedByEnv}
								/>
								Enable LDAP authentication
							</label>
							<p class="help-text">Users authenticating via LDAP are auto-created on first login</p>
						</div>

						{#if settings.ldapEnabled}
							<div class="form-group nested-field">
								<label for="ldapUrl">LDAP Server URL</label>
								<input
									type="text"
									id="ldapUrl"
									bind:value={settings.ldapUrl}
									placeholder="ldap://ldap.example.com:389"
									disabled={settings.ldapManagedByEnv}
								/>
							</div>
							<div class="form-row nested-field">
								<div class="form-group">
									<label for="ldapBindDn">Bind DN</label>
									<input
										type="text"
										id="ldapBindDn"
										bind:value={settings.ldapBindDn}
										placeholder="cn=admin,dc=example,dc=com"
										disabled={settings.ldapManagedByEnv}
									/>
								</div>
								<div class="form-group">
									<label for="ldapBindPassword">Bind Password</label>
									<PasswordInput
										id="ldapBindPassword"
										bind:value={settings.ldapBindPassword}
										placeholder="••••••••"
										disabled={settings.ldapManagedByEnv}
									/>
								</div>
							</div>
							<div class="form-group nested-field">
								<label for="ldapSearchBase">Search Base</label>
								<input
									type="text"
									id="ldapSearchBase"
									bind:value={settings.ldapSearchBase}
									placeholder="ou=users,dc=example,dc=com"
									disabled={settings.ldapManagedByEnv}
								/>
							</div>
							<div class="form-group nested-field">
								<label for="ldapSearchFilter">Search Filter</label>
								<input
									type="text"
									id="ldapSearchFilter"
									bind:value={settings.ldapSearchFilter}
									placeholder={'(uid={{username}})'}
									disabled={settings.ldapManagedByEnv}
								/>
								<p class="help-text">
									Use {'{{username}}'} as placeholder. For Active Directory use (sAMAccountName={'{{username}}'})
								</p>
							</div>
						{/if}
					</div>

					<div class="settings-section" id="proxy-auth">
						<h2>Reverse Proxy Auth</h2>
						<div class="form-group">
							<label>
								<input type="checkbox" bind:checked={settings.proxyAuthEnabled} />
								Enable reverse proxy authentication
							</label>
							<p class="help-text">
								Automatically log in users based on a header set by your reverse proxy (Authelia,
								Authentik, etc.)
							</p>
						</div>

						{#if settings.proxyAuthEnabled}
							<div class="info-box warning-box" style="margin-bottom: var(--spacing-lg);">
								Only enable this if wytui is behind a trusted reverse proxy that sets the
								authentication header. If users can reach wytui directly, they can forge the header
								and impersonate any user.
							</div>

							<div class="form-group nested-field">
								<label for="proxyAuthHeader">Auth Header Name</label>
								<input
									type="text"
									id="proxyAuthHeader"
									bind:value={settings.proxyAuthHeader}
									placeholder="X-Forwarded-User"
								/>
								<p class="help-text">
									The HTTP header your reverse proxy sets with the authenticated username or email.
									Common values: <code>X-Forwarded-User</code>,
									<code>Remote-User</code>,
									<code>X-Authentik-Username</code>
								</p>
							</div>
						{/if}
					</div>

					<div class="settings-section" id="oidc">
						<h2>OIDC / SSO</h2>
						{#if settings.oidcManagedByEnv}
							<div class="info-box managed-box" style="margin-bottom: var(--spacing-lg);">
								Managed by environment variables. OIDC settings are controlled by <code>OIDC_*</code
								> env vars and cannot be changed here.
							</div>
						{/if}
						<div class="form-group">
							<label>
								<input
									type="checkbox"
									bind:checked={settings.oidcEnabled}
									disabled={settings.oidcManagedByEnv}
								/>
								Enable OIDC / SSO login
							</label>
							<p class="help-text">
								Allow users to sign in through an external identity provider (Authentik, Keycloak,
								Google, etc.)
							</p>
						</div>

						{#if settings.oidcEnabled}
							<div class="form-group nested-field">
								<label for="oidcIssuerUrl">Issuer URL</label>
								<input
									type="text"
									id="oidcIssuerUrl"
									bind:value={settings.oidcIssuerUrl}
									placeholder="https://sso.example.com/application/o/wytui/"
									disabled={settings.oidcManagedByEnv}
								/>
								<p class="help-text">The OpenID Connect issuer / discovery base URL</p>
							</div>
							<div class="form-row nested-field">
								<div class="form-group">
									<label for="oidcClientId">Client ID</label>
									<input
										type="text"
										id="oidcClientId"
										bind:value={settings.oidcClientId}
										placeholder="wytui"
										disabled={settings.oidcManagedByEnv}
									/>
								</div>
								<div class="form-group">
									<label for="oidcClientSecret">Client Secret</label>
									<PasswordInput
										id="oidcClientSecret"
										bind:value={settings.oidcClientSecret}
										placeholder="••••••••"
										disabled={settings.oidcManagedByEnv}
									/>
								</div>
							</div>
							<div class="form-group nested-field">
								<label for="oidcDisplayName">Display Name</label>
								<input
									type="text"
									id="oidcDisplayName"
									bind:value={settings.oidcDisplayName}
									placeholder="SSO"
									disabled={settings.oidcManagedByEnv}
								/>
								<p class="help-text">Label shown on the sign-in button (e.g. "Company SSO")</p>
							</div>
						{/if}
					</div>

					<div class="settings-section" id="auth-mode">
						<h2>Authentication</h2>
						<div class="form-group">
							<label for="authMode">Login Method</label>
							<select
								id="authMode"
								bind:value={settings.authMode}
								disabled={!settings.oidcConfigured}
							>
								{#if settings.oidcConfigured}
									<option value="password" disabled={!settings.canUsePasswordOnly}
										>Password Only{!settings.canUsePasswordOnly
											? ' (no admin has a password)'
											: ''}</option
									>
									<option value="both">Password + {settings.oidcDisplayName || 'SSO'}</option>
									<option value="oidc">{settings.oidcDisplayName || 'SSO'} Only</option>
								{:else}
									<option value="password" selected>Password Only</option>
								{/if}
							</select>
							<p class="help-text">Choose which login methods are shown on the sign-in page</p>
							{#if settings.oidcConfigured && !settings.canUsePasswordOnly}
								<div class="info-box warning-box">
									Password-only mode is unavailable because no admin account has a password set. Set
									a password for an admin account to enable this option.
								</div>
							{/if}
						</div>

						{#if settings.oidcConfigured && settings.authMode === 'oidc'}
							<div class="info-box warning-box">
								Password login will remain accessible at <code>/auth/signin?fallback=password</code> as
								a safety fallback in case SSO is unavailable.
							</div>
						{/if}
					</div>

					<div class="settings-section" id="privacy">
						<h2>Stats &amp; Privacy</h2>
						<div class="form-group">
							<label class="toggle-label">
								<input type="checkbox" bind:checked={settings.statsVisibleToNonAdmins} />
								Show stats panel to non-admins
							</label>
							<p class="help-text">Let non-admin users see the statistics panel.</p>
						</div>
						<div class="form-group">
							<label class="toggle-label">
								<input type="checkbox" bind:checked={settings.showTotalSizeToNonAdmins} />
								Show total/global storage size to non-admins
							</label>
							<p class="help-text">Reveal the aggregate library/storage size to non-admin users.</p>
						</div>
					</div>

					<div class="settings-section" id="config">
						<h2>Import / Export</h2>
						<p class="help-text" style="margin-bottom: var(--spacing-lg);">
							Back up the full app configuration as YAML, or restore it on this or another instance.
						</p>

						<div class="form-group">
							<button
								class="btn btn-secondary btn-sm btn-with-icon"
								onclick={exportConfig}
								disabled={exportingConfig}
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline
										points="7 10 12 15 17 10"
									/><line x1="12" y1="15" x2="12" y2="3" /></svg
								>
								{exportingConfig ? 'Exporting...' : 'Export Config'}
							</button>
							<p class="help-text">
								Contains secrets (API keys, tokens, passwords) in plaintext — store the downloaded
								file securely.
							</p>
						</div>

						<div class="form-group">
							<label class="cookie-upload-label btn-secondary btn-sm btn-with-icon">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline
										points="17 8 12 3 7 8"
									/><line x1="12" y1="3" x2="12" y2="15" /></svg
								>
								{importingConfig ? 'Reading...' : 'Import Config'}
								<input
									type="file"
									accept=".yaml,.yml"
									onchange={handleImportFile}
									disabled={importingConfig}
									style="display: none;"
								/>
							</label>
							<p class="help-text">
								You'll see exactly what will change before anything is applied.
							</p>
						</div>

						{#if importError && !importPreview}
							<div class="error-message" style="margin-top: var(--spacing-md);">
								{importError}
							</div>
						{/if}
					</div>

					<div class="api-docs-link">
						<a href="/docs" class="btn btn-secondary btn-lg">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline
									points="14 2 14 8 20 8"
								/><line x1="16" y1="13" x2="8" y2="13" /><line
									x1="16"
									y1="17"
									x2="8"
									y2="17"
								/><polyline points="10 9 9 9 8 9" /></svg
							>
							API Documentation
						</a>
					</div>
				</div>
			</div>
		{/if}

		{#if activeTab === 'users'}
			<div class="settings-container">
				{@render quickNav()}
				<div class="general-settings">
					<div class="settings-section" id="user-management">
						<div class="section-header">
							<h2>User Management</h2>
							<button class="btn btn-secondary" onclick={() => (showCreateUser = !showCreateUser)}>
								{showCreateUser ? 'Cancel' : '+ Add User'}
							</button>
						</div>

						{#if showCreateUser}
							<div class="create-user-form">
								<h3>Create New User</h3>

								{#if createUserError}
									<div class="error-message">{createUserError}</div>
								{/if}

								<div class="form-group">
									<label for="new-name">Name</label>
									<input
										type="text"
										id="new-name"
										bind:value={newUser.name}
										placeholder="John Doe"
									/>
								</div>

								<div class="form-group">
									<label for="new-email">Email</label>
									<input
										type="email"
										id="new-email"
										bind:value={newUser.email}
										placeholder="user@example.com"
									/>
								</div>

								<div class="form-group">
									<label for="new-password">Password</label>
									<PasswordInput
										id="new-password"
										bind:value={newUser.password}
										placeholder="Enter a password"
									/>
									{#if newUser.password.length > 0}
										<div class="password-suggestions">
											<span class="suggestion" class:met={newUser.password.length >= 8}
												>8+ characters</span
											>
											<span class="suggestion" class:met={/[a-z]/.test(newUser.password)}
												>lowercase</span
											>
											<span class="suggestion" class:met={/[A-Z]/.test(newUser.password)}
												>uppercase</span
											>
											<span class="suggestion" class:met={/[0-9]/.test(newUser.password)}
												>number</span
											>
											<span class="suggestion" class:met={/[^a-zA-Z0-9]/.test(newUser.password)}
												>special character</span
											>
										</div>
									{/if}
								</div>

								<div class="form-group">
									<label>
										<input type="checkbox" bind:checked={newUser.isAdmin} />
										Admin privileges
									</label>
								</div>

								<button class="btn btn-primary" onclick={createUser}>Create User</button>
							</div>
						{/if}

						<div class="users-search">
							<input
								type="text"
								placeholder="Search users by email or name"
								value={userSearch}
								oninput={(e) => onUserSearchInput(e.currentTarget.value)}
							/>
						</div>

						<div class="users-list">
							{#each users as user}
								<div class="user-card">
									<div class="user-info">
										<div class="user-name">
											{user.name}
											{#if user.isAdmin}
												<span class="badge badge-admin">Admin</span>
											{/if}
											{#if user.id === data.session?.user?.id}
												<span class="badge badge-you">You</span>
											{/if}
										</div>
										<div class="user-email">{user.email}</div>
										<div class="user-stats">
											{user._count.downloads} downloads • {user._count.subscriptions} subscriptions
										</div>
										<div class="user-overrides">
											<div class="user-override">
												<label for={`access-${user.id}`}>Library Access</label>
												<select
													id={`access-${user.id}`}
													value={userAccessValue(user)}
													onchange={(e) => updateUserLibraryAccess(user, e.currentTarget.value)}
												>
													<option value="default">Default</option>
													<option value="allowed">Allowed</option>
													<option value="denied">Denied</option>
												</select>
											</div>
											<div class="user-override">
												<label for={`quota-${user.id}`}>Cache Override (GB)</label>
												<div class="user-quota-input">
													<input
														type="number"
														id={`quota-${user.id}`}
														min="0"
														step="1"
														placeholder="Default"
														value={userQuotaDisplay(user)}
														oninput={(e) => (userQuotaDrafts[user.id] = e.currentTarget.value)}
													/>
													<button
														class="btn btn-secondary btn-sm"
														onclick={() => saveUserQuota(user)}>Save</button
													>
												</div>
											</div>
										</div>
									</div>
									<div class="user-actions">
										{#if user.id === data.session?.user?.id}
											<button
												class="btn btn-secondary btn-sm btn-with-icon"
												onclick={() => openPasswordChange(user.id)}
											>
												<LockIcon width={14} height={14} />
												Change Password
											</button>
										{:else if data.session?.user?.isAdmin && !user.isAdmin}
											<button
												class="btn btn-secondary btn-sm btn-with-icon"
												onclick={() => openPasswordChange(user.id)}
											>
												<LockIcon width={14} height={14} />
												Change Password
											</button>
										{/if}

										{#if data.session?.user?.isAdmin}
											<button
												class="btn btn-secondary btn-sm btn-with-icon"
												onclick={() => toggleAdmin(user)}
											>
												<ShieldIcon width={14} height={14} />
												{user.isAdmin ? 'Demote' : 'Promote'}
											</button>
										{/if}

										{#if data.session?.user?.isAdmin && user._count.downloads > 0}
											<button
												class="btn btn-danger btn-sm btn-with-icon"
												onclick={() => clearUserDownloads(user)}
											>
												<TrashIcon width={14} height={14} />
												Clear Downloads
											</button>
										{/if}

										{#if data.session?.user?.isAdmin}
											<button
												class="btn btn-danger btn-sm btn-with-icon"
												onclick={() => deleteUser(user)}
											>
												<TrashIcon width={14} height={14} />
												Delete
											</button>
										{/if}
									</div>
								</div>
							{/each}

							{#if users.length === 0}
								<EmptyState
									title={userSearch.trim() ? 'No users match your search' : 'No users found'}
									variant="subtle"
									size="sm"
								/>
							{/if}
						</div>

						{#if usersTotal > 0}
							<div class="users-pagination">
								<span class="users-pagination-info">
									{usersOffset + 1}–{Math.min(usersOffset + USERS_PAGE_SIZE, usersTotal)} of {usersTotal}
								</span>
								<div class="users-pagination-controls">
									<button
										class="btn btn-secondary btn-sm"
										onclick={usersPrevPage}
										disabled={usersOffset === 0 || usersLoading}
									>
										Prev
									</button>
									<button
										class="btn btn-secondary btn-sm"
										onclick={usersNextPage}
										disabled={usersOffset + USERS_PAGE_SIZE >= usersTotal || usersLoading}
									>
										Next
									</button>
								</div>
							</div>
						{/if}
					</div>

					<div class="settings-section" id="library-requests">
						<div class="section-header">
							<h2>Library Requests</h2>
							<button
								class="btn btn-secondary btn-sm btn-with-icon"
								onclick={loadLibraryRequests}
								disabled={loadingRequests}
							>
								<RefreshIcon width={14} height={14} />
								Refresh
							</button>
						</div>
						<p class="text-muted">
							Pending requests from users to add downloads to the permanent library.
						</p>

						{#if libraryRequests.length > 0}
							<div class="requests-list">
								{#each libraryRequests as req}
									<div class="request-card">
										{#if req.download?.thumbnail}
											<img
												class="request-thumb"
												src={req.download.thumbnail}
												alt=""
												loading="lazy"
											/>
										{:else}
											<div class="request-thumb request-thumb-placeholder"></div>
										{/if}
										<div class="request-info">
											<span class="request-title">{req.download?.title || 'Untitled'}</span>
											{#if req.download?.uploader}
												<span class="request-uploader">{req.download.uploader}</span>
											{/if}
											<span class="request-meta">
												Requested by {req.user?.name || req.user?.email || 'Unknown'}
												· {new Date(req.createdAt).toLocaleDateString()}
											</span>
										</div>
										<div class="request-actions">
											<button
												class="btn btn-primary btn-sm"
												onclick={() => handleLibraryRequest(req.id, 'approve')}
												disabled={processingRequestId === req.id}
											>
												Approve
											</button>
											<button
												class="btn btn-danger btn-sm"
												onclick={() => handleLibraryRequest(req.id, 'deny')}
												disabled={processingRequestId === req.id}
											>
												Deny
											</button>
										</div>
									</div>
								{/each}
							</div>
						{:else}
							<EmptyState title="No pending requests" variant="subtle" size="sm" />
						{/if}
					</div>

					<div class="settings-section danger-zone" id="danger-zone">
						<h2>Danger Zone</h2>
						<div class="danger-row">
							<div class="danger-info">
								<div class="danger-title">Clear all downloads</div>
								<p class="help-text">
									Permanently delete every user’s downloads and remove the files from disk. This
									cannot be undone.
								</p>
							</div>
							<button
								class="btn btn-danger btn-with-icon"
								onclick={clearAllDownloads}
								disabled={clearingDownloads}
							>
								<TrashIcon width={16} height={16} />
								{clearingDownloads ? 'Clearing…' : 'Clear All Downloads'}
							</button>
						</div>
					</div>
				</div>
			</div>
		{/if}
	{/if}
</div>

<!-- Password Change Modal -->
{#if passwordChangeUserId}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={closePasswordChange}>
		<div
			bind:this={passwordModalEl}
			class="modal-content"
			role="dialog"
			aria-modal="true"
			aria-label="Change password"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => {
				if (e.key === 'Escape') closePasswordChange();
			}}
		>
			<div class="modal-header">
				<h3>Change Password</h3>
				<button class="modal-close" onclick={closePasswordChange}>&times;</button>
			</div>

			<div class="modal-body">
				{#if passwordError}
					<div class="error-message">{passwordError}</div>
				{/if}

				<form
					onsubmit={(e) => {
						e.preventDefault();
						changePassword();
					}}
				>
					<div class="form-group">
						<label for="change-new-password">New Password</label>
						<PasswordInput
							id="change-new-password"
							bind:value={passwordForm.newPassword}
							placeholder="Enter new password"
							required
						/>
						{#if passwordForm.newPassword.length > 0}
							<div class="password-suggestions">
								<span class="suggestion" class:met={passwordForm.newPassword.length >= 8}
									>8+ characters</span
								>
								<span class="suggestion" class:met={/[a-z]/.test(passwordForm.newPassword)}
									>lowercase</span
								>
								<span class="suggestion" class:met={/[A-Z]/.test(passwordForm.newPassword)}
									>uppercase</span
								>
								<span class="suggestion" class:met={/[0-9]/.test(passwordForm.newPassword)}
									>number</span
								>
								<span class="suggestion" class:met={/[^a-zA-Z0-9]/.test(passwordForm.newPassword)}
									>special character</span
								>
							</div>
						{/if}
					</div>

					<div class="form-group">
						<label for="confirm-password">Confirm New Password</label>
						<PasswordInput
							id="confirm-password"
							bind:value={passwordForm.confirmPassword}
							placeholder="Re-enter new password"
							required
						/>
					</div>

					<div class="modal-actions">
						<button type="button" class="btn btn-secondary" onclick={closePasswordChange}>
							Cancel
						</button>
						<button type="submit" class="btn btn-primary"> Change Password </button>
					</div>
				</form>
			</div>
		</div>
	</div>
{/if}

<ImportSubscriptionsModal bind:open={showImportModal} />

<!-- Import Config Preview Modal -->
{#if importPreview}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={closeImportPreview}>
		<div
			class="modal-content"
			role="dialog"
			aria-modal="true"
			aria-label="Confirm config import"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => {
				if (e.key === 'Escape') closeImportPreview();
			}}
		>
			<div class="modal-header">
				<h3>Review Config Import</h3>
				<button class="modal-close" onclick={closeImportPreview}>&times;</button>
			</div>

			<div class="modal-body">
				{#if importError}
					<div class="error-message">{importError}</div>
				{/if}

				{#if importPreview.changes.length === 0}
					<p class="help-text">No changes — this file matches the current settings.</p>
				{:else}
					<p class="help-text" style="margin-bottom: var(--spacing-md);">
						{importPreview.changes.length} setting{importPreview.changes.length === 1 ? '' : 's'} will
						change. Review carefully before applying — this includes anything affecting login/auth.
					</p>
					<table class="import-diff-table">
						<thead>
							<tr>
								<th>Setting</th>
								<th>Current</th>
								<th>New</th>
							</tr>
						</thead>
						<tbody>
							{#each importPreview.changes as change (change.field)}
								<tr>
									<td class="import-diff-field">{change.field}</td>
									<td class="import-diff-from">{formatSettingValue(change.from)}</td>
									<td class="import-diff-to">{formatSettingValue(change.to)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}

				{#if importPreview.skipped?.length}
					<p class="help-text" style="margin-top: var(--spacing-md);">
						Ignored (managed by environment variables): {importPreview.skipped.join(', ')}
					</p>
				{/if}

				<div class="modal-actions">
					<button type="button" class="btn btn-secondary" onclick={closeImportPreview}>
						Cancel
					</button>
					{#if importPreview.changes.length > 0}
						<button
							type="button"
							class="btn btn-danger"
							onclick={applyImport}
							disabled={applyingImport}
						>
							{applyingImport ? 'Applying...' : 'Apply Changes'}
						</button>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.page {
		max-width: 1400px;
		margin: 0 auto;
		width: 100%;
	}

	.tabs-wrapper {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-2xl);
	}

	.back-arrow {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: var(--radius-md);
		color: var(--color-text-secondary);
		transition: all var(--transition-fast);
		text-decoration: none;
	}

	.back-arrow:hover {
		color: var(--color-text-primary);
		background: var(--color-overlay-white-08);
	}

	.tabs {
		display: flex;
		justify-content: center;
		gap: 4px;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		padding: 4px;
		width: fit-content;
	}

	.tab {
		padding: var(--spacing-sm) var(--spacing-xl);
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--color-text-secondary);
		font-weight: 500;
		font-size: 0.875rem;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.tab:hover:not(.active) {
		color: var(--color-text-primary);
		background: var(--color-overlay-white-05);
	}

	.tab.active {
		background: var(--color-accent-primary);
		color: #fff;
		font-weight: 600;
	}

	.settings-container {
		display: flex;
		gap: var(--spacing-xl);
		max-width: 1200px;
		align-items: flex-start;
		width: 100%;
	}

	.settings-nav {
		position: sticky;
		top: var(--spacing-3xl);
		flex-shrink: 0;
		width: 220px;
		align-self: flex-start;
		max-height: calc(100vh - var(--spacing-3xl) - var(--spacing-xl));
		overflow-y: auto;
		z-index: 10;
		contain: layout style;
	}

	.settings-nav::-webkit-scrollbar {
		width: 4px;
	}

	.settings-nav::-webkit-scrollbar-thumb {
		background: var(--color-overlay-white-20);
		border-radius: 2px;
	}

	.settings-nav-inner {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-overlay-white-10);
		border-radius: var(--radius-lg);
		padding: var(--spacing-lg);
	}

	.settings-nav h3 {
		font-size: 0.875rem;
		font-weight: 600;
		text-transform: uppercase;
		color: var(--color-text-secondary);
		margin-bottom: var(--spacing-md);
		letter-spacing: 0.5px;
	}

	/* Indent the section links under their group label, with a guide rail, so the
	   two levels of the quick-nav read as a hierarchy rather than a flat list. */
	.settings-nav ul {
		list-style: none;
		padding: 0 0 0 var(--spacing-sm);
		margin: 0 0 0 var(--spacing-md);
		border-left: 1px solid var(--color-overlay-white-10);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.settings-nav li {
		margin: 0;
	}

	.settings-nav .nav-link {
		display: block;
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--color-text-secondary);
		font-size: 0.875rem;
		text-align: left;
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
		position: relative;
	}

	.settings-nav .nav-link:hover:not(.active) {
		background: var(--color-overlay-white-05);
		color: var(--color-text-primary);
	}

	.settings-nav .nav-link.active {
		background: var(--color-accent-primary);
		color: #fff;
		font-weight: 500;
	}

	.nav-group {
		margin-bottom: var(--spacing-md);
	}

	.nav-group:last-child {
		margin-bottom: 0;
	}

	.nav-group-label {
		display: block;
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--color-text-tertiary);
		padding: 0 var(--spacing-md);
		margin-bottom: var(--spacing-xs);
	}

	.category-heading {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--color-text-secondary);
		margin-bottom: var(--spacing-md);
		padding-bottom: var(--spacing-xs);
		border-bottom: 1px solid var(--color-border-default);
	}

	.general-settings {
		flex: 1;
		min-width: 0;
		contain: layout style;
		isolation: isolate;
	}

	.settings-section {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-overlay-white-10);
		border-radius: var(--radius-lg);
		padding: var(--spacing-xl);
		margin-bottom: var(--spacing-lg);
		scroll-margin-top: var(--spacing-2xl);
		contain: layout;
		position: relative;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-lg);
	}

	.settings-section h2 {
		font-size: 1.25rem;
		margin-bottom: var(--spacing-lg);
	}

	/* A description paragraph right under a section heading needs breathing room
	   before the controls that follow (e.g. the Account "Change Password" button). */
	.settings-section h2 + p.text-muted {
		margin-bottom: var(--spacing-lg);
	}

	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-lg);
		margin-bottom: var(--spacing-lg);
	}

	.form-row:last-child {
		margin-bottom: 0;
	}

	@media (max-width: 600px) {
		.form-row {
			grid-template-columns: 1fr;
		}
	}

	.toggle-label {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		cursor: pointer;
		font-weight: 600;
	}

	.nested-field {
		margin-left: var(--spacing-xl);
		padding-left: var(--spacing-lg);
		border-left: 2px solid var(--color-overlay-white-10);
	}

	.user-checkboxes {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		font-weight: 400;
		cursor: pointer;
	}

	.cookie-upload-label {
		cursor: pointer;
	}

	.cookie-upload-label:has(input:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.cleanup-section {
		margin-top: var(--spacing-lg);
		padding-top: var(--spacing-lg);
		border-top: 1px solid var(--color-overlay-white-06);
	}

	.jellyfin-test {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-lg);
	}

	.test-result {
		font-size: 0.8125rem;
		font-weight: 500;
	}

	.test-result.success {
		color: var(--color-status-success);
	}

	.test-result.error {
		color: var(--color-status-error);
	}

	.form-group {
		margin-bottom: var(--spacing-lg);
	}

	.form-row .form-group {
		margin-bottom: 0;
	}

	.form-group:last-child {
		margin-bottom: 0;
	}

	label {
		display: block;
		margin-bottom: var(--spacing-sm);
		color: var(--color-text-primary);
		font-weight: 500;
	}

	label input[type='checkbox'] {
		width: auto;
		margin-right: var(--spacing-sm);
	}

	input[type='text'],
	input[type='number'],
	input[type='email'],
	textarea {
		width: 100%;
		padding: var(--spacing-md);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-overlay-white-10);
		border-radius: var(--radius-md);
		color: var(--color-text-primary);
		font-size: 1rem;
		font-family: inherit;
		resize: vertical;
	}

	select {
		width: 100%;
		padding: var(--spacing-md);
		padding-right: calc(var(--spacing-md) + 20px);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-overlay-white-10);
		border-radius: var(--radius-md);
		color: var(--color-text-primary);
		font-size: 1rem;
	}

	select:focus,
	input:focus {
		outline: none;
		border-color: var(--color-accent-primary);
	}

	input.invalid,
	input.invalid:focus {
		border-color: var(--color-status-error);
	}

	input[readonly] {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.help-text {
		margin-top: var(--spacing-xs);
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	.error-text {
		color: var(--color-status-error);
	}

	.info-box {
		background: rgba(59, 130, 246, 0.1);
		border: 1px solid rgba(59, 130, 246, 0.3);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
		font-size: 0.875rem;
	}

	.warning-box {
		background: rgba(245, 158, 11, 0.1);
		border-color: rgba(245, 158, 11, 0.4);
		color: var(--color-text-primary);
	}

	.warning-box code {
		background: var(--color-overlay-white-10);
		padding: 2px 6px;
		border-radius: 4px;
		font-size: 0.8125rem;
	}

	.error-box {
		background: var(--color-status-error-bg);
		border-color: var(--color-status-error);
		color: var(--color-text-primary);
	}

	.managed-box {
		background: var(--color-overlay-white-10);
		border-color: var(--color-border-translucent);
		color: var(--color-text-secondary);
	}

	.managed-box code {
		background: var(--color-overlay-white-10);
		padding: 2px 6px;
		border-radius: 4px;
		font-size: 0.8125rem;
	}

	.error-box .error-detail {
		display: block;
		margin-top: var(--spacing-xs);
		color: var(--color-text-secondary);
		font-size: 0.8125rem;
	}

	.youtube-links {
		margin-top: var(--spacing-lg);
		padding-top: var(--spacing-lg);
		border-top: 1px solid var(--color-border-translucent);
	}

	.youtube-links h3 {
		margin: 0 0 var(--spacing-sm);
		font-size: 0.9375rem;
	}

	.link-buttons {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-sm);
	}

	.link-buttons .btn {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		text-decoration: none;
	}

	.create-user-form {
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-overlay-white-10);
		border-radius: var(--radius-md);
		padding: var(--spacing-lg);
		margin-bottom: var(--spacing-xl);
	}

	.create-user-form h3 {
		font-size: 1.125rem;
		margin-bottom: var(--spacing-lg);
	}

	.password-suggestions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: var(--spacing-xs);
	}

	.suggestion {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		opacity: 0.6;
		transition: all var(--transition-fast);
	}

	.suggestion.met {
		color: var(--color-status-success, #22c55e);
		opacity: 1;
	}

	.suggestion::before {
		content: '○ ';
	}

	.suggestion.met::before {
		content: '● ';
	}

	.error-message {
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid var(--color-status-error);
		color: var(--color-status-error);
		padding: var(--spacing-md);
		border-radius: var(--radius-md);
		margin-bottom: var(--spacing-lg);
		font-size: 0.875rem;
	}

	.users-search {
		margin-bottom: var(--spacing-lg);
	}

	.danger-zone {
		border: 1px solid var(--color-status-error);
		border-radius: var(--radius-lg);
	}

	.danger-zone h2 {
		color: var(--color-status-error);
	}

	.danger-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-lg);
		flex-wrap: wrap;
	}

	.danger-info {
		min-width: 0;
	}

	.danger-title {
		font-weight: var(--font-weight-semibold);
		margin-bottom: var(--spacing-xs);
	}

	.danger-row .help-text {
		margin: 0;
	}

	.users-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	.users-pagination {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-md);
		margin-top: var(--spacing-lg);
	}

	.users-pagination-info {
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	.users-pagination-controls {
		display: flex;
		gap: var(--spacing-sm);
	}

	.user-card {
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-overlay-white-10);
		border-radius: var(--radius-md);
		padding: var(--spacing-lg);
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.user-info {
		flex: 1;
	}

	.user-name {
		font-weight: 600;
		font-size: 1.125rem;
		margin-bottom: var(--spacing-xs);
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.user-email {
		color: var(--color-text-secondary);
		font-size: 0.875rem;
		margin-bottom: var(--spacing-xs);
	}

	.user-stats {
		color: var(--color-text-tertiary);
		font-size: 0.875rem;
	}

	.user-overrides {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-lg);
		margin-top: var(--spacing-md);
	}

	.user-override {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.user-override label {
		margin-bottom: 0;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.user-override select {
		width: auto;
		min-width: 130px;
		font-size: 0.875rem;
		padding: var(--spacing-sm) var(--spacing-md);
	}

	.user-quota-input {
		display: flex;
		gap: var(--spacing-sm);
		align-items: center;
	}

	.user-quota-input input {
		width: 110px;
		font-size: 0.875rem;
		padding: var(--spacing-sm) var(--spacing-md);
	}

	/* Library requests */
	.requests-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
		margin-top: var(--spacing-md);
	}

	.request-card {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		padding: var(--spacing-md);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-overlay-white-10);
		border-radius: var(--radius-md);
	}

	.request-thumb {
		width: 96px;
		height: 54px;
		object-fit: cover;
		border-radius: var(--radius-sm);
		flex-shrink: 0;
		background: var(--color-bg-secondary);
	}

	.request-thumb-placeholder {
		background: var(--color-overlay-white-05);
	}

	.request-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}

	.request-title {
		font-weight: 500;
		font-size: 0.9375rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.request-uploader {
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.request-meta {
		font-size: 0.75rem;
		color: var(--color-text-tertiary);
	}

	.request-actions {
		display: flex;
		gap: var(--spacing-sm);
		flex-shrink: 0;
	}

	.user-actions {
		display: flex;
		gap: var(--spacing-sm);
	}

	.badge {
		display: inline-block;
		padding: 2px 8px;
		border-radius: 4px;
		font-size: 0.75rem;
		font-weight: 500;
	}

	.badge-admin {
		background: var(--color-accent-primary);
		color: white;
	}

	/* Buttons use the global .btn system (src/app.css) for consistent
	   appearance and hover/active behavior. */

	.btn-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-sm) !important;
		line-height: 1;
	}

	.btn-icon svg {
		display: block;
	}

	.btn-with-icon {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.btn-with-icon :global(svg) {
		flex-shrink: 0;
	}

	.btn-lg {
		padding: var(--spacing-md) var(--spacing-xl);
		margin-top: var(--spacing-xl);
	}

	.api-docs-link {
		margin-top: var(--spacing-xl);
		padding-top: var(--spacing-xl);
		border-top: 1px solid var(--color-border-default);
	}

	.api-docs-link a {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-sm);
		text-decoration: none;
		color: var(--color-text-secondary);
	}

	.api-docs-link a:hover {
		color: var(--color-text-primary);
	}

	.api-keys-section {
		margin-top: var(--spacing-xl);
	}

	.create-key-form {
		display: flex;
		gap: var(--spacing-sm);
		margin-bottom: var(--spacing-md);
	}

	.create-key-form input {
		flex: 1;
	}

	.api-key-display {
		display: block;
		margin: var(--spacing-sm) 0;
		padding: var(--spacing-sm);
		background: var(--color-bg-tertiary);
		border-radius: var(--radius-sm);
		word-break: break-all;
		font-size: 0.85rem;
	}

	.api-keys-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.api-key-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
	}

	.api-key-info {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		flex-wrap: wrap;
	}

	.api-key-name {
		font-weight: 500;
	}

	.api-key-prefix {
		font-size: 0.85rem;
		color: var(--color-text-secondary);
	}

	.api-key-meta {
		font-size: 0.8rem;
		color: var(--color-text-tertiary);
	}

	/* YouTube section */
	.youtube-status {
		margin-bottom: var(--spacing-md);
	}

	.youtube-link-info {
		color: var(--color-text-primary);
		margin-bottom: var(--spacing-sm);
	}

	.youtube-toggles {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		margin: var(--spacing-md) 0;
	}

	.youtube-toggles label {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		cursor: pointer;
		padding: var(--spacing-xs);
	}

	.youtube-toggles label:hover {
		background: var(--color-overlay-white-05);
		border-radius: var(--radius-sm);
	}

	.youtube-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-sm);
		margin-top: var(--spacing-md);
	}

	.btn-primary:disabled,
	.btn-secondary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.badge-you {
		background: rgba(59, 130, 246, 0.2);
		color: var(--color-accent-primary);
		border: 1px solid var(--color-accent-primary);
	}

	/* Rescan styles */
	.rescan-actions {
		margin-bottom: var(--spacing-lg);
	}

	.rescan-results {
		margin-top: var(--spacing-md);
	}

	.rescan-summary {
		display: flex;
		gap: var(--spacing-lg);
		margin-bottom: var(--spacing-md);
	}

	.rescan-stat {
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.rescan-stat.ok {
		color: var(--color-status-success, #22c55e);
	}

	.rescan-stat.missing {
		color: var(--color-status-error);
	}

	.rescan-bulk-actions {
		display: flex;
		gap: var(--spacing-sm);
		margin-bottom: var(--spacing-md);
	}

	.rescan-missing-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.rescan-missing-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-md);
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-overlay-white-06);
		border-radius: var(--radius-md);
	}

	.rescan-missing-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}

	.rescan-missing-title {
		font-weight: 500;
		font-size: 0.875rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.rescan-missing-path {
		font-size: 0.75rem;
		color: var(--color-text-tertiary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.rescan-missing-actions {
		flex-shrink: 0;
	}

	/* Modal styles */
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: var(--color-overlay-medium);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: var(--z-modal);
		padding: var(--spacing-lg);
	}

	.modal-content {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		max-width: var(--modal-max-width);
		width: 100%;
		max-height: 90vh;
		overflow-y: auto;
		box-shadow: var(--shadow-xl);
		outline: none;
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-lg);
		border-bottom: 1px solid var(--color-border-default);
	}

	.import-diff-table {
		width: 100%;
		border-collapse: collapse;
		margin-bottom: var(--spacing-lg);
		font-size: var(--font-size-sm);
	}

	.import-diff-table th,
	.import-diff-table td {
		text-align: left;
		padding: var(--spacing-sm);
		border-bottom: 1px solid var(--color-border-default);
		vertical-align: top;
		word-break: break-word;
	}

	.import-diff-table th {
		color: var(--color-text-secondary);
		font-weight: 600;
	}

	.import-diff-field {
		font-family: var(--font-mono, monospace);
		color: var(--color-text-secondary);
	}

	.import-diff-from {
		color: var(--color-text-secondary);
		text-decoration: line-through;
	}

	.import-diff-to {
		color: var(--color-text-primary);
		font-weight: 600;
	}

	.modal-header h3 {
		margin: 0;
		font-size: var(--font-size-xl);
	}

	.modal-close {
		background: transparent;
		border: none;
		color: var(--color-text-secondary);
		font-size: 2rem;
		line-height: 1;
		cursor: pointer;
		padding: 0;
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: var(--transition-fast);
	}

	.modal-close:hover {
		color: var(--color-text-primary);
	}

	.modal-body {
		padding: var(--spacing-lg);
	}

	.modal-actions {
		display: flex;
		gap: var(--spacing-md);
		justify-content: flex-end;
		margin-top: var(--spacing-lg);
	}

	@media (max-width: 768px) {
		.page {
			padding: 0 var(--spacing-sm);
		}

		.settings-container {
			flex-direction: column;
		}

		.settings-nav {
			display: none;
		}

		.general-settings {
			width: 100%;
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

		.settings-section {
			padding: var(--spacing-md);
		}

		.settings-section h2 {
			font-size: 1.25rem;
		}

		.form-row {
			grid-template-columns: 1fr;
		}

		.form-group input[type='text'],
		.form-group input[type='number'],
		.form-group input[type='email'],
		.form-group select {
			font-size: 1rem;
		}

		.section-header {
			flex-direction: column;
			gap: var(--spacing-md);
		}

		.section-header .btn-secondary {
			width: 100%;
		}

		.nested-field {
			margin-left: var(--spacing-sm);
			padding-left: var(--spacing-md);
		}

		.jellyfin-test {
			flex-wrap: wrap;
		}

		.create-user-form {
			padding: var(--spacing-md);
		}

		.user-card {
			flex-direction: column;
			align-items: flex-start;
			padding: var(--spacing-md);
		}

		.user-actions {
			width: 100%;
			flex-wrap: wrap;
		}

		.user-overrides {
			width: 100%;
		}

		.request-card {
			flex-wrap: wrap;
		}

		.request-actions {
			width: 100%;
		}

		.request-actions button {
			flex: 1;
			min-height: 44px;
		}

		.user-actions button {
			flex: 1;
			min-width: 0;
			min-height: 44px;
		}

		.btn-lg {
			width: 100%;
		}

		.tab {
			min-height: 44px;
		}

		.form-group input[type='text'],
		.form-group input[type='number'],
		.form-group input[type='email'],
		.form-group select {
			min-height: 44px;
		}

		.modal-content {
			margin: var(--spacing-sm);
			max-width: calc(100vw - var(--spacing-md));
		}

		.modal-header,
		.modal-body {
			padding: var(--spacing-md);
		}

		.modal-actions {
			flex-direction: column;
		}

		.modal-actions button {
			width: 100%;
			min-height: 44px;
		}
	}

	@media (max-width: 480px) {
		.settings-section {
			padding: var(--spacing-sm);
		}

		.create-user-form {
			padding: var(--spacing-sm);
		}
	}
</style>
