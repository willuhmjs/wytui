import { prisma } from '../db';
import { downloadService } from './download.service';
import { ytdlpService } from './ytdlp.service';
import { youtubeService } from './youtube.service';
import { sseEmitter } from '../sse/emitter';
import cron, { type ScheduledTask } from 'node-cron';
import type { Subscription } from '@prisma/client';
import { spawn } from 'child_process';
import { access } from 'fs/promises';
import { RateLimitError, isRateLimitedError, runYtdlpJson } from '../utils/ytdlp-json';

class SubscriptionService {
	private static readonly CHECK_DEPTH = 15;
	private scheduledTasks = new Map<string, ScheduledTask>();
	private activeChecks = new Set<string>();

	/**
	 * Timestamp until which checks are paused after a rate limit. YouTube blocks
	 * are IP-wide, so one 429 means every other check in the window will fail
	 * too — backing off globally avoids hammering the blocked endpoint.
	 */
	private rateLimitCooldownUntil = 0;
	private static readonly RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000;

	/**
	 * Start subscription scheduler
	 */
	async startScheduler(): Promise<void> {
		console.log('[Subscriptions] Starting scheduler...');

		// Load all enabled subscriptions
		const subscriptions = await prisma.subscription.findMany({
			where: { enabled: true },
			include: { profile: true },
		});

		for (const subscription of subscriptions) {
			await this.scheduleSubscription(subscription);
		}

		console.log(`[Subscriptions] Scheduled ${subscriptions.length} subscriptions`);
	}

	/**
	 * Schedule a subscription
	 */
	async scheduleSubscription(subscription: any): Promise<void> {
		// Remove existing task if any
		this.unscheduleSubscription(subscription.id);

		// Hash the subscription ID to a stable per-subscription minute offset so
		// that subscriptions with the same check interval don't all fire at minute 0.
		// This spreads load across the interval window and reduces the chance of
		// hitting YouTube's rate limits when many subscriptions check simultaneously.
		const offset = this.idToMinuteOffset(subscription.id);
		const cronExpr = this.secondsToCron(subscription.checkInterval, offset);

		const task = cron.schedule(cronExpr, async () => {
			await this.checkSubscription(subscription.id);
		});

		this.scheduledTasks.set(subscription.id, task);
		console.log(`[Subscriptions] Scheduled ${subscription.name} (${cronExpr})`);
	}

	/**
	 * Map a subscription ID to a stable minute offset (0–59) so checks are spread
	 * evenly across the check interval rather than all firing at the same time.
	 */
	private idToMinuteOffset(id: string): number {
		let hash = 0;
		for (let i = 0; i < id.length; i++) {
			hash = (Math.imul(hash, 31) + id.charCodeAt(i)) | 0;
		}
		return Math.abs(hash) % 60;
	}

	/**
	 * Unschedule a subscription
	 */
	unscheduleSubscription(subscriptionId: string): void {
		const task = this.scheduledTasks.get(subscriptionId);
		if (task) {
			task.stop();
			this.scheduledTasks.delete(subscriptionId);
		}
	}

