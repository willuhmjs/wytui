<script lang="ts">
	import { getContext } from 'svelte';
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

	const s = getContext<any>('settingsState');

	const activeSection = getContext<() => string>('activeSection');
</script>

{#if activeSection() === 'storage'}
<div class="settings-section" id="storage" >
						<h2>Storage</h2>

						<div class="form-row">
							<div class="form-group">
								<label for="downloadPath">Cache Path</label>
								<input type="text" id="downloadPath" bind:value={s.settings.downloadPath} readonly />
								<p class="help-text">Temporary storage for downloads</p>
							</div>

							<div class="form-group">
								<label for="cacheQuota">Default Per-User Cache Limit (GB)</label>
								<input
									type="number"
									id="cacheQuota"
									value={s.cacheQuotaGB}
									oninput={(e) => s.updateCacheQuota(parseFloat(e.currentTarget.value) || 0)}
									min="1"
									max={s.diskTotalGB ? Math.floor(s.diskTotalGB) : undefined}
									step="1"
								/>
								{#if s.cacheQuotaExceedsDisk && s.diskTotalGB}
									<p class="help-text error-text">
										Exceeds total disk space ({s.diskTotalGB.toFixed(1)} GB)
									</p>
								{:else if s.diskTotalGB}
									<p class="help-text">
										Default cache budget per user. {s.diskTotalGB.toFixed(1)} GB total on disk. Override
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
									value={s.totalCacheGB}
									oninput={(e) => s.updateTotalCacheQuota(e.currentTarget.value)}
									placeholder={s.autoTotalCacheGB !== null ? `Auto (${s.autoTotalCacheGB})` : 'Auto'}
									min="1"
									max={s.diskTotalGB ? Math.floor(s.diskTotalGB) : undefined}
									step="1"
								/>
								{#if s.totalCacheExceedsDisk && s.diskTotalGB}
									<p class="help-text error-text">
										Exceeds total disk space ({s.diskTotalGB.toFixed(1)} GB)
									</p>
								{:else}
									<p class="help-text">
										Global cap across all users. Blank = auto{s.autoTotalCacheGB !== null
											? ` (disk − 5 GB ≈ ${s.autoTotalCacheGB} GB)`
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
								onclick={s.runDownloadsCleanup}
								disabled={s.cleaningDownloads}
							>
								{s.cleaningDownloads ? 'Cleaning…' : 'Clean up downloads directory'}
							</button>
							<p class="help-text">
								Removes stale partial downloads and leftover temporary files that no download owns,
								plus empty artwork-only library folders. Runs automatically every 5 minutes; this
								forces it immediately. In-flight downloads are never touched.
							</p>
							{#if s.downloadsCleanupResult}
								<p class="help-text">{s.downloadsCleanupResult}</p>
							{/if}
						</div>

						<div class="form-group">
							<label class="toggle-label">
								<input
									type="checkbox"
									checked={s.libraryEnabled}
									onchange={(e) => s.toggleLibrary(e.currentTarget.checked)}
								/>
								Enable Library
							</label>
							<p class="help-text">Save downloads permanently, organized by uploader</p>
						</div>

						{#if s.libraryEnabled}
							<div class="form-group nested-field">
								<label for="libraryPath">Video Library Path</label>
								<PathBrowser
									id="libraryPath"
									bind:value={s.settings.libraryPath}
									placeholder="/media"
								/>
							</div>

							<div class="form-group nested-field">
								<label for="musicLibraryPath">Music Library Path</label>
								<PathBrowser
									id="musicLibraryPath"
									bind:value={s.settings.musicLibraryPath}
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
									bind:value={s.settings.maxConcurrentDownloads}
									min="1"
									max="10"
								/>
							</div>

							<div class="form-group">
								<label for="maxDuration">Max Duration (hours)</label>
								<input
									type="number"
									id="maxDuration"
									value={s.settings.maxDurationSeconds
										? Math.round(s.settings.maxDurationSeconds / 3600)
										: 3}
									oninput={(e) => {
										const hours = parseFloat(e.currentTarget.value) || 3;
										s.settings.maxDurationSeconds = Math.round(hours * 3600);
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
									bind:value={s.settings.rateLimit}
									placeholder="Unlimited"
								/>
								<p class="help-text">e.g. "5M" for 5 MB/s, "500K" for 500 KB/s</p>
							</div>

							<div class="form-group">
								<label for="sleepInterval">Sleep Between Downloads (seconds)</label>
								<input
									type="number"
									id="sleepInterval"
									bind:value={s.settings.sleepInterval}
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
									bind:value={s.settings.concurrentFragments}
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
									bind:value={s.settings.httpChunkSize}
									placeholder="10M"
								/>
								<p class="help-text">Fragment size for chunked downloads</p>
							</div>
						</div>

						<div class="form-group">
							<label>
								<input type="checkbox" bind:checked={s.settings.useAria2c} />
								Use aria2c accelerated downloader
							</label>
							{#if s.aria2cSocksConflict}
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
								<input type="checkbox" bind:checked={s.settings.generateJellyfinPosters} />
								Generate Jellyfin posters
							</label>
							<p class="help-text">
								Generate a 2:3 channel poster + 16:9 thumbnails for Jellyfin (Movies libraries)
							</p>
						</div>

						<div class="form-group">
							<label>
								<input type="checkbox" bind:checked={s.settings.enableArchive} />
								Deduplicate downloads
							</label>
							<p class="help-text">
								Track downloaded videos to prevent re-downloading the same content
							</p>
						</div>
					</div>
{/if}

{#if activeSection() === 'library-access'}
<div class="settings-section" id="library-access" >
						<h2>Access</h2>
						<div class="form-group">
							<label for="libraryAccessMode">Library Access Mode</label>
							<select id="libraryAccessMode" bind:value={s.settings.libraryAccessMode}>
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
{/if}

{#if activeSection() === 'ytdlp'}
<div class="settings-section" id="ytdlp" >
						<h2>yt-dlp</h2>
						<div class="form-group">
							<label>
								<input type="checkbox" bind:checked={s.settings.autoUpdateYtdlp} />
								Auto-update yt-dlp
							</label>
						</div>

						{#if s.settings.ytdlpVersion}
							<div class="info-box">
								<strong>Current version:</strong>
								{s.settings.ytdlpVersion}
							</div>
						{/if}

						<div class="form-group">
							<label>
								<input type="checkbox" bind:checked={s.settings.versionCheckEnabled} />
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
								bind:value={s.settings.ytdlpProxyUrl}
								placeholder="socks5://user:pass@host:port"
								class:invalid={!!s.ytdlpProxyUrlError}
								aria-invalid={s.ytdlpProxyUrlError ? 'true' : undefined}
							/>
							{#if s.ytdlpProxyUrlError}
								<p class="help-text error-text" role="alert">
									{s.ytdlpProxyUrlError}
								</p>
							{:else}
								<p class="help-text">
									Server-wide default proxy for yt-dlp traffic (downloads, metadata fetches,
									subscription checks). Linked YouTube accounts can override it with their own
									proxy. Use <code>socks5h</code> to resolve DNS through the proxy too.
								</p>
							{/if}
						</div>

						<div class="form-group">
							<label for="ytdlpExtraFlags">Extra flags</label>
							<textarea
								id="ytdlpExtraFlags"
								rows="3"
								bind:value={s.ytdlpExtraFlagsText}
								oninput={() => {
									s.settings.ytdlpExtraFlags = s.ytdlpExtraFlagsText
										.split('\n')
										.map((line: string) => line.trim())
										.filter(Boolean);
								}}
								placeholder={'--extractor-args youtube:player_client=web_safari\n--sleep-requests 1'}
							></textarea>
							<p class="help-text">
								Server-wide default yt-dlp flags applied to every download and subscription check.
								Linked YouTube accounts can override these. One token per line — a flag and its
								value go on separate lines. Profile and per-subscription flags override these.
							</p>
						</div>
					</div>
{/if}

{#if activeSection() === 'cookies'}
<div class="settings-section" id="cookies" >
						<h2>Cookies</h2>
						<p class="help-text" style="margin-bottom: var(--spacing-lg);">
							Upload a Netscape-format cookies.txt file to access member-only and age-restricted
							content.
						</p>

						{#if s.cookieStatus.hasCookies}
							<div class="info-box" style="margin-bottom: var(--spacing-md);">
								Cookie file is active.
							</div>
							<button class="btn btn-danger btn-sm btn-with-icon" onclick={s.deleteCookieFile}>
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
								{s.uploadingCookies ? 'Uploading...' : 'Upload cookies.txt'}
								<input
									type="file"
									accept=".txt"
									onchange={s.uploadCookieFile}
									disabled={s.uploadingCookies}
									style="display: none;"
								/>
							</label>
						{/if}

						{#if s.cookieError}
							<div class="error-message" style="margin-top: var(--spacing-md);">
								{s.cookieError}
							</div>
						{/if}
					</div>
{/if}

{#if activeSection() === 'ryd'}
<div class="settings-section" id="ryd" >
						<h2>Return YouTube Dislike</h2>
						<div class="form-group">
							<label>
								<input type="checkbox" bind:checked={s.settings.rydEnabled} />
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
{/if}

{#if activeSection() === 'jellyfin'}
<div class="settings-section" id="jellyfin" >
						<h2>Jellyfin</h2>

						<div class="form-group">
							<label class="toggle-label">
								<input
									type="checkbox"
									checked={s.jellyfinEnabled}
									onchange={(e) => s.toggleJellyfin(e.currentTarget.checked)}
								/>
								Enable Jellyfin Integration
							</label>
							<p class="help-text">Triggers a library scan when downloads are saved to library</p>
						</div>

						{#if s.jellyfinEnabled}
							<div class="form-row nested-field">
								<div class="form-group">
									<label for="jellyfinUrl">Server URL</label>
									<input
										type="text"
										id="jellyfinUrl"
										bind:value={s.settings.jellyfinUrl}
										placeholder="http://jellyfin:8096"
									/>
								</div>

								<div class="form-group">
									<label for="jellyfinApiKey">API Key</label>
									<PasswordInput
										id="jellyfinApiKey"
										bind:value={s.settings.jellyfinApiKey}
										placeholder="Enter API key"
									/>
									<p class="help-text">Dashboard > API Keys in Jellyfin</p>
								</div>

								<div class="form-group">
									<label for="jellyfinExternalUrl">External URL</label>
									<input
										type="text"
										id="jellyfinExternalUrl"
										bind:value={s.settings.jellyfinExternalUrl}
										placeholder="https://jellyfin.example.com"
									/>
									<p class="help-text">
										Public URL used for "Open in Jellyfin" links. Defaults to Server URL if empty.
									</p>
								</div>
								<div class="form-group">
									<label for="jellyfinLocalPath">wytui path</label>
									<input
										type="text"
										id="jellyfinLocalPath"
										bind:value={s.settings.jellyfinLocalPath}
										placeholder="/media"
									/>
									<p class="help-text">
										Path mapping for the library setup: how the shared volume is mounted here vs in
										Jellyfin (e.g. /media → /media/youtube). Leave both empty when both containers
										use the same path.
									</p>
								</div>
								<div class="form-group">
									<label for="jellyfinRemotePath">Jellyfin path</label>
									<input
										type="text"
										id="jellyfinRemotePath"
										bind:value={s.settings.jellyfinRemotePath}
										placeholder="/media/youtube"
									/>
								</div>
							</div>
							<div class="jellyfin-test nested-field">
								<button
									type="button"
									class="btn btn-secondary btn-sm btn-with-icon"
									onclick={s.testJellyfinConnection}
									disabled={s.testingJellyfin || !s.settings.jellyfinUrl || !s.settings.jellyfinApiKey}
								>
									<ZapIcon width={14} height={14} />
									{s.testingJellyfin ? 'Testing...' : 'Test Connection'}
								</button>
								{#if s.jellyfinTestResult}
									<span
										class="test-result"
										class:success={s.jellyfinTestResult.success}
										class:error={!s.jellyfinTestResult.success}
									>
										{s.jellyfinTestResult.message}
									</span>
								{/if}
							</div>

							<div class="jellyfin-library-setup nested-field">
								<div class="info-box">
									<strong>Library type:</strong> use <strong>Movies</strong> for the wytui video library
									— each channel becomes a collection and each video a standalone movie dated by its upload
									date. "Set up library" creates or fixes the library via the API and pins it to wytui's
									NFO metadata (no online matching). Run "Write NFO metadata" once to backfill existing
									videos.
								</div>
								<div class="jellyfin-test">
									<button
										type="button"
										class="btn btn-secondary btn-sm"
										onclick={s.setupJellyfinLibrary}
										disabled={s.settingUpJellyfin ||
											!s.settings.jellyfinUrl ||
											!s.settings.jellyfinApiKey}
									>
										{s.settingUpJellyfin ? 'Setting up…' : 'Set up library'}
									</button>
									<button
										type="button"
										class="btn btn-secondary btn-sm"
										onclick={s.writeJellyfinMetadata}
										disabled={s.writingNfo}
									>
										{s.writingNfo ? 'Writing…' : 'Write NFO metadata'}
									</button>
									{#if s.jellyfinSetupResult}
										<span
											class="test-result"
											class:success={s.jellyfinSetupResult.success}
											class:error={!s.jellyfinSetupResult.success}
										>
											{s.jellyfinSetupResult.message}
										</span>
									{/if}
								</div>
							</div>
						{/if}
					</div>
{/if}

{#if activeSection() === 'plex'}
<div class="settings-section" id="plex" >
						<h2>Plex</h2>

						<div class="form-group">
							<label class="toggle-label">
								<input
									type="checkbox"
									checked={s.plexEnabled}
									onchange={(e) => s.togglePlex(e.currentTarget.checked)}
								/>
								Enable Plex Integration
							</label>
							<p class="help-text">Triggers a library scan when downloads are saved to library</p>
						</div>

						{#if s.plexEnabled}
							<div class="form-row nested-field">
								<div class="form-group">
									<label for="plexUrl">Server URL</label>
									<input
										type="text"
										id="plexUrl"
										bind:value={s.settings.plexUrl}
										placeholder="http://localhost:32400"
									/>
								</div>

								<div class="form-group">
									<label for="plexToken">Token</label>
									<PasswordInput
										id="plexToken"
										bind:value={s.settings.plexToken}
										placeholder="Enter Plex token"
									/>
									<p class="help-text">Find your token at plex.tv/claim or in Plex server XML</p>
								</div>
							</div>
							<div class="jellyfin-test nested-field">
								<button
									type="button"
									class="btn btn-secondary btn-sm btn-with-icon"
									onclick={s.testPlexConnection}
									disabled={s.testingPlex || !s.settings.plexUrl || !s.settings.plexToken}
								>
									<ZapIcon width={14} height={14} />
									{s.testingPlex ? 'Testing...' : 'Test Connection'}
								</button>
								{#if s.plexTestResult}
									<span
										class="test-result"
										class:success={s.plexTestResult.success}
										class:error={!s.plexTestResult.success}
									>
										{s.plexTestResult.message}
									</span>
								{/if}
							</div>
						{/if}
					</div>
{/if}

{#if activeSection() === 'auto-delete'}
<div class="settings-section" id="auto-delete" >
						<h2>Auto-Delete</h2>
						<div class="form-group">
							<label for="autoDeleteDays">Delete watched videos after (days)</label>
							<input
								type="number"
								id="autoDeleteDays"
								bind:value={s.settings.autoDeleteWatchedDays}
								min="0"
								placeholder="Disabled"
							/>
							<p class="help-text">
								Automatically delete watched cache downloads after this many days. Set to 0 or leave
								empty to disable. Library items are never auto-deleted.
							</p>
						</div>
					</div>
{/if}

{#if activeSection() === 'rescan'}
<div class="settings-section" id="rescan" >
						<h2>Rescan Library</h2>
						<p class="help-text" style="margin-bottom: var(--spacing-lg);">
							Check that downloaded files still exist on disk. Finds completed downloads whose files
							are missing.
						</p>

						<div class="rescan-actions">
							<button
								class="btn btn-secondary btn-sm btn-with-icon"
								onclick={s.runRescan}
								disabled={s.rescanning}
							>
								<RefreshIcon width={14} height={14} />
								{s.rescanning ? 'Scanning...' : 'Rescan Now'}
							</button>
						</div>

						{#if s.rescanReport}
							<div class="rescan-results">
								<div class="rescan-summary">
									<span class="rescan-stat ok">{s.rescanReport.ok} OK</span>
									<span class="rescan-stat" class:missing={s.rescanReport.missing.length > 0}
										>{s.rescanReport.missing.length} missing</span
									>
								</div>

								{#if s.rescanReport.missing.length > 0}
									<div class="rescan-missing-list">
										<div class="rescan-bulk-actions">
											<button
												class="btn btn-secondary btn-sm btn-with-icon"
												onclick={() => s.markRescanMissing(s.rescanReport!.missing.map((m: any) => m.id))}
												disabled={s.reconciling}
											>
												Mark all as deleted
											</button>
											<button
												class="btn btn-danger btn-sm btn-with-icon"
												onclick={() => s.deleteRescanRecords(s.rescanReport!.missing.map((m: any) => m.id))}
												disabled={s.reconciling}
											>
												<TrashIcon width={14} height={14} />
												Delete all records
											</button>
										</div>

										{#each s.rescanReport.missing as item}
											<div class="rescan-missing-item">
												<div class="rescan-missing-info">
													<span class="rescan-missing-title">{item.title || 'Untitled'}</span>
													<code class="rescan-missing-path">{item.filepath}</code>
												</div>
												<div class="rescan-missing-actions">
													<button
														class="btn btn-danger btn-sm btn-icon"
														onclick={() => s.deleteRescanRecords([item.id])}
														disabled={s.reconciling}
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
{/if}

{#if activeSection() === 'backup'}
<div class="settings-section" id="backup" >
						<h2>Backup</h2>
						<div class="form-group">
							<label>
								<input type="checkbox" bind:checked={s.settings.backupEnabled} />
								Enable scheduled backups
							</label>
						</div>

						{#if s.settings.backupEnabled}
							<div class="form-row nested-field">
								<div class="form-group">
									<label for="backupCron">Backup schedule (cron)</label>
									<input
										type="text"
										id="backupCron"
										bind:value={s.settings.backupCron}
										placeholder="0 2 * * *"
									/>
									<p class="help-text">Cron expression (e.g. "0 2 * * *" for daily at 2 AM)</p>
								</div>
								<div class="form-group">
									<label for="backupPath">Backup path</label>
									<input
										type="text"
										id="backupPath"
										bind:value={s.settings.backupPath}
										placeholder="/backups"
									/>
								</div>
							</div>
						{/if}
					</div>
{/if}

{#if activeSection() === 'notifications'}
<div class="settings-section" id="notifications" >
						<h2>Notifications</h2>
						<div class="form-group">
							<label for="appriseUrl">Apprise URL</label>
							<input
								type="text"
								id="appriseUrl"
								bind:value={s.settings.appriseUrl}
								placeholder="http://apprise:8000"
							/>
							<p class="help-text">
								URL of your Apprise API server for push notifications. Linked accounts with their
								own Apprise URL are notified separately.
							</p>
						</div>

						{#if s.settings.appriseUrl}
							<div class="form-group">
								<label>
									<input type="checkbox" bind:checked={s.settings.notifyOnComplete} />
									Notify on download complete
								</label>
							</div>
							<div class="form-group">
								<label>
									<input type="checkbox" bind:checked={s.settings.notifyOnFail} />
									Notify on download failure
								</label>
							</div>
							<div class="jellyfin-test nested-field">
								<button
									type="button"
									class="btn btn-secondary btn-sm btn-with-icon"
									onclick={s.testNotification}
									disabled={s.testingNotification}
								>
									<BellIcon width={14} height={14} />
									{s.testingNotification ? 'Sending...' : 'Test Notification'}
								</button>
								{#if s.notificationTestResult}
									<span
										class="test-result"
										class:success={s.notificationTestResult.success}
										class:error={!s.notificationTestResult.success}
									>
										{s.notificationTestResult.message}
									</span>
								{/if}
							</div>
						{/if}
					</div>
{/if}

{#if activeSection() === 'ldap'}
<div class="settings-section" id="ldap" >
						<h2>LDAP</h2>
						{#if s.settings.ldapManagedByEnv}
							<div class="info-box managed-box" style="margin-bottom: var(--spacing-lg);">
								Managed by environment variables. LDAP settings are controlled by <code>LDAP_*</code
								> env vars and cannot be changed here.
							</div>
						{/if}
						<div class="form-group">
							<label>
								<input
									type="checkbox"
									bind:checked={s.settings.ldapEnabled}
									disabled={s.settings.ldapManagedByEnv}
								/>
								Enable LDAP authentication
							</label>
							<p class="help-text">Users authenticating via LDAP are auto-created on first login</p>
						</div>

						{#if s.settings.ldapEnabled}
							<div class="form-group nested-field">
								<label for="ldapUrl">LDAP Server URL</label>
								<input
									type="text"
									id="ldapUrl"
									bind:value={s.settings.ldapUrl}
									placeholder="ldap://ldap.example.com:389"
									disabled={s.settings.ldapManagedByEnv}
								/>
							</div>
							<div class="form-row nested-field">
								<div class="form-group">
									<label for="ldapBindDn">Bind DN</label>
									<input
										type="text"
										id="ldapBindDn"
										bind:value={s.settings.ldapBindDn}
										placeholder="cn=admin,dc=example,dc=com"
										disabled={s.settings.ldapManagedByEnv}
									/>
								</div>
								<div class="form-group">
									<label for="ldapBindPassword">Bind Password</label>
									<PasswordInput
										id="ldapBindPassword"
										bind:value={s.settings.ldapBindPassword}
										placeholder="••••••••"
										disabled={s.settings.ldapManagedByEnv}
									/>
								</div>
							</div>
							<div class="form-group nested-field">
								<label for="ldapSearchBase">Search Base</label>
								<input
									type="text"
									id="ldapSearchBase"
									bind:value={s.settings.ldapSearchBase}
									placeholder="ou=users,dc=example,dc=com"
									disabled={s.settings.ldapManagedByEnv}
								/>
							</div>
							<div class="form-group nested-field">
								<label for="ldapSearchFilter">Search Filter</label>
								<input
									type="text"
									id="ldapSearchFilter"
									bind:value={s.settings.ldapSearchFilter}
									placeholder={'(uid={{username}})'}
									disabled={s.settings.ldapManagedByEnv}
								/>
								<p class="help-text">
									Use {'{{username}}'} as placeholder. For Active Directory use (sAMAccountName={'{{username}}'})
								</p>
							</div>
						{/if}
					</div>
{/if}

{#if activeSection() === 'proxy-auth'}
<div class="settings-section" id="proxy-auth" >
						<h2>Reverse Proxy Auth</h2>
						<div class="form-group">
							<label>
								<input type="checkbox" bind:checked={s.settings.proxyAuthEnabled} />
								Enable reverse proxy authentication
							</label>
							<p class="help-text">
								Automatically log in users based on a header set by your reverse proxy (Authelia,
								Authentik, etc.)
							</p>
						</div>

						{#if s.settings.proxyAuthEnabled}
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
									bind:value={s.settings.proxyAuthHeader}
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
{/if}

{#if activeSection() === 'oidc'}
<div class="settings-section" id="oidc" >
						<h2>OIDC / SSO</h2>
						{#if s.settings.oidcManagedByEnv}
							<div class="info-box managed-box" style="margin-bottom: var(--spacing-lg);">
								Managed by environment variables. OIDC settings are controlled by <code>OIDC_*</code
								> env vars and cannot be changed here.
							</div>
						{/if}
						<div class="form-group">
							<label>
								<input
									type="checkbox"
									bind:checked={s.settings.oidcEnabled}
									disabled={s.settings.oidcManagedByEnv}
								/>
								Enable OIDC / SSO login
							</label>
							<p class="help-text">
								Allow users to sign in through an external identity provider (Authentik, Keycloak,
								Google, etc.)
							</p>
						</div>

						{#if s.settings.oidcEnabled}
							<div class="form-group nested-field">
								<label for="oidcIssuerUrl">Issuer URL</label>
								<input
									type="text"
									id="oidcIssuerUrl"
									bind:value={s.settings.oidcIssuerUrl}
									placeholder="https://sso.example.com/application/o/wytui/"
									disabled={s.settings.oidcManagedByEnv}
								/>
								<p class="help-text">The OpenID Connect issuer / discovery base URL</p>
							</div>
							<div class="form-row nested-field">
								<div class="form-group">
									<label for="oidcClientId">Client ID</label>
									<input
										type="text"
										id="oidcClientId"
										bind:value={s.settings.oidcClientId}
										placeholder="wytui"
										disabled={s.settings.oidcManagedByEnv}
									/>
								</div>
								<div class="form-group">
									<label for="oidcClientSecret">Client Secret</label>
									<PasswordInput
										id="oidcClientSecret"
										bind:value={s.settings.oidcClientSecret}
										placeholder="••••••••"
										disabled={s.settings.oidcManagedByEnv}
									/>
								</div>
							</div>
							<div class="form-group nested-field">
								<label for="oidcDisplayName">Display Name</label>
								<input
									type="text"
									id="oidcDisplayName"
									bind:value={s.settings.oidcDisplayName}
									placeholder="SSO"
									disabled={s.settings.oidcManagedByEnv}
								/>
								<p class="help-text">Label shown on the sign-in button (e.g. "Company SSO")</p>
							</div>
						{/if}
					</div>
{/if}

{#if activeSection() === 'auth-mode'}
<div class="settings-section" id="auth-mode" >
						<h2>Authentication</h2>
						<div class="form-group">
							<label for="authMode">Login Method</label>
							<select
								id="authMode"
								bind:value={s.settings.authMode}
								disabled={!s.settings.oidcConfigured}
							>
								{#if s.settings.oidcConfigured}
									<option value="password" disabled={!s.settings.canUsePasswordOnly}
										>Password Only{!s.settings.canUsePasswordOnly
											? ' (no admin has a password)'
											: ''}</option
									>
									<option value="both">Password + {s.settings.oidcDisplayName || 'SSO'}</option>
									<option value="oidc">{s.settings.oidcDisplayName || 'SSO'} Only</option>
								{:else}
									<option value="password" selected>Password Only</option>
								{/if}
							</select>
							<p class="help-text">Choose which login methods are shown on the sign-in page</p>
							{#if s.settings.oidcConfigured && !s.settings.canUsePasswordOnly}
								<div class="info-box warning-box">
									Password-only mode is unavailable because no admin account has a password set. Set
									a password for an admin account to enable this option.
								</div>
							{/if}
						</div>

						{#if s.settings.oidcConfigured && s.settings.authMode === 'oidc'}
							<div class="info-box warning-box">
								Password login will remain accessible at <code>/auth/signin?fallback=password</code> as
								a safety fallback in case SSO is unavailable.
							</div>
						{/if}
					</div>
{/if}

{#if activeSection() === 'privacy'}
<div class="settings-section" id="privacy" >
						<h2>Stats &amp; Privacy</h2>
						<div class="form-group">
							<label class="toggle-label">
								<input type="checkbox" bind:checked={s.settings.statsVisibleToNonAdmins} />
								Show stats panel to non-admins
							</label>
							<p class="help-text">Let non-admin users see the statistics panel.</p>
						</div>
						<div class="form-group">
							<label class="toggle-label">
								<input type="checkbox" bind:checked={s.settings.showTotalSizeToNonAdmins} />
								Show total/global storage size to non-admins
							</label>
							<p class="help-text">Reveal the aggregate library/storage size to non-admin users.</p>
						</div>
					</div>
{/if}

{#if activeSection() === 'config'}
<div class="settings-section" id="config" >
						<h2>Import / Export</h2>
						<p class="help-text" style="margin-bottom: var(--spacing-lg);">
							Back up the full app configuration as YAML, or restore it on this or another instance.
						</p>

						<div class="form-group">
							<button
								class="btn btn-secondary btn-sm btn-with-icon"
								onclick={s.exportConfig}
								disabled={s.exportingConfig}
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
								{s.exportingConfig ? 'Exporting...' : 'Export Config'}
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
								{s.importingConfig ? 'Reading...' : 'Import Config'}
								<input
									type="file"
									accept=".yaml,.yml"
									onchange={s.handleImportFile}
									disabled={s.importingConfig}
									style="display: none;"
								/>
							</label>
							<p class="help-text">
								You'll see exactly what will change before anything is applied.
							</p>
						</div>

						{#if s.importError && !s.importPreview}
							<div class="error-message" style="margin-top: var(--spacing-md);">
								{s.importError}
							</div>
						{/if}
					</div>

					<div class="api-docs-link" style={activeSection() !== 'config' ? 'display:none;' : ''}>
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
{/if}
