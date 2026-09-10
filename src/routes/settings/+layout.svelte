<script lang="ts">
	import "./settings.css";
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
	import ExtensionMenu from '$lib/components/ExtensionMenu.svelte';
	import { REPO_URL } from '$lib/extension-links';

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

	let { data, children }: { data: any, children: import("svelte").Snippet } = $props();

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
	import { page } from '$app/stores';
	let activeTab = $derived($page.url.pathname.split('/').filter(Boolean).pop() || 'account');
	let activeSection = $state<string>('');

import { untrack } from 'svelte';
$effect(() => {
    const tab = activeTab;
    const valid = settingsSections.map((s) => s.id);
    
    untrack(() => {
        if (!activeSection || !valid.includes(activeSection)) {
            if (tab === 'account') activeSection = 'account';
            else if (tab === 'app') activeSection = 'storage';
            else if (tab === 'users') activeSection = 'user-management';
        }
    });
});

	// Settings sections grouped into labeled categories. The flat list of
	// section ids (derived below) is used for scroll-spy / IntersectionObserver.
	let settingsGroups = [
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

	// The User Settings and Users tabs get the same grouped quick-nav as App Settings.
	let accountGroups = $derived([
		{
			label: 'Profile',
			sections: [
				{ id: 'account', label: 'User Settings' },
				{ id: 'api-keys', label: 'API Keys' },
			],
		},
		{
			label: 'Integrations',
			sections: isAdmin
				? [
						{ id: 'youtube', label: 'YouTube' },
						{ id: 'jellyfin', label: 'Jellyfin' },
					]
				: [{ id: 'youtube', label: 'YouTube' }],
		},
	]);

	let usersGroups = [
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
	let navGroups = $derived(
		activeTab === 'account' ? accountGroups : activeTab === 'users' ? usersGroups : settingsGroups,
	);

	// Flat list of section ids for the current tab (used by the scroll-spy observer).
	let settingsSections = $derived(navGroups.flatMap((g) => g.sections));

	// Switching tabs swaps the quick-nav out, so point the scroll-spy at the new
	// tab's first section rather than leaving it on a section that is gone.
	import { goto } from '$app/navigation';
	import { setContext } from 'svelte';
	setContext('activeSection', () => activeSection);
	function selectTab(tab: 'account' | 'app' | 'users') {
		activeSection = tab === 'account' ? 'account' : tab === 'users' ? 'user-management' : 'storage';
		goto(`/settings/${tab}`);
	}

	// Scroll-spy suppression: while a nav link is being clicked we smooth-scroll
	// and pin the active section so the observer doesn't flash through
	// intermediate sections. Cleared once the scroll settles (scrollend / fallback).
	let suppressSpy = false;
	let suppressSpyTimeout: ReturnType<typeof setTimeout> | undefined;

	function selectSection(sectionId: string) {
		activeSection = sectionId;
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

	// Per-account overrides for the linked YouTube account (yt-dlp + notifications)
	let accountProxyUrl = $state('');
	let accountExtraFlagsText = $state('');
	let accountAppriseUrl = $state('');
	let accountNotifyOnComplete = $state(false);
	let accountNotifyOnFail = $state(false);
	let savingAccountSettings = $state(false);
	let accountSettingsResult = $state<{ success: boolean; message: string } | null>(null);
	const ACCOUNT_PROXY_SCHEMES = ['http:', 'https:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'];
	let accountProxyUrlError = $derived.by(() => {
		const value = accountProxyUrl.trim();
		if (value === '') return null;
		try {
			if (ACCOUNT_PROXY_SCHEMES.includes(new URL(value).protocol)) return null;
		} catch {
			// fall through to the error
		}
		return 'Needs a complete proxy URL, e.g. socks5://host:port (schemes: http, https, socks4, socks4a, socks5, socks5h)';
	});

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
				const skippedNote = result.skipped
					? ` — skipped ${result.skipped} whose file exists again`
					: '';
				addToast(
					'success',
					`Deleted ${result.deleted} record${result.deleted === 1 ? '' : 's'}${skippedNote}`,
				);
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
				const skippedNote = result.skipped
					? ` — skipped ${result.skipped} whose file exists again`
					: '';
				addToast(
					'success',
					`Marked ${result.marked} record${result.marked === 1 ? '' : 's'} as deleted${skippedNote}`,
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

	// ScrollSpy removed in favor of single-section rendering

	onMount(() => {
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
		'jellyfinLocalPath',
		'jellyfinRemotePath',
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
	let jellyfinSetupResult = $state<{ success: boolean; message: string } | null>(null);
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
			settings.jellyfinLocalPath = null;
			settings.jellyfinRemotePath = null;
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

	let settingUpJellyfin = $state(false);
	let writingNfo = $state(false);

	async function setupJellyfinLibrary() {
		// Guard before the confirm dialog: a double click must not open two
		// confirms or fire two concurrent setup requests.
		if (settingUpJellyfin) return;
		settingUpJellyfin = true;
		jellyfinSetupResult = null;
		try {
			const confirmed = await showConfirm(
				'Set up Jellyfin library',
				'Creates or fixes the Jellyfin library for your wytui paths (Movies, NFO-only metadata). If an existing library uses another type (e.g. Home Videos) it will be rebuilt — Jellyfin watch history for it resets. Media files are not touched.',
			);
			if (!confirmed) return;
			const res = await csrfFetch('/api/settings/jellyfin-setup', { method: 'POST' });
			const data = await res.json();
			if (!res.ok || !data.success) {
				jellyfinSetupResult = {
					success: false,
					message: data.error ?? `Request failed (${res.status})`,
				};
				return;
			}
			const describe = (lib: any) => {
				const type = lib.collectionType === 'movies' ? 'Movies' : 'Music';
				const verb =
					lib.action === 'created'
						? 'Created'
						: lib.action === 'converted'
							? 'Rebuilt'
							: 'Already OK';
				return `${verb} "${lib.name}" (${type})`;
			};
			const parts = [describe(data.video)];
			if (data.music) parts.push(describe(data.music));
			const warnings = [...(data.video?.warnings ?? []), ...(data.music?.warnings ?? [])];
			jellyfinSetupResult = {
				success: true,
				message: parts.join(' · ') + (warnings.length ? ` — ${warnings.join(' ')}` : ''),
			};
		} catch {
			jellyfinSetupResult = { success: false, message: 'Request failed' };
		} finally {
			settingUpJellyfin = false;
		}
	}

	async function writeJellyfinMetadata() {
		writingNfo = true;
		jellyfinSetupResult = null;
		try {
			const res = await csrfFetch('/api/settings/jellyfin-metadata', { method: 'POST' });
			const data = await res.json();
			if (!res.ok || !data.success) {
				jellyfinSetupResult = {
					success: false,
					message: data.error ?? `Request failed (${res.status})`,
				};
				return;
			}
			jellyfinSetupResult = {
				success: true,
				message: `Wrote metadata for ${data.movies} videos across ${data.channels} channels`,
			};
		} catch {
			jellyfinSetupResult = { success: false, message: 'Request failed' };
		} finally {
			writingNfo = false;
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
				applyAccountState(youtubeLink);
			}
			// Jellyfin user picker for the history sync (best-effort).
			const jres = await fetch('/api/youtube/jellyfin-users');
			if (jres.ok) {
				const jdata = await jres.json();
				jellyfinUsers = jdata.users ?? [];
			}
			jellyfinUserChoice = youtubeLink.jellyfinUserId ?? '';
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

	function applyAccountState(link: any) {
		accountProxyUrl = link?.ytdlp?.proxyUrl ?? '';
		accountExtraFlagsText = (link?.ytdlp?.extraFlags ?? []).join('\n');
		accountAppriseUrl = link?.notifications?.appriseUrl ?? '';
		accountNotifyOnComplete = link?.notifications?.notifyOnComplete ?? false;
		accountNotifyOnFail = link?.notifications?.notifyOnFail ?? false;
	}

	async function saveAccountSettings() {
		if (accountProxyUrlError) return;
		savingAccountSettings = true;
		accountSettingsResult = null;
		try {
			const res = await csrfFetch('/api/youtube/link', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					proxyUrl: accountProxyUrl.trim() || null,
					extraFlags: accountExtraFlagsText
						.split('\n')
						.map((line: string) => line.trim())
						.filter(Boolean),
					appriseUrl: accountAppriseUrl.trim() || null,
					notifyOnComplete: accountNotifyOnComplete,
					notifyOnFail: accountNotifyOnFail,
				}),
			});
			const data = await res.json().catch(() => null);
			if (!res.ok) {
				accountSettingsResult = {
					success: false,
					message: data?.message ?? `Request failed (${res.status})`,
				};
				return;
			}
			youtubeLink = data;
			applyAccountState(data);
			accountSettingsResult = { success: true, message: 'Saved — applies to this account only' };
		} catch {
			accountSettingsResult = { success: false, message: 'Request failed' };
		} finally {
			savingAccountSettings = false;
		}
	}

	async function testAccountNotifications() {
		accountSettingsResult = null;
		try {
			const res = await csrfFetch('/api/youtube/link/test', { method: 'POST' });
			if (res.ok) {
				accountSettingsResult = { success: true, message: 'Test notification sent' };
			} else {
				const data = await res.json().catch(() => null);
				accountSettingsResult = {
					success: false,
					message: data?.message ?? `Request failed (${res.status})`,
				};
			}
		} catch {
			accountSettingsResult = { success: false, message: 'Request failed' };
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
	let jellyfinUserChoice = $state('');
	let exportingOPML = $state(false);
	let exportingCSV = $state(false);

	async function syncWatchLater() {
		if (syncingWatchLater) return;
		syncingWatchLater = true;
		try {
			const res = await csrfFetch('/api/youtube/watch-later', {
				method: 'POST',
			});
			const data = await res.json().catch(() => null);
			if (data?.needsRelink) {
				addToast('error', 'YouTube session expired — re-link via the extension');
				youtubeLink = { linked: false };
			} else if (!res.ok) {
				addToast('error', data?.error ?? 'Failed to sync Watch Later');
			} else {
				const added = data.added ?? 0;
				addToast(
					'success',
					added > 0
						? `Watch Later synced — ${added} new video${added === 1 ? '' : 's'} added`
						: 'Watch Later synced — nothing new',
				);
			}
		} catch {
			addToast('error', 'Failed to sync Watch Later');
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
					return;
				}
				if (data.errors?.length) {
					addToast('error', data.errors[0]);
					return;
				}
				const marked = data.marked ?? 0;
				const jf = data.jellyfin;
				let msg = `History synced \u2014 ${marked} video${marked === 1 ? '' : 's'} marked watched`;
				if (jf?.user && jf.marked > 0) {
					msg += `, ${jf.marked} marked played in Jellyfin`;
				}
				addToast('success', msg);
				if (data.watchLaterAdded > 0) {
					addToast('info', `Watch Later synced — ${data.watchLaterAdded} new video(s) added`);
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

	async function updateJellyfinUser(value: string) {
		try {
			const res = await csrfFetch('/api/youtube/link', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ jellyfinUserId: value || null }),
			});
			if (res.ok) {
				youtubeLink = await res.json();
				addToast('success', 'Jellyfin user saved');
			} else {
				addToast('error', 'Failed to save Jellyfin user');
			}
		} catch {
			addToast('error', 'Failed to save Jellyfin user');
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


	const __state = {
		get data() { return data; },
		get settings() { return settings; },
		set settings(v) { /* 
			@ts-ignore */
			try { settings = v; } catch(e) {} },
		get settingsError() { return settingsError; },
		set settingsError(v) { /* 
			@ts-ignore */
			try { settingsError = v; } catch(e) {} },
		get users() { return users; },
		set users(v) { /* 
			@ts-ignore */
			try { users = v; } catch(e) {} },
		get USERS_PAGE_SIZE() { return USERS_PAGE_SIZE; },
		
		get userSearch() { return userSearch; },
		set userSearch(v) { /* 
			@ts-ignore */
			try { userSearch = v; } catch(e) {} },
		get usersOffset() { return usersOffset; },
		set usersOffset(v) { /* 
			@ts-ignore */
			try { usersOffset = v; } catch(e) {} },
		get usersTotal() { return usersTotal; },
		set usersTotal(v) { /* 
			@ts-ignore */
			try { usersTotal = v; } catch(e) {} },
		get usersLoading() { return usersLoading; },
		set usersLoading(v) { /* 
			@ts-ignore */
			try { usersLoading = v; } catch(e) {} },
		get userSearchTimeout() { return userSearchTimeout; },
		set userSearchTimeout(v) { /* 
			@ts-ignore */
			try { userSearchTimeout = v; } catch(e) {} },
		get loading() { return loading; },
		set loading(v) { /* 
			@ts-ignore */
			try { loading = v; } catch(e) {} },
		get saving() { return saving; },
		set saving(v) { /* 
			@ts-ignore */
			try { saving = v; } catch(e) {} },
		get settingsLoaded() { return settingsLoaded; },
		set settingsLoaded(v) { /* 
			@ts-ignore */
			try { settingsLoaded = v; } catch(e) {} },
		get settingsSnapshot() { return settingsSnapshot; },
		set settingsSnapshot(v) { /* 
			@ts-ignore */
			try { settingsSnapshot = v; } catch(e) {} },
		get ytdlpExtraFlagsText() { return ytdlpExtraFlagsText; },
		set ytdlpExtraFlagsText(v) { /* 
			@ts-ignore */
			try { ytdlpExtraFlagsText = v; } catch(e) {} },
		get saveTimeout() { return saveTimeout; },
		set saveTimeout(v) { /* 
			@ts-ignore */
			try { saveTimeout = v; } catch(e) {} },
		get isAdmin() { return isAdmin; },
		set isAdmin(v) { /* 
			@ts-ignore */
			try { isAdmin = v; } catch(e) {} },
		get activeSection() { return activeSection; },
		set activeSection(v) { /* 
			@ts-ignore */
			try { activeSection = v; } catch(e) {} },
		get settingsGroups() { return settingsGroups; },
		set settingsGroups(v) { /* 
			@ts-ignore */
			try { settingsGroups = v; } catch(e) {} },
		get accountGroups() { return accountGroups; },
		set accountGroups(v) { /* 
			@ts-ignore */
			try { accountGroups = v; } catch(e) {} },
		get usersGroups() { return usersGroups; },
		set usersGroups(v) { /* 
			@ts-ignore */
			try { usersGroups = v; } catch(e) {} },
		get navGroups() { return navGroups; },
		set navGroups(v) { /* 
			@ts-ignore */
			try { navGroups = v; } catch(e) {} },
		get settingsSections() { return settingsSections; },
		set settingsSections(v) { /* 
			@ts-ignore */
			try { settingsSections = v; } catch(e) {} },
		get selectTab() { return selectTab; },
		set selectTab(v) { /* 
			@ts-ignore */
			try { selectTab = v; } catch(e) {} },
		get suppressSpy() { return suppressSpy; },
		set suppressSpy(v) { /* 
			@ts-ignore */
			try { suppressSpy = v; } catch(e) {} },
		get suppressSpyTimeout() { return suppressSpyTimeout; },
		set suppressSpyTimeout(v) { /* 
			@ts-ignore */
			try { suppressSpyTimeout = v; } catch(e) {} },
		get showCreateUser() { return showCreateUser; },
		set showCreateUser(v) { /* 
			@ts-ignore */
			try { showCreateUser = v; } catch(e) {} },
		get newUser() { return newUser; },
		set newUser(v) { /* 
			@ts-ignore */
			try { newUser = v; } catch(e) {} },
		get createUserError() { return createUserError; },
		set createUserError(v) { /* 
			@ts-ignore */
			try { createUserError = v; } catch(e) {} },
		get apiKeys() { return apiKeys; },
		set apiKeys(v) { /* 
			@ts-ignore */
			try { apiKeys = v; } catch(e) {} },
		get newKeyName() { return newKeyName; },
		set newKeyName(v) { /* 
			@ts-ignore */
			try { newKeyName = v; } catch(e) {} },
		get newKeyResult() { return newKeyResult; },
		set newKeyResult(v) { /* 
			@ts-ignore */
			try { newKeyResult = v; } catch(e) {} },
		get youtubeLink() { return youtubeLink; },
		set youtubeLink(v) { /* 
			@ts-ignore */
			try { youtubeLink = v; } catch(e) {} },
		get youtubeLoading() { return youtubeLoading; },
		set youtubeLoading(v) { /* 
			@ts-ignore */
			try { youtubeLoading = v; } catch(e) {} },
		get showImportModal() { return showImportModal; },
		set showImportModal(v) { /* 
			@ts-ignore */
			try { showImportModal = v; } catch(e) {} },
		get accountProxyUrl() { return accountProxyUrl; },
		set accountProxyUrl(v) { /* 
			@ts-ignore */
			try { accountProxyUrl = v; } catch(e) {} },
		get accountExtraFlagsText() { return accountExtraFlagsText; },
		set accountExtraFlagsText(v) { /* 
			@ts-ignore */
			try { accountExtraFlagsText = v; } catch(e) {} },
		get accountAppriseUrl() { return accountAppriseUrl; },
		set accountAppriseUrl(v) { /* 
			@ts-ignore */
			try { accountAppriseUrl = v; } catch(e) {} },
		get accountNotifyOnComplete() { return accountNotifyOnComplete; },
		set accountNotifyOnComplete(v) { /* 
			@ts-ignore */
			try { accountNotifyOnComplete = v; } catch(e) {} },
		get accountNotifyOnFail() { return accountNotifyOnFail; },
		set accountNotifyOnFail(v) { /* 
			@ts-ignore */
			try { accountNotifyOnFail = v; } catch(e) {} },
		get savingAccountSettings() { return savingAccountSettings; },
		set savingAccountSettings(v) { /* 
			@ts-ignore */
			try { savingAccountSettings = v; } catch(e) {} },
		get accountSettingsResult() { return accountSettingsResult; },
		set accountSettingsResult(v) { /* 
			@ts-ignore */
			try { accountSettingsResult = v; } catch(e) {} },
		get ACCOUNT_PROXY_SCHEMES() { return ACCOUNT_PROXY_SCHEMES; },
		
		get accountProxyUrlError() { return accountProxyUrlError; },
		set accountProxyUrlError(v) { /* 
			@ts-ignore */
			try { accountProxyUrlError = v; } catch(e) {} },
		get libraryRequests() { return libraryRequests; },
		set libraryRequests(v) { /* 
			@ts-ignore */
			try { libraryRequests = v; } catch(e) {} },
		get loadingRequests() { return loadingRequests; },
		set loadingRequests(v) { /* 
			@ts-ignore */
			try { loadingRequests = v; } catch(e) {} },
		get processingRequestId() { return processingRequestId; },
		set processingRequestId(v) { /* 
			@ts-ignore */
			try { processingRequestId = v; } catch(e) {} },
		get userQuotaDrafts() { return userQuotaDrafts; },
		set userQuotaDrafts(v) { /* 
			@ts-ignore */
			try { userQuotaDrafts = v; } catch(e) {} },
		get passwordChangeUserId() { return passwordChangeUserId; },
		set passwordChangeUserId(v) { /* 
			@ts-ignore */
			try { passwordChangeUserId = v; } catch(e) {} },
		get passwordModalEl() { return passwordModalEl; },
		set passwordModalEl(v) { /* 
			@ts-ignore */
			try { passwordModalEl = v; } catch(e) {} },
		get passwordForm() { return passwordForm; },
		set passwordForm(v) { /* 
			@ts-ignore */
			try { passwordForm = v; } catch(e) {} },
		get passwordError() { return passwordError; },
		set passwordError(v) { /* 
			@ts-ignore */
			try { passwordError = v; } catch(e) {} },
		get rescanning() { return rescanning; },
		set rescanning(v) { /* 
			@ts-ignore */
			try { rescanning = v; } catch(e) {} },
		get rescanReport() { return rescanReport; },
		set rescanReport(v) { /* 
			@ts-ignore */
			try { rescanReport = v; } catch(e) {} },
		get reconciling() { return reconciling; },
		set reconciling(v) { /* 
			@ts-ignore */
			try { reconciling = v; } catch(e) {} },
		get runRescan() { return runRescan; },
		set runRescan(v) { /* 
			@ts-ignore */
			try { runRescan = v; } catch(e) {} },
		get deleteRescanRecords() { return deleteRescanRecords; },
		set deleteRescanRecords(v) { /* 
			@ts-ignore */
			try { deleteRescanRecords = v; } catch(e) {} },
		get markRescanMissing() { return markRescanMissing; },
		set markRescanMissing(v) { /* 
			@ts-ignore */
			try { markRescanMissing = v; } catch(e) {} },
		get loadSettings() { return loadSettings; },
		set loadSettings(v) { /* 
			@ts-ignore */
			try { loadSettings = v; } catch(e) {} },
		get loadUsers() { return loadUsers; },
		set loadUsers(v) { /* 
			@ts-ignore */
			try { loadUsers = v; } catch(e) {} },
		get onUserSearchInput() { return onUserSearchInput; },
		set onUserSearchInput(v) { /* 
			@ts-ignore */
			try { onUserSearchInput = v; } catch(e) {} },
		get usersPrevPage() { return usersPrevPage; },
		set usersPrevPage(v) { /* 
			@ts-ignore */
			try { usersPrevPage = v; } catch(e) {} },
		get usersNextPage() { return usersNextPage; },
		set usersNextPage(v) { /* 
			@ts-ignore */
			try { usersNextPage = v; } catch(e) {} },
		get reloadUsersClamped() { return reloadUsersClamped; },
		set reloadUsersClamped(v) { /* 
			@ts-ignore */
			try { reloadUsersClamped = v; } catch(e) {} },
		get SAVEABLE_FIELDS() { return SAVEABLE_FIELDS; },
		
		get diskInfo() { return diskInfo; },
		set diskInfo(v) { /* 
			@ts-ignore */
			try { diskInfo = v; } catch(e) {} },
		get diskTotalGB() { return diskTotalGB; },
		set diskTotalGB(v) { /* 
			@ts-ignore */
			try { diskTotalGB = v; } catch(e) {} },
		get cacheQuotaGB() { return cacheQuotaGB; },
		set cacheQuotaGB(v) { /* 
			@ts-ignore */
			try { cacheQuotaGB = v; } catch(e) {} },
		get cacheQuotaExceedsDisk() { return cacheQuotaExceedsDisk; },
		set cacheQuotaExceedsDisk(v) { /* 
			@ts-ignore */
			try { cacheQuotaExceedsDisk = v; } catch(e) {} },
		get totalCacheGB() { return totalCacheGB; },
		set totalCacheGB(v) { /* 
			@ts-ignore */
			try { totalCacheGB = v; } catch(e) {} },
		get autoTotalCacheGB() { return autoTotalCacheGB; },
		set autoTotalCacheGB(v) { /* 
			@ts-ignore */
			try { autoTotalCacheGB = v; } catch(e) {} },
		get totalCacheExceedsDisk() { return totalCacheExceedsDisk; },
		set totalCacheExceedsDisk(v) { /* 
			@ts-ignore */
			try { totalCacheExceedsDisk = v; } catch(e) {} },
		get libraryEnabled() { return libraryEnabled; },
		set libraryEnabled(v) { /* 
			@ts-ignore */
			try { libraryEnabled = v; } catch(e) {} },
		get jellyfinEnabled() { return jellyfinEnabled; },
		set jellyfinEnabled(v) { /* 
			@ts-ignore */
			try { jellyfinEnabled = v; } catch(e) {} },
		get plexEnabled() { return plexEnabled; },
		set plexEnabled(v) { /* 
			@ts-ignore */
			try { plexEnabled = v; } catch(e) {} },
		get cleanupEnabled() { return cleanupEnabled; },
		set cleanupEnabled(v) { /* 
			@ts-ignore */
			try { cleanupEnabled = v; } catch(e) {} },
		get loadDiskInfo() { return loadDiskInfo; },
		set loadDiskInfo(v) { /* 
			@ts-ignore */
			try { loadDiskInfo = v; } catch(e) {} },
		get cleaningDownloads() { return cleaningDownloads; },
		set cleaningDownloads(v) { /* 
			@ts-ignore */
			try { cleaningDownloads = v; } catch(e) {} },
		get downloadsCleanupResult() { return downloadsCleanupResult; },
		set downloadsCleanupResult(v) { /* 
			@ts-ignore */
			try { downloadsCleanupResult = v; } catch(e) {} },
		get runDownloadsCleanup() { return runDownloadsCleanup; },
		set runDownloadsCleanup(v) { /* 
			@ts-ignore */
			try { runDownloadsCleanup = v; } catch(e) {} },
		get updateCacheQuota() { return updateCacheQuota; },
		set updateCacheQuota(v) { /* 
			@ts-ignore */
			try { updateCacheQuota = v; } catch(e) {} },
		get updateTotalCacheQuota() { return updateTotalCacheQuota; },
		set updateTotalCacheQuota(v) { /* 
			@ts-ignore */
			try { updateTotalCacheQuota = v; } catch(e) {} },
		get toggleLibrary() { return toggleLibrary; },
		set toggleLibrary(v) { /* 
			@ts-ignore */
			try { toggleLibrary = v; } catch(e) {} },
		get testingJellyfin() { return testingJellyfin; },
		set testingJellyfin(v) { /* 
			@ts-ignore */
			try { testingJellyfin = v; } catch(e) {} },
		get jellyfinSetupResult() { return jellyfinSetupResult; },
		set jellyfinSetupResult(v) { /* 
			@ts-ignore */
			try { jellyfinSetupResult = v; } catch(e) {} },
		get jellyfinTestResult() { return jellyfinTestResult; },
		set jellyfinTestResult(v) { /* 
			@ts-ignore */
			try { jellyfinTestResult = v; } catch(e) {} },
		get jellyfinUsers() { return jellyfinUsers; },
		set jellyfinUsers(v) { /* 
			@ts-ignore */
			try { jellyfinUsers = v; } catch(e) {} },
		get loadingJellyfinUsers() { return loadingJellyfinUsers; },
		set loadingJellyfinUsers(v) { /* 
			@ts-ignore */
			try { loadingJellyfinUsers = v; } catch(e) {} },
		get jellyfinUsersError() { return jellyfinUsersError; },
		set jellyfinUsersError(v) { /* 
			@ts-ignore */
			try { jellyfinUsersError = v; } catch(e) {} },
		get loadJellyfinUsers() { return loadJellyfinUsers; },
		set loadJellyfinUsers(v) { /* 
			@ts-ignore */
			try { loadJellyfinUsers = v; } catch(e) {} },
		get toggleCleanupUser() { return toggleCleanupUser; },
		set toggleCleanupUser(v) { /* 
			@ts-ignore */
			try { toggleCleanupUser = v; } catch(e) {} },
		get cookieStatus() { return cookieStatus; },
		set cookieStatus(v) { /* 
			@ts-ignore */
			try { cookieStatus = v; } catch(e) {} },
		get uploadingCookies() { return uploadingCookies; },
		set uploadingCookies(v) { /* 
			@ts-ignore */
			try { uploadingCookies = v; } catch(e) {} },
		get cookieError() { return cookieError; },
		set cookieError(v) { /* 
			@ts-ignore */
			try { cookieError = v; } catch(e) {} },
		get loadCookieStatus() { return loadCookieStatus; },
		set loadCookieStatus(v) { /* 
			@ts-ignore */
			try { loadCookieStatus = v; } catch(e) {} },
		get uploadCookieFile() { return uploadCookieFile; },
		set uploadCookieFile(v) { /* 
			@ts-ignore */
			try { uploadCookieFile = v; } catch(e) {} },
		get deleteCookieFile() { return deleteCookieFile; },
		set deleteCookieFile(v) { /* 
			@ts-ignore */
			try { deleteCookieFile = v; } catch(e) {} },
		get exportingConfig() { return exportingConfig; },
		set exportingConfig(v) { /* 
			@ts-ignore */
			try { exportingConfig = v; } catch(e) {} },
		get importingConfig() { return importingConfig; },
		set importingConfig(v) { /* 
			@ts-ignore */
			try { importingConfig = v; } catch(e) {} },
		get applyingImport() { return applyingImport; },
		set applyingImport(v) { /* 
			@ts-ignore */
			try { applyingImport = v; } catch(e) {} },
		get importError() { return importError; },
		set importError(v) { /* 
			@ts-ignore */
			try { importError = v; } catch(e) {} },
		get pendingImportYaml() { return pendingImportYaml; },
		set pendingImportYaml(v) { /* 
			@ts-ignore */
			try { pendingImportYaml = v; } catch(e) {} },
		get importPreview() { return importPreview; },
		set importPreview(v) { /* 
			@ts-ignore */
			try { importPreview = v; } catch(e) {} },
		get exportConfig() { return exportConfig; },
		set exportConfig(v) { /* 
			@ts-ignore */
			try { exportConfig = v; } catch(e) {} },
		get handleImportFile() { return handleImportFile; },
		set handleImportFile(v) { /* 
			@ts-ignore */
			try { handleImportFile = v; } catch(e) {} },
		get closeImportPreview() { return closeImportPreview; },
		set closeImportPreview(v) { /* 
			@ts-ignore */
			try { closeImportPreview = v; } catch(e) {} },
		get formatSettingValue() { return formatSettingValue; },
		set formatSettingValue(v) { /* 
			@ts-ignore */
			try { formatSettingValue = v; } catch(e) {} },
		get applyImport() { return applyImport; },
		set applyImport(v) { /* 
			@ts-ignore */
			try { applyImport = v; } catch(e) {} },
		get testingNotification() { return testingNotification; },
		set testingNotification(v) { /* 
			@ts-ignore */
			try { testingNotification = v; } catch(e) {} },
		get notificationTestResult() { return notificationTestResult; },
		set notificationTestResult(v) { /* 
			@ts-ignore */
			try { notificationTestResult = v; } catch(e) {} },
		get testNotification() { return testNotification; },
		set testNotification(v) { /* 
			@ts-ignore */
			try { testNotification = v; } catch(e) {} },
		get toggleJellyfin() { return toggleJellyfin; },
		set toggleJellyfin(v) { /* 
			@ts-ignore */
			try { toggleJellyfin = v; } catch(e) {} },
		get testJellyfinConnection() { return testJellyfinConnection; },
		set testJellyfinConnection(v) { /* 
			@ts-ignore */
			try { testJellyfinConnection = v; } catch(e) {} },
		get settingUpJellyfin() { return settingUpJellyfin; },
		set settingUpJellyfin(v) { /* 
			@ts-ignore */
			try { settingUpJellyfin = v; } catch(e) {} },
		get writingNfo() { return writingNfo; },
		set writingNfo(v) { /* 
			@ts-ignore */
			try { writingNfo = v; } catch(e) {} },
		get setupJellyfinLibrary() { return setupJellyfinLibrary; },
		set setupJellyfinLibrary(v) { /* 
			@ts-ignore */
			try { setupJellyfinLibrary = v; } catch(e) {} },
		get writeJellyfinMetadata() { return writeJellyfinMetadata; },
		set writeJellyfinMetadata(v) { /* 
			@ts-ignore */
			try { writeJellyfinMetadata = v; } catch(e) {} },
		get testingPlex() { return testingPlex; },
		set testingPlex(v) { /* 
			@ts-ignore */
			try { testingPlex = v; } catch(e) {} },
		get plexTestResult() { return plexTestResult; },
		set plexTestResult(v) { /* 
			@ts-ignore */
			try { plexTestResult = v; } catch(e) {} },
		get togglePlex() { return togglePlex; },
		set togglePlex(v) { /* 
			@ts-ignore */
			try { togglePlex = v; } catch(e) {} },
		get testPlexConnection() { return testPlexConnection; },
		set testPlexConnection(v) { /* 
			@ts-ignore */
			try { testPlexConnection = v; } catch(e) {} },
		get YT_DLP_PROXY_SCHEMES() { return YT_DLP_PROXY_SCHEMES; },
		
		get ytdlpProxyUrlError() { return ytdlpProxyUrlError; },
		set ytdlpProxyUrlError(v) { /* 
			@ts-ignore */
			try { ytdlpProxyUrlError = v; } catch(e) {} },
		get aria2cSocksConflict() { return aria2cSocksConflict; },
		set aria2cSocksConflict(v) { /* 
			@ts-ignore */
			try { aria2cSocksConflict = v; } catch(e) {} },
		get saveSettings() { return saveSettings; },
		set saveSettings(v) { /* 
			@ts-ignore */
			try { saveSettings = v; } catch(e) {} },
		get debouncedSave() { return debouncedSave; },
		set debouncedSave(v) { /* 
			@ts-ignore */
			try { debouncedSave = v; } catch(e) {} },
		get toggleAdmin() { return toggleAdmin; },
		set toggleAdmin(v) { /* 
			@ts-ignore */
			try { toggleAdmin = v; } catch(e) {} },
		get deleteUser() { return deleteUser; },
		set deleteUser(v) { /* 
			@ts-ignore */
			try { deleteUser = v; } catch(e) {} },
		get clearingDownloads() { return clearingDownloads; },
		set clearingDownloads(v) { /* 
			@ts-ignore */
			try { clearingDownloads = v; } catch(e) {} },
		get clearUserDownloads() { return clearUserDownloads; },
		set clearUserDownloads(v) { /* 
			@ts-ignore */
			try { clearUserDownloads = v; } catch(e) {} },
		get clearAllDownloads() { return clearAllDownloads; },
		set clearAllDownloads(v) { /* 
			@ts-ignore */
			try { clearAllDownloads = v; } catch(e) {} },
		get createUser() { return createUser; },
		set createUser(v) { /* 
			@ts-ignore */
			try { createUser = v; } catch(e) {} },
		get openPasswordChange() { return openPasswordChange; },
		set openPasswordChange(v) { /* 
			@ts-ignore */
			try { openPasswordChange = v; } catch(e) {} },
		get closePasswordChange() { return closePasswordChange; },
		set closePasswordChange(v) { /* 
			@ts-ignore */
			try { closePasswordChange = v; } catch(e) {} },
		get loadApiKeys() { return loadApiKeys; },
		set loadApiKeys(v) { /* 
			@ts-ignore */
			try { loadApiKeys = v; } catch(e) {} },
		get createApiKey() { return createApiKey; },
		set createApiKey(v) { /* 
			@ts-ignore */
			try { createApiKey = v; } catch(e) {} },
		get revokeApiKey() { return revokeApiKey; },
		set revokeApiKey(v) { /* 
			@ts-ignore */
			try { revokeApiKey = v; } catch(e) {} },
		get loadYouTubeLink() { return loadYouTubeLink; },
		set loadYouTubeLink(v) { /* 
			@ts-ignore */
			try { loadYouTubeLink = v; } catch(e) {} },
		get updateYouTubeToggle() { return updateYouTubeToggle; },
		set updateYouTubeToggle(v) { /* 
			@ts-ignore */
			try { updateYouTubeToggle = v; } catch(e) {} },
		get applyAccountState() { return applyAccountState; },
		set applyAccountState(v) { /* 
			@ts-ignore */
			try { applyAccountState = v; } catch(e) {} },
		get saveAccountSettings() { return saveAccountSettings; },
		set saveAccountSettings(v) { /* 
			@ts-ignore */
			try { saveAccountSettings = v; } catch(e) {} },
		get testAccountNotifications() { return testAccountNotifications; },
		set testAccountNotifications(v) { /* 
			@ts-ignore */
			try { testAccountNotifications = v; } catch(e) {} },
		get unlinkYouTube() { return unlinkYouTube; },
		set unlinkYouTube(v) { /* 
			@ts-ignore */
			try { unlinkYouTube = v; } catch(e) {} },
		get syncingWatchLater() { return syncingWatchLater; },
		set syncingWatchLater(v) { /* 
			@ts-ignore */
			try { syncingWatchLater = v; } catch(e) {} },
		get syncingHistory() { return syncingHistory; },
		set syncingHistory(v) { /* 
			@ts-ignore */
			try { syncingHistory = v; } catch(e) {} },
		get jellyfinUserChoice() { return jellyfinUserChoice; },
		set jellyfinUserChoice(v) { /* 
			@ts-ignore */
			try { jellyfinUserChoice = v; } catch(e) {} },
		get exportingOPML() { return exportingOPML; },
		set exportingOPML(v) { /* 
			@ts-ignore */
			try { exportingOPML = v; } catch(e) {} },
		get exportingCSV() { return exportingCSV; },
		set exportingCSV(v) { /* 
			@ts-ignore */
			try { exportingCSV = v; } catch(e) {} },
		get syncWatchLater() { return syncWatchLater; },
		set syncWatchLater(v) { /* 
			@ts-ignore */
			try { syncWatchLater = v; } catch(e) {} },
		get syncHistory() { return syncHistory; },
		set syncHistory(v) { /* 
			@ts-ignore */
			try { syncHistory = v; } catch(e) {} },
		get updateJellyfinUser() { return updateJellyfinUser; },
		set updateJellyfinUser(v) { /* 
			@ts-ignore */
			try { updateJellyfinUser = v; } catch(e) {} },
		get exportSubscriptions() { return exportSubscriptions; },
		set exportSubscriptions(v) { /* 
			@ts-ignore */
			try { exportSubscriptions = v; } catch(e) {} },
		get loadLibraryRequests() { return loadLibraryRequests; },
		set loadLibraryRequests(v) { /* 
			@ts-ignore */
			try { loadLibraryRequests = v; } catch(e) {} },
		get handleLibraryRequest() { return handleLibraryRequest; },
		set handleLibraryRequest(v) { /* 
			@ts-ignore */
			try { handleLibraryRequest = v; } catch(e) {} },
		get updateUserLibraryAccess() { return updateUserLibraryAccess; },
		set updateUserLibraryAccess(v) { /* 
			@ts-ignore */
			try { updateUserLibraryAccess = v; } catch(e) {} },
		get userAccessValue() { return userAccessValue; },
		set userAccessValue(v) { /* 
			@ts-ignore */
			try { userAccessValue = v; } catch(e) {} },
		get userQuotaDisplay() { return userQuotaDisplay; },
		set userQuotaDisplay(v) { /* 
			@ts-ignore */
			try { userQuotaDisplay = v; } catch(e) {} },
		get saveUserQuota() { return saveUserQuota; },
		set saveUserQuota(v) { /* 
			@ts-ignore */
			try { saveUserQuota = v; } catch(e) {} },
		get changePassword() { return changePassword; },
		set changePassword(v) { /* 
			@ts-ignore */
			try { changePassword = v; } catch(e) {} },
	};
	setContext('settingsState', __state);

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
				User Settings
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
										onclick={() => selectSection(section.id)}
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

	

	<div class="settings-container">
		{@render quickNav()}
		<div class="general-settings">
			
			{@render children?.()}
		</div>
	</div>

	</div>