	/**
	 * Check subscription for new videos
	 *
	 * `force` bypasses the global rate-limit cooldown (used by the manual
	 * "Check now" button so the user can always probe a channel directly).
	 */
	async checkSubscription(subscriptionId: string, opts: { force?: boolean } = {}): Promise<void> {
		// Prevent concurrent checks
		if (this.activeChecks.has(subscriptionId)) {
			console.log(`[Subscriptions] Check already in progress for ${subscriptionId}`);
			return;
		}

		if (!opts.force && Date.now() < this.rateLimitCooldownUntil) {
			console.log('[Subscriptions] Skipping check — rate-limit cooldown active');
			return;
		}

		this.activeChecks.add(subscriptionId);

		try {
			const subscription = await prisma.subscription.findUnique({
				where: { id: subscriptionId },
				include: { profile: true },
			});

			if (!subscription || !subscription.enabled) {
				this.activeChecks.delete(subscriptionId);
				return;
			}

			console.log(`[Subscriptions] Checking ${subscription.name}...`);

			// Feed-based detection: if the owner linked YouTube and enabled feed mode,
			// prefer the single subscription feed over polling this channel directly.
			let videos: any[] | null = null;
			let trustUndatedEntries = false;
			if (subscription.userId) {
				const link = await prisma.youTubeLink.findUnique({
					where: { userId: subscription.userId },
				});
				if (link?.useFeedForNewVideos) {
					const feed = await youtubeService.fetchSubscriptionFeed(subscription.userId);
					if (!('needsRelink' in feed)) {
						const matched = this.matchFeedToSubscription(feed, subscription);
						if (matched.length > 0) {
							videos = matched;
							// The linked-account feed only surfaces recent uploads, so an
							// archived entry reappearing there is almost certainly new.
							trustUndatedEntries = true;
							console.log(
								`[Subscriptions] Using YouTube feed for ${subscription.name}: ${videos.length} candidate(s)`,
							);
						}
						// if matched.length === 0 we leave videos = null and fall through to polling
					}
					// needsRelink → leave videos = null, fall through to normal polling (graceful degradation)
				}
			}
			if (videos === null) {
				videos = await this.getLatestVideos(subscription);
			}

			// Shorts carry /shorts/ URLs in both the RSS feed and flat playlist
			// listings, so they can be dropped before any metadata fetch.
			const candidates = subscription.excludeShorts
				? videos.filter((v) => !v.url?.includes('/shorts/'))
				: videos;

			// Filter out already downloaded videos
			const newVideos = await this.filterNewVideos(candidates, subscription, {
				trustUndatedEntries,
			});

			if (newVideos.length > 0 && subscription.autoDownload) {
				console.log(
					`[Subscriptions] Found ${newVideos.length} new videos for ${subscription.name}`,
				);

				for (const video of newVideos) {
					try {
						await downloadService.createDownload(
							video.url,
							subscription.profileId,
							subscription.userId || undefined,
							subscriptionId,
							subscription.saveToLibrary,
							subscription.customFlags?.length ? subscription.customFlags : undefined,
						);
					} catch (err) {
						console.error(`[Subscriptions] Failed to create download for ${video.url}:`, err);
					}
				}
			} else {
				console.log(`[Subscriptions] No new videos for ${subscription.name}`);
			}

			const latestUpload = videos.reduce<Date | null>((latest, v) => {
				if (v.uploadedAt instanceof Date && (!latest || v.uploadedAt > latest)) {
					return v.uploadedAt;
				}
				return latest;
			}, null);

			await prisma.subscription.update({
				where: { id: subscriptionId },
				data: {
					lastChecked: new Date(),
					lastError: null,
					...(latestUpload && { lastVideoDate: latestUpload }),
				},
			});

			sseEmitter.broadcast('subscription:checked', {
				id: subscriptionId,
				name: subscription.name,
				newVideos: newVideos.length,
			});
		} catch (error: any) {
			const rateLimited = error?.isRateLimit === true;
			if (rateLimited) {
				this.rateLimitCooldownUntil = Date.now() + SubscriptionService.RATE_LIMIT_COOLDOWN_MS;
			}
			console.error(
				`[Subscriptions] Check failed for ${subscriptionId}${rateLimited ? ' (rate limited)' : ''}:`,
				error,
			);

			// Record the failure on the subscription so the UI can show *why*
			// a check is stale instead of silently freezing lastChecked.
			await prisma.subscription
				.update({
					where: { id: subscriptionId },
					data: {
						lastChecked: new Date(),
						lastError: (rateLimited
							? 'YouTube rate limit reached'
							: (error?.message ?? 'Unknown error')
						).slice(0, 500),
					},
				})
				.catch(() => {});

			// Notify connected clients so the UI can surface the failure.
			sseEmitter.broadcast('subscription:check:error', {
				id: subscriptionId,
				rateLimited,
				message: rateLimited
					? 'YouTube rate limit reached — will retry at next interval'
					: (error?.message ?? 'Unknown error'),
			});
		} finally {
			this.activeChecks.delete(subscriptionId);
		}
	}

	/**
	 * Match feed entries to this subscription's channel
	 */
	private matchFeedToSubscription(feed: any[], subscription: any): any[] {
		// Extract channel ID from subscription URL if present
		const channelIdMatch = subscription.url.match(/\/channel\/(UC[\w-]+)/);
		if (channelIdMatch) {
			const channelId = channelIdMatch[1];
			return feed.filter((entry) => entry.channelId === channelId);
		}

		// Otherwise match by uploader name (case-insensitive)
		if (subscription.name) {
			const normalizedName = subscription.name.toLowerCase();
			return feed.filter((entry) => entry.uploader?.toLowerCase() === normalizedName);
		}

		return [];
	}

