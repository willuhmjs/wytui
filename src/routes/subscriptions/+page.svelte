<script lang="ts">
	import { onMount } from 'svelte';
	import { onSSEEvent } from '$lib/stores/sse.svelte';
	import { showConfirm } from '$lib/stores/modal.svelte';
	import { addToast, removeToast } from '$lib/stores/toast.svelte';
	import { csrfFetch, safeFetchJson, isFetchError, type FetchError } from '$lib/utils/fetch';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ErrorMessage from '$lib/components/ui/ErrorMessage.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import FormField from '$lib/components/ui/FormField.svelte';
	import SubscriptionConfig from '$lib/components/download/SubscriptionConfig.svelte';
	import CheckIcon from '$lib/components/icons/CheckIcon.svelte';
	import XIcon from '$lib/components/icons/XIcon.svelte';

	// Shared state
	let profiles = $state<any[]>([]);
	let libraryConfigured = $state(false);

	// Subscriptions state
	const SUBS_PAGE_SIZE = 50;
	let subscriptions = $state<any[]>([]);
	let subsLoading = $state(false);
	let subsLoadingMore = $state(false);
	let subsOffset = $state(0);
	let subsHasMore = $state(false);
	let subsError = $state<FetchError | null>(null);
	let profilesError = $state<FetchError | null>(null);
	let checkingNow = $state<Set<string>>(new Set());
	const checkTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
	const checkPendingToastDismiss = new Map<string, () => void>();
	let showSubsForm = $state(false);
	let subFormUrl = $state('');
	let subFormProfileId = $state('');
	let subFormCheckInterval = $state(1800);
	let subFormAutoDownload = $state(true);
	let subFormSaveToLibrary = $state(false);
	let subFormOptions = $state({
		sponsorblock: false,
		subtitles: false,
		metadata: false,
	});
	let subFormSubmitting = $state(false);

	// Subscription edit state
	let editingSub = $state<any | null>(null);
	let editSubName = $state('');
	let editSubUrl = $state('');
	let editSubProfileId = $state('');
	let editSubCheckInterval = $state(1800);
	let editSubAutoDownload = $state(true);
	let editSubSaveToLibrary = $state(false);
	let editSubOptions = $state({
		sponsorblock: false,
		subtitles: false,
		metadata: false,
	});

	// Subscription backfill state
	let backfillDate = $state('');
	let showBackfillMenu = $state<string | null>(null);

	// Form error state
	let subFormError = $state('');

	// Handle SubscriptionConfig changes
	function handleSubFormConfigChange(
		updates: {
			profileId?: string;
			saveToLibrary?: boolean;
			options?: {
				sponsorblock: boolean;
				subtitles: boolean;
				metadata: boolean;
			};
		},
		mode: 'new' | 'edit' = 'new',
	) {
		if (updates.profileId !== undefined) {
			if (mode === 'new') {
				subFormProfileId = updates.profileId;
			} else {
				editSubProfileId = updates.profileId;
			}
		}
		if (updates.saveToLibrary !== undefined) {
			if (mode === 'new') {
				subFormSaveToLibrary = updates.saveToLibrary;
			} else {
				editSubSaveToLibrary = updates.saveToLibrary;
			}
		}
		if (updates.options !== undefined) {
			if (mode === 'new') {
				subFormOptions = updates.options;
			} else {
				editSubOptions = updates.options;
			}
		}
	}

	function buildOptionsFlags(
		opts: { sponsorblock: boolean; subtitles: boolean; metadata: boolean },
		saveToLibrary = false,
	): string[] {
		const flags: string[] = [];
		if (opts.sponsorblock) flags.push('--sponsorblock-remove', 'sponsor,selfpromo');
		if (opts.subtitles)
			flags.push('--write-subs', '--write-auto-subs', '--embed-subs', '--sub-langs', 'en');
		if (opts.metadata) flags.push('--embed-metadata', '--embed-chapters');
		if (saveToLibrary) flags.push('--write-thumbnail');
		return flags;
	}

	function parseOptionsFromFlags(flags: string[]): {
		sponsorblock: boolean;
		subtitles: boolean;
		metadata: boolean;
	} {
		return {
			sponsorblock: flags.includes('--sponsorblock-remove'),
			subtitles: flags.includes('--write-subs') || flags.includes('--write-auto-subs'),
			metadata: flags.includes('--embed-metadata'),
		};
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

	onMount(() => {
		loadProfiles();
		loadSubscriptions();

		const unsubChecked = onSSEEvent('subscription:checked', ({ id, name, newVideos }) => {
			const safetyTimeout = checkTimeouts.get(id);
			if (safetyTimeout) {
				clearTimeout(safetyTimeout);
				checkTimeouts.delete(id);
			}
			const dismiss = checkPendingToastDismiss.get(id);
			if (dismiss) {
				dismiss();
				checkPendingToastDismiss.delete(id);
			}
			checkingNow = new Set([...checkingNow].filter((x) => x !== id));
			const message =
				newVideos > 0
					? `Found ${newVideos} new video${newVideos > 1 ? 's' : ''} for ${name}`
					: `No new videos for ${name}`;
			addToast(newVideos > 0 ? 'success' : 'info', message);
			loadSubscriptions();
		});
		const unsubBackfill = onSSEEvent(
			'subscription:backfill',
			({ name, totalVideos, newVideos }) => {
				addToast(
					'success',
					`Queued ${newVideos} new video${newVideos !== 1 ? 's' : ''} from ${name} (${totalVideos} total found)`,
				);
			},
		);

		return () => {
			unsubChecked();
			unsubBackfill();
		};
	});

	async function loadProfiles() {
		profilesError = null;
		try {
			const [profilesData, settings] = await Promise.all([
				safeFetchJson<any[]>('/api/profiles'),
				safeFetchJson<any>('/api/settings'),
			]);
			profiles = profilesData;
			const defaultProfile = profiles.find((p) => p.isDefault);
			if (defaultProfile) {
				subFormProfileId = defaultProfile.id;
			}
			libraryConfigured = !!settings.libraryPath;
			if (libraryConfigured) {
				subFormSaveToLibrary = true;
			}
		} catch (e) {
			profilesError = isFetchError(e)
				? e
				: {
						type: 'unknown',
						message: 'Failed to load profiles.',
						canRetry: true,
					};
		}
	}

	async function loadSubscriptions() {
		// Fresh load: reset pagination and replace the list from offset 0.
		subsLoading = true;
		subsError = null;
		subsOffset = 0;
		try {
			const page = await safeFetchJson<any[]>(
				`/api/subscriptions?limit=${SUBS_PAGE_SIZE}&offset=0`,
			);
			subscriptions = page;
			subsOffset = page.length;
			subsHasMore = page.length === SUBS_PAGE_SIZE;
		} catch (e) {
			subsError = isFetchError(e)
				? e
				: {
						type: 'unknown',
						message: 'Failed to load subscriptions.',
						canRetry: true,
					};
		} finally {
			subsLoading = false;
		}
	}

	async function loadMoreSubscriptions() {
		if (subsLoadingMore || !subsHasMore) return;
		subsLoadingMore = true;
		try {
			const page = await safeFetchJson<any[]>(
				`/api/subscriptions?limit=${SUBS_PAGE_SIZE}&offset=${subsOffset}`,
			);
			subscriptions = [...subscriptions, ...page];
			subsOffset += page.length;
			subsHasMore = page.length === SUBS_PAGE_SIZE;
		} catch (e) {
			console.error('Failed to load more subscriptions:', e);
		} finally {
			subsLoadingMore = false;
		}
	}

	async function handleSubsSubmit(e: Event) {
		e.preventDefault();
		subFormError = '';
		subFormSubmitting = true;
		try {
			const res = await csrfFetch('/api/subscriptions', {
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
				subFormSaveToLibrary = libraryConfigured;
				subFormOptions = {
					sponsorblock: false,
					subtitles: false,
					metadata: false,
				};
				showSubsForm = false;
				addToast('success', 'Subscription added');
				await loadSubscriptions();
			} else {
				const data = await res.json().catch(() => null);
				subFormError = data?.message || `Failed to create subscription (${res.status})`;
			}
		} catch (e) {
			subFormError = 'Failed to create subscription';
		} finally {
			subFormSubmitting = false;
		}
	}

	async function toggleSubscription(id: string, enabled: boolean) {
		let toastId: string | null = null;
		const timer = setTimeout(() => {
			toastId = addToast(
				'info',
				enabled ? 'Pausing subscription...' : 'Resuming subscription...',
				10000,
			);
		}, 350);
		try {
			await csrfFetch(`/api/subscriptions/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled: !enabled }),
			});
			await loadSubscriptions();
		} catch (e) {
			addToast('error', 'Failed to update subscription');
		} finally {
			clearTimeout(timer);
			if (toastId) removeToast(toastId);
		}
	}

	async function deleteSubscription(id: string) {
		const confirmed = await showConfirm(
			'Delete Subscription',
			'Are you sure you want to delete this subscription?',
			'Delete',
		);
		if (!confirmed) return;

		try {
			await csrfFetch(`/api/subscriptions/${id}`, { method: 'DELETE' });
			await loadSubscriptions();
		} catch (e) {
			console.error('Failed to delete subscription:', e);
		}
	}

	async function checkNow(id: string) {
		if (checkingNow.has(id)) return;
		checkingNow = new Set([...checkingNow, id]);

		let toastId: string | null = null;
		const toastTimer = setTimeout(() => {
			toastId = addToast('info', 'Checking for new videos...', 30000);
		}, 350);
		const dismissToast = () => {
			clearTimeout(toastTimer);
			if (toastId) removeToast(toastId);
		};
		checkPendingToastDismiss.set(id, dismissToast);

		const safetyTimeout = setTimeout(() => {
			dismissToast();
			checkPendingToastDismiss.delete(id);
			checkingNow = new Set([...checkingNow].filter((x) => x !== id));
		}, 60000);
		checkTimeouts.set(id, safetyTimeout);

		try {
			await csrfFetch(`/api/subscriptions/${id}/check`, {
				method: 'POST',
			});
		} catch (e) {
			clearTimeout(safetyTimeout);
			checkTimeouts.delete(id);
			dismissToast();
			checkPendingToastDismiss.delete(id);
			checkingNow = new Set([...checkingNow].filter((x) => x !== id));
			addToast('error', 'Failed to start check');
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
			const res = await csrfFetch(`/api/subscriptions/${editingSub.id}`, {
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
			addToast('error', 'Failed to save changes');
		}
	}

	async function backfillFromDate(id: string) {
		if (!backfillDate) return;
		try {
			await csrfFetch(`/api/subscriptions/${id}/backfill`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ dateAfter: backfillDate }),
			});
			backfillDate = '';
			showBackfillMenu = null;
		} catch (e) {
			console.error('Failed to backfill:', e);
		}
	}

	async function backfillAll(id: string) {
		const confirmed = await showConfirm(
			'Download All Videos',
			"This will download every video from this channel that hasn't been downloaded before. This could queue a large number of downloads.",
			'Download All',
		);
		if (!confirmed) return;
		try {
			await csrfFetch(`/api/subscriptions/${id}/backfill`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			});
			showBackfillMenu = null;
		} catch (e) {
			console.error('Failed to backfill:', e);
		}
	}
</script>

<svelte:head>
	<title>Subscriptions - wytui</title>
</svelte:head>

<div class="page">
	<div class="tab-content">
		<div class="section subs-card">
			<div class="section-header">
				<div class="section-header-left">
					<h2>Subscriptions ({subscriptions.length})</h2>
					<p class="text-muted">Monitor channels and auto-download new videos</p>
				</div>
				<button class="btn btn-primary" onclick={() => (showSubsForm = !showSubsForm)}>
					{showSubsForm ? 'Cancel' : 'Add Subscription'}
				</button>
			</div>
			<div class="subs-body">
				{#if showSubsForm}
					<form class="form-card" onsubmit={handleSubsSubmit}>
						<div class="form-row">
							<FormField label="Channel/Playlist URL" for="sub-url" required>
								<Input
									type="url"
									id="sub-url"
									bind:value={subFormUrl}
									required
									placeholder="https://www.youtube.com/@channel"
								/>
							</FormField>
							<SubscriptionConfig
								{profiles}
								selectedProfileId={subFormProfileId}
								saveToLibrary={subFormSaveToLibrary}
								options={subFormOptions}
								{libraryConfigured}
								onChange={handleSubFormConfigChange}
							/>
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
						</div>

						{#if subFormError}
							<p class="form-error">{subFormError}</p>
						{/if}
						<button type="submit" class="btn btn-primary" disabled={subFormSubmitting}>
							{subFormSubmitting ? 'Adding…' : 'Create Subscription'}
						</button>
					</form>
				{/if}

				{#if profilesError}
					<div class="error-wrapper">
						<ErrorMessage
							error={profilesError}
							onRetry={loadProfiles}
							onDismiss={() => (profilesError = null)}
						/>
					</div>
				{/if}

				{#if subsLoading}
					<Skeleton count={5} variant="list" />
				{:else if subsError}
					<div class="error-wrapper">
						<ErrorMessage
							error={subsError}
							onRetry={loadSubscriptions}
							onDismiss={() => (subsError = null)}
						/>
					</div>
				{:else if subscriptions.length === 0}
					<EmptyState
						title="No subscriptions yet"
						description="Add a channel to start monitoring for new videos"
					/>
				{:else}
					<div class="content-grid">
						{#each subscriptions as sub}
							<div class="content-card">
								{#if editingSub?.id === sub.id}
									<div class="edit-form">
										<div class="form-row">
											<div class="form-group">
												<label for="edit-sub-name">Name</label>
												<input type="text" id="edit-sub-name" bind:value={editSubName} />
											</div>
											<div class="form-group">
												<label for="edit-sub-url">URL</label>
												<input type="url" id="edit-sub-url" bind:value={editSubUrl} />
											</div>
										</div>
										<div class="form-row">
											<div class="form-group">
												<label for="edit-sub-profile">Profile</label>
												<select id="edit-sub-profile" bind:value={editSubProfileId}>
													{#each profiles as profile}
														<option value={profile.id}>{profile.name}</option>
													{/each}
												</select>
											</div>
											<div class="form-group">
												<label for="edit-sub-interval">Check Interval</label>
												<select id="edit-sub-interval" bind:value={editSubCheckInterval}>
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
																editSubOptions = {
																	sponsorblock: true,
																	subtitles: true,
																	metadata: true,
																};
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
												<button
													type="button"
													class="option-chip"
													class:active={editSubOptions.sponsorblock}
													onclick={() =>
														(editSubOptions.sponsorblock = !editSubOptions.sponsorblock)}
													>SponsorBlock</button
												>
												<button
													type="button"
													class="option-chip"
													class:active={editSubOptions.subtitles}
													onclick={() => (editSubOptions.subtitles = !editSubOptions.subtitles)}
													>Subtitles</button
												>
												<button
													type="button"
													class="option-chip"
													class:active={editSubOptions.metadata}
													onclick={() => (editSubOptions.metadata = !editSubOptions.metadata)}
													>Metadata</button
												>
											</div>
										</div>
										<div class="actions">
											<button
												class="btn btn-sm btn-primary"
												onclick={saveEditSub}
												aria-label="Save"
												title="Save"
											>
												<CheckIcon />
												Save
											</button>
											<button
												class="btn btn-sm btn-secondary"
												onclick={cancelEditSub}
												aria-label="Cancel"
												title="Cancel"
											>
												<XIcon />
												Cancel
											</button>
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
											{#if sub.lastChecked}Last checked: {new Date(
													sub.lastChecked,
												).toLocaleString()}{/if}
											{#if sub.lastChecked && sub.lastVideoDate}
												·
											{/if}
											{#if sub.lastVideoDate}Latest video: {formatRelativeTime(
													sub.lastVideoDate,
												)}{/if}
										</p>
									{/if}

									<div class="actions">
										<button
											class="btn btn-sm btn-primary"
											onclick={() => checkNow(sub.id)}
											disabled={checkingNow.has(sub.id)}
											aria-label="Check now"
											title="Check now"
										>
											{#if checkingNow.has(sub.id)}
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
													class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg
												>
												Checking
											{:else}
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
													><polyline points="23 4 23 10 17 10" /><path
														d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"
													/></svg
												>
												Check
											{/if}
										</button>
										<button
											class="btn btn-sm btn-secondary"
											onclick={() => startEditSub(sub)}
											aria-label="Edit"
											title="Edit"
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
												><path
													d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
												/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg
											>
											Edit
										</button>
										<button
											class="btn btn-sm btn-secondary"
											onclick={() => toggleSubscription(sub.id, sub.enabled)}
											aria-label={sub.enabled ? 'Pause' : 'Resume'}
											title={sub.enabled ? 'Pause' : 'Resume'}
										>
											{#if sub.enabled}
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
													><rect x="6" y="4" width="4" height="16" /><rect
														x="14"
														y="4"
														width="4"
														height="16"
													/></svg
												>
												Pause
											{:else}
												<svg
													xmlns="http://www.w3.org/2000/svg"
													width="16"
													height="16"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg
												>
												Resume
											{/if}
										</button>
										<button
											class="btn btn-sm btn-secondary"
											onclick={() =>
												(showBackfillMenu = showBackfillMenu === sub.id ? null : sub.id)}
											aria-label={showBackfillMenu === sub.id ? 'Close backfill' : 'Backfill'}
											title={showBackfillMenu === sub.id ? 'Close backfill' : 'Backfill'}
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
												><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline
													points="7 10 12 15 17 10"
												/><line x1="12" y1="15" x2="12" y2="3" /></svg
											>
											{showBackfillMenu === sub.id ? 'Close' : 'Backfill'}
										</button>
										<button
											class="btn btn-sm btn-danger"
											onclick={() => deleteSubscription(sub.id)}
											aria-label="Delete"
											title="Delete"
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
											Delete
										</button>
									</div>

									{#if showBackfillMenu === sub.id}
										<div class="backfill-menu">
											<div class="backfill-option">
												<label for="backfill-date-{sub.id}">Download videos uploaded after:</label>
												<div class="backfill-date-row">
													<input
														type="date"
														id="backfill-date-{sub.id}"
														bind:value={backfillDate}
													/>
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
					{#if subsHasMore}
						<div class="load-more-row">
							<button
								class="btn btn-secondary"
								onclick={loadMoreSubscriptions}
								disabled={subsLoadingMore}
							>
								{subsLoadingMore ? 'Loading…' : 'Load More'}
							</button>
						</div>
					{/if}
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.page {
		max-width: 1400px;
		margin: 0 auto;
		width: 100%;
	}

	.tab-content {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-2xl);
	}

	.subs-card {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--spacing-lg);
		padding: var(--spacing-lg);
		background: var(--color-bg-tertiary);
		border-bottom: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg) var(--radius-lg) 0 0;
	}

	.section-header-left h2 {
		margin-bottom: var(--spacing-xs);
	}

	.section-header-left p {
		margin-top: var(--spacing-xs);
	}

	.subs-body {
		padding: var(--spacing-lg);
	}

	.form-card {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
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
		color: var(--color-text-secondary);
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

	.checkbox-row {
		display: flex;
		gap: var(--spacing-xl);
		margin-bottom: var(--spacing-lg);
	}

	.error-wrapper {
		margin-bottom: var(--spacing-md);
	}

	.load-more-row {
		display: flex;
		justify-content: center;
		margin-top: var(--spacing-xl);
	}

	.content-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
		gap: var(--spacing-lg);
		width: 100%;
	}

	.content-card {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		padding: var(--spacing-lg);
		transition: all var(--transition-normal);
	}

	.content-card:hover {
		border-color: var(--color-border-translucent-hover);
		transform: translateY(-3px);
		box-shadow:
			var(--shadow-lg),
			0 0 0 1px rgba(59, 130, 246, 0.05);
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
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	.backfill-option label {
		display: block;
		margin-bottom: var(--spacing-sm);
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
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
		background: var(--color-border-default);
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
		background: var(--color-bg-tertiary);
		color: var(--color-text-secondary);
	}

	.status.enabled {
		background: rgba(16, 185, 129, 0.1);
		color: var(--color-status-success);
	}

	.url {
		font-size: 0.875rem;
		color: var(--color-text-secondary);
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
		color: var(--color-text-secondary);
	}

	.form-error {
		color: var(--color-status-error, #ef4444);
		font-size: 0.85rem;
		margin: var(--spacing-xs) 0;
	}

	.library-tag {
		background: rgba(16, 185, 129, 0.15);
		color: var(--color-status-success);
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		font-weight: 600;
	}

	.option-tag {
		background: rgba(99, 102, 241, 0.15);
		color: var(--color-accent-primary);
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
		color: var(--color-text-tertiary);
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
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		color: var(--color-text-secondary);
		font-size: 0.8125rem;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.option-chip:hover {
		background: var(--color-bg-hover);
		border-color: var(--color-accent-dim);
	}

	.option-chip.active {
		background: rgba(99, 102, 241, 0.15);
		border-color: var(--color-accent-primary);
		color: var(--color-accent-primary);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-sm);
		margin-top: var(--spacing-md);
	}

	:global(.btn-icon) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-sm) !important;
		line-height: 1;
	}

	:global(.btn-icon svg) {
		display: block;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	:global(.spin) {
		animation: spin 1s linear infinite;
	}

	@media (max-width: 768px) {
		.page {
			padding: 0 var(--spacing-sm);
		}

		.section-header {
			flex-direction: column;
			gap: var(--spacing-md);
		}

		.section-header .btn {
			width: 100%;
		}

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

		.actions .btn {
			flex: 1;
			min-width: 0;
		}

		.backfill-menu {
			padding: var(--spacing-md);
		}

		.checkbox-row {
			flex-direction: column;
			gap: var(--spacing-sm);
		}

		.options-row {
			flex-direction: column;
			align-items: flex-start;
		}

		.meta {
			gap: var(--spacing-sm);
		}
	}
</style>