	/**
	 * Get the latest videos for a subscription check.
	 *
	 * Prefers YouTube's public per-channel RSS feed: a single plain HTTPS request
	 * that carries real publish dates and is not subject to the "confirm you're
	 * not a bot" player checks that full yt-dlp extraction triggers. Falls back
	 * to a flat-playlist browse listing (also a single request, but no dates)
	 * when the feed is unavailable — e.g. playlist-type subscriptions.
	 */
	private async getLatestVideos(subscription: any): Promise<any[]> {
		if (subscription.type === 'CHANNEL') {
			try {
				const channelId = await this.resolveChannelId(subscription);
				if (channelId) {
					const videos = await this.fetchChannelFeed(channelId);
					if (videos.length > 0) return videos;
				}
			} catch (err: any) {
				// Rate limits are IP-wide — don't fall back to more yt-dlp traffic.
				if (err?.isRateLimit) throw err;
				console.warn(
					`[Subscriptions] RSS feed unavailable for ${subscription.name}, falling back to playlist listing:`,
					err?.message ?? err,
				);
			}
		}
		return this.fetchPlaylistEntries(subscription.url, {
			limit: SubscriptionService.CHECK_DEPTH,
		});
	}

	/**
	 * Global yt-dlp defaults (proxy + extra flags) from the settings singleton.
	 */
	private async getYtdlpDefaults(): Promise<{ proxyUrl: string | null; extraFlags: string[] }> {
		const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
		return {
			proxyUrl: settings?.ytdlpProxyUrl ?? null,
			extraFlags: settings?.ytdlpExtraFlags ?? [],
		};
	}

	/**
	 * Resolve a subscription URL to a YouTube channel ID (UC…) for RSS lookups.
	 * The result is cached on the subscription row; @handle URLs are resolved
	 * once via a single flat yt-dlp browse request.
	 */
	private async resolveChannelId(subscription: any): Promise<string | null> {
		if (subscription.channelId) return subscription.channelId;

		const fromUrl = subscription.url?.match(/\/channel\/(UC[\w-]+)/)?.[1];
		if (fromUrl) {
			await prisma.subscription
				.update({ where: { id: subscription.id }, data: { channelId: fromUrl } })
				.catch(() => {});
			return fromUrl;
		}

		const defaults = await this.getYtdlpDefaults();
		const json = await runYtdlpJson(subscription.url, {
			proxyUrl: defaults.proxyUrl,
			extraArgs: [
				'--playlist-items',
				'0',
				...ytdlpService.buildDefaultsArgs({ extraFlags: defaults.extraFlags }),
			],
			timeoutMs: 30000,
		});
		const channelId = (() => {
			try {
				return JSON.parse(json)?.channel_id ?? null;
			} catch {
				return null;
			}
		})();
		if (channelId) {
			await prisma.subscription
				.update({ where: { id: subscription.id }, data: { channelId } })
				.catch(() => {});
		}
		return channelId;
	}

	/**
	 * Fetch a channel's public RSS feed (~15 most recent uploads with publish
	 * dates). No yt-dlp, no player API, no bot checks — just one GET.
	 */
	private async fetchChannelFeed(channelId: string): Promise<any[]> {
		const res = await fetch(
			`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,
			{
				signal: AbortSignal.timeout(15000),
				headers: { 'User-Agent': 'Mozilla/5.0 (compatible; wytui)' },
			},
		);
		if (!res.ok) throw new Error(`Feed request failed: HTTP ${res.status}`);
		const xml = await res.text();

		const videos: any[] = [];
		for (const entry of xml.split('<entry>').slice(1)) {
			const id = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(entry)?.[1];
			const title = /<title>([^<]*)<\/title>/.exec(entry)?.[1];
			const url = /<link rel="alternate" href="([^"]+)"/.exec(entry)?.[1];
			const published = /<published>([^<]+)<\/published>/.exec(entry)?.[1];
			if (!id || !url) continue;

			videos.push({
				id,
				title: title ? decodeXmlEntities(title) : id,
				url,
				uploadedAt: published ? new Date(published) : null,
				liveStatus: null,
			});
		}
		return videos;
	}

	/**
	 * Get latest videos from a channel/playlist via a flat listing (fixed depth)
	 */
	private async getLatestVideosByUrl(url: string): Promise<any[]> {
		return this.fetchPlaylistEntries(url, { limit: SubscriptionService.CHECK_DEPTH });
	}

	/**
	 * Fetch playlist entries from yt-dlp with optional limit and date filter
	 */
	private async fetchPlaylistEntries(
		url: string,
		opts: { limit?: number; dateAfter?: string } = {},
	): Promise<any[]> {
		ytdlpService.validateUrl(url);

		const useFullExtraction = !!opts.dateAfter;
		const defaults = await this.getYtdlpDefaults();

		return new Promise((resolve, reject) => {
			const args = ['--print', 'id', '--print', 'title', '--print', 'webpage_url'];

			if (useFullExtraction) {
				args.unshift('--no-download');
				args.push('--dateafter', opts.dateAfter!);
			} else {
				args.unshift('--flat-playlist');
			}

			if (opts.limit) {
				args.push('--playlist-end', opts.limit.toString());
			}

			args.push(...ytdlpService.buildDefaultsArgs(defaults), url);

			const proc = spawn(ytdlpService.getPath(), args);
			let output = '';
			let error = '';
			let settled = false;

			// Guard against a hung/slow yt-dlp keeping a scheduler tick alive forever.
			const timeout = setTimeout(() => {
				if (settled) return;
				settled = true;
				try {
					proc.kill('SIGKILL');
				} catch {}
				reject(new Error('yt-dlp playlist fetch timed out'));
			}, 120000);

			proc.stdout.on('data', (data) => {
				output += data.toString();
			});

			proc.stderr.on('data', (data) => {
				error += data.toString();
			});

			proc.on('error', (err) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				reject(err);
			});

			proc.on('close', (code) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				if (code === 0) {
					const lines = output.trim().split('\n');
					const videos = [];

					for (let i = 0; i < lines.length; i += 3) {
						if (i + 2 < lines.length) {
							videos.push({
								id: lines[i],
								title: lines[i + 1],
								url: lines[i + 2],
							});
						}
					}

					resolve(videos);
				} else if (isRateLimitedError(error)) {
					reject(new RateLimitError(error.trim() || 'YouTube rate limit (HTTP 429)'));
				} else {
					reject(new Error(`yt-dlp failed: ${error}`));
				}
			});

			proc.on('error', (err) => reject(err));
		});
	}

	/**
	 * Seed archive with current videos so new subscriptions are future-only
	 */
	async seedArchive(subscriptionId: string): Promise<number> {
		const subscription = await prisma.subscription.findUnique({
			where: { id: subscriptionId },
		});

		if (!subscription) return 0;

		const videos = await this.getLatestVideosByUrl(subscription.url);
		let seeded = 0;

		for (const video of videos) {
			await prisma.archive.upsert({
				where: { videoId: video.id },
				update: {},
				create: {
					videoId: video.id,
					url: video.url,
					title: video.title,
				},
			});
			seeded++;
		}

		console.log(`[Subscriptions] Seeded archive with ${seeded} videos for ${subscription.name}`);
		return seeded;
	}

	/**
	 * Backfill a subscription — download all or date-filtered videos
	 */
	async backfillSubscription(
		subscriptionId: string,
		opts: { dateAfter?: string } = {},
	): Promise<{ totalVideos: number; newVideos: number }> {
		const subscription = await prisma.subscription.findUnique({
			where: { id: subscriptionId },
			include: { profile: true },
		});

		if (!subscription) {
			throw new Error('Subscription not found');
		}

		const videos = await this.fetchPlaylistEntries(subscription.url, { dateAfter: opts.dateAfter });
		const candidates = subscription.excludeShorts
			? videos.filter((v) => !v.url?.includes('/shorts/'))
			: videos;
		const newVideos = await this.filterNewVideos(candidates, subscription);

		for (const video of newVideos) {
			try {
				await downloadService.createDownload(
					video.url,
					subscription.profileId,
					subscription.userId || undefined,
					subscriptionId,
					subscription.saveToLibrary,
					subscription.customFlags?.length ? subscription.customFlags : undefined,
				);
			} catch (err) {
				console.error(`[Subscriptions] Backfill: failed to create download for ${video.url}:`, err);
			}
		}

		console.log(
			`[Subscriptions] Backfill for ${subscription.name}: ${newVideos.length} new of ${videos.length} total`,
		);

		sseEmitter.broadcast('subscription:backfill', {
			id: subscriptionId,
			name: subscription.name,
			totalVideos: videos.length,
			newVideos: newVideos.length,
		});

		return { totalVideos: videos.length, newVideos: newVideos.length };
	}

	/**
	 * Filter out already downloaded videos
	 * Checks both the archive and pending/active downloads to prevent duplicates.
	 *
	 * When `subscription` is provided and the videos carry publish dates (the
	 * RSS-feed path), the archive is no longer treated as an unconditional
	 * skip: a video that was only *seeded* (archived without ever being downloaded)
	 * is reconsidered if it was actually published after the subscription was
	 * created. This heals the case where a scheduled/premiere video gets pre-seeded
	 * into the global archive and is then silently skipped once it goes public.
	 *
	 * `trustUndatedEntries` restores the legacy behavior for sources that only
	 * surface recent uploads (the linked-account feed) even though their entries
	 * carry no dates. Otherwise, undated entries (flat-playlist fallback) stay
	 * skipped — re-downloading a channel's back-catalog is worse than missing a
	 * borderline entry.
	 */
	private async filterNewVideos(
		videos: any[],
		subscription?: any,
		opts: { trustUndatedEntries?: boolean } = {},
	): Promise<any[]> {
		const newVideos = [];
		const subCreatedAt = subscription?.createdAt
			? new Date(subscription.createdAt).getTime()
			: null;
		const now = Date.now();

		for (const video of videos) {
			// Skip videos that aren't actually published yet (upcoming premieres /
			// in-progress livestreams, or a publish timestamp still in the future).
			if (video.liveStatus === 'is_upcoming' || video.liveStatus === 'is_live') {
				continue;
			}
			if (video.uploadedAt instanceof Date && video.uploadedAt.getTime() > now) {
				continue;
			}

			const archived = await prisma.archive.findUnique({
				where: { videoId: video.id },
			});

			if (archived) {
				// Deliberately skipped (e.g. excluded short) — never re-queue.
				if (archived.reason) {
					continue;
				}

				const download = await prisma.download.findFirst({
					where: { url: video.url, status: 'COMPLETED' },
					select: { id: true, filepath: true },
				});

				if (download?.filepath) {
					try {
						await access(download.filepath);
						continue;
					} catch {
						await prisma.archive.delete({ where: { videoId: video.id } });
						await prisma.download.delete({ where: { id: download.id } });
					}
				} else {
					// Seed-only archive entry: no completed download file exists.
					//
					// If we have a reliable publish timestamp AND the subscription
					// creation date, use them to decide:
					//   - Published before subscription → was back-catalog at import time → skip
					//   - Published after subscription  → new upload that was coincidentally
					//                                    seeded (e.g. premiere that went live
					//                                    shortly after creation) → allow
					//
					// Without a timestamp (flat-playlist fallback) we keep skipping
					// unless the source is known to only surface recent uploads.
					const hasTimestamp = video.uploadedAt instanceof Date;
					const ageDeterminate = subCreatedAt != null && hasTimestamp;

					if (!ageDeterminate && !opts.trustUndatedEntries) {
						continue;
					}

					if (ageDeterminate) {
						const publishedAfterSub = video.uploadedAt!.getTime() > subCreatedAt;
						if (!publishedAfterSub) {
							// Confirmed back-catalog entry — keep skipping.
							continue;
						}
					}

					// Age unknown (trusted source) or confirmed new — clear the stale
					// seed entry and let the video download (it will be properly
					// re-archived on completion).
					await prisma.archive.delete({ where: { videoId: video.id } }).catch(() => {});
				}
			}

			const existingDownload = await prisma.download.findFirst({
				where: {
					url: video.url,
					status: {
						in: ['PENDING', 'FETCHING_INFO', 'DOWNLOADING', 'PROCESSING', 'COMPLETED'],
					},
				},
			});

			if (!existingDownload) {
				newVideos.push(video);
			}
		}

		return newVideos;
	}

	/**
	 * Convert seconds to a cron expression with an optional minute offset.
	 *
	 * The offset spreads subscriptions across the interval window so they don't
	 * all fire at minute 0 and hammer YouTube simultaneously.
	 */
	private secondsToCron(seconds: number, offset = 0): string {
		const off = ((offset % 60) + 60) % 60; // normalise to 0–59

		if (seconds < 60) {
			return '* * * * *';
		} else if (seconds < 3600) {
			const minutes = Math.floor(seconds / 60);
			// Build an explicit list of minutes instead of */N so the offset applies.
			// E.g. 30-min interval with offset 7  → "7,37 * * * *"
			// E.g. 30-min interval with offset 45 → "15,45 * * * *" (wrap so interval stays 30)
			const start = off % minutes;
			const marks: number[] = [];
			for (let m = start; m < 60; m += minutes) marks.push(m);
			return `${marks.join(',')} * * * *`;
		} else if (seconds < 86400) {
			const hours = Math.floor(seconds / 3600);
			return `${off % 60} */${hours} * * *`;
		} else {
			const days = Math.floor(seconds / 86400);
			return `0 ${off % 24} */${days} * *`;
		}
	}

	/**
	 * Stop all scheduled tasks
	 */
	stopAll(): void {
		for (const [id, task] of this.scheduledTasks.entries()) {
			task.stop();
		}
		this.scheduledTasks.clear();
		console.log('[Subscriptions] Stopped all tasks');
	}
}

/** Decode the handful of XML entities YouTube's feed titles contain. */
function decodeXmlEntities(s: string): string {
	return s
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}

// Singleton instance
export const subscriptionService = new SubscriptionService();
