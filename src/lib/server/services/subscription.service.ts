import { prisma } from '../db';
import { downloadService } from './download.service';
import { ytdlpService } from './ytdlp.service';
import { youtubeService } from './youtube.service';
import { youtubeLinkService } from './youtube-link.service';
import { sseEmitter } from '../sse/emitter';
import { queueService } from './queue.service';
import { CronExpressionParser } from 'cron-parser';
import type { Subscription } from '@prisma/client';
import { spawn } from 'child_process';
import { access } from 'fs/promises';
import {
	RateLimitError,
	YtdlpAuthError,
	isRateLimitedError,
	isAuthError,
	runYtdlpJson,
} from '../utils/ytdlp-json';
import { armRateLimitCooldown, isRateLimitCooldownActive } from '../utils/rate-limit-cooldown';

class SubscriptionService {
	private static readonly CHECK_DEPTH = 15;

	private activeChecks = new Set<string>();

	/**
	 * Rate-limit cooldown lives in a shared module (see
	 * ../utils/rate-limit-cooldown): YouTube blocks are IP-wide, so one 429
	 * means every other check in the window will fail too — and download,
	 * playlist, and sync paths arm the same cooldown.
	 */

	/**
	 * Start subscription scheduler
	 */
	async startScheduler(): Promise<void> {
		console.log('[Subscriptions] Starting scheduler...');

		queueService.registerHandler('subscription', async (job) => {
			const payload = job.payload as any;
			if (!payload?.subscriptionId) return;

			await this.checkSubscription(payload.subscriptionId);

			// Reschedule for next time
			const sub = await prisma.subscription.findUnique({ where: { id: payload.subscriptionId } });
			if (sub && sub.enabled) {
				await this.scheduleSubscription(sub);
			}
		});

		// Load all enabled subscriptions
		const subscriptions = await prisma.subscription.findMany({
			where: { enabled: true },
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
		const offset = this.idToMinuteOffset(subscription.id);
		const cronExpr = this.secondsToCron(subscription.checkInterval, offset);

		try {
			const interval = CronExpressionParser.parse(cronExpr);
			const nextRun = interval.next().toDate();

			// Clear any existing job
			await this.unscheduleSubscription(subscription.id);

			await queueService.enqueue(
				'subscription',
				{ subscriptionId: subscription.id },
				{ runAt: nextRun },
			);
			console.log(`[Subscriptions] Scheduled ${subscription.name} at ${nextRun} (${cronExpr})`);
		} catch (e) {
			console.error(`[Subscriptions] Failed to schedule ${subscription.name}:`, e);
		}
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
	async unscheduleSubscription(subscriptionId: string): Promise<void> {
		// Prisma cannot filter nicely by JSON contents, so we fetch and filter in JS
		// Since subscriptions are not thousands, this is acceptable.
		const jobs = await prisma.jobQueue.findMany({
			where: { type: 'subscription' },
		});
		const toDelete = jobs.filter((j) => (j.payload as any)?.subscriptionId === subscriptionId);
		for (const job of toDelete) {
			await prisma.jobQueue.delete({ where: { id: job.id } });
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

		if (!opts.force && isRateLimitCooldownActive()) {
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
					try {
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
					} catch (err: any) {
						// Rate limits are IP-wide — don't fall back to more yt-dlp traffic.
						if (err?.isRateLimit) throw err;
						// A dead session or a transient fetch failure degrades to normal
						// polling rather than failing the whole check.
						console.warn(
							`[Subscriptions] Feed unavailable for ${subscription.name}, falling back to polling:`,
							err?.message ?? err,
						);
					}
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
				armRateLimitCooldown();
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
			userId: subscription.userId,
		});
	}

	/**
	 * Resolve the yt-dlp defaults (proxy + extra flags) for a user's traffic:
	 * per-linked-account overrides when set, otherwise the global settings.
	 * Shared with monitor/service paths so all yt-dlp traffic egresses the same
	 * way (per-account proxy keeps a stable IP per YouTube identity).
	 */
	async getYtdlpDefaults(
		subscription?: { userId?: string | null } | null,
	): Promise<{ proxyUrl: string | null; extraFlags: string[] }> {
		const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
		let proxyUrl = settings?.ytdlpProxyUrl ?? null;
		let extraFlags = settings?.ytdlpExtraFlags ?? [];
		const account = subscription?.userId
			? await youtubeLinkService.getAccountYtdlp(subscription.userId)
			: null;
		if (account) {
			if (account.proxyUrl) proxyUrl = account.proxyUrl;
			if (account.extraFlags.length > 0) extraFlags = account.extraFlags;
		}
		return { proxyUrl, extraFlags };
	}

	/**
	 * Find an existing subscription that already covers the given channel.
	 *
	 * URL equality alone is not enough: the same channel can be referenced as
	 * @handle, /channel/UC…, or /c/… URLs, so also match by resolved channel ID
	 * (either provided by the caller or embedded in a /channel/UC… URL).
	 */
	async findDuplicate(
		userId: string,
		{ url, channelId }: { url: string; channelId?: string | null },
	): Promise<Subscription | null> {
		const byUrl = await prisma.subscription.findFirst({ where: { url, userId } });
		if (byUrl) return byUrl;

		const ids = [channelId, url?.match(/\/channel\/(UC[\w-]+)/)?.[1]].filter(
			(v): v is string => !!v,
		);
		for (const id of ids) {
			const byChannel = await prisma.subscription.findFirst({
				where: { channelId: id, userId, type: 'CHANNEL' },
			});
			if (byChannel) return byChannel;
		}
		return null;
	}

	/**
	 * Fetch a channel's identity (UC… id) and total video count with a single
	 * flat yt-dlp browse call. Returns null when the fetch or parse fails.
	 */
	private async fetchChannelMeta(
		url: string,
		userId?: string | null,
	): Promise<{ channelId: string | null; videoCount: number | null } | null> {
		const defaults = await this.getYtdlpDefaults({ userId });
		try {
			const json = await runYtdlpJson(url, {
				proxyUrl: defaults.proxyUrl,
				extraArgs: [
					'--playlist-items',
					'0',
					...ytdlpService.buildDefaultsArgs({ extraFlags: defaults.extraFlags }),
				],
				timeoutMs: 30000,
			});
			const data = JSON.parse(json);
			const channelId = typeof data?.channel_id === 'string' ? data.channel_id : null;
			const count = data?.playlist_count;
			const videoCount =
				typeof count === 'number' && Number.isFinite(count) && count >= 0
					? Math.floor(count)
					: null;
			return { channelId, videoCount };
		} catch {
			return null;
		}
	}

	/**
	 * Refresh a subscription's cached channel ID and video count (one background
	 * browse call). Fire-and-forget from creation paths so the card's
	 * "N videos" and RSS lookups work without waiting for a check cycle.
	 */
	async refreshChannelMeta(subscriptionId: string): Promise<void> {
		const subscription = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
		if (!subscription) return;
		const meta = await this.fetchChannelMeta(subscription.url, subscription.userId);
		if (!meta) return;
		await prisma.subscription
			.update({
				where: { id: subscription.id },
				data: {
					...(meta.channelId && !subscription.channelId ? { channelId: meta.channelId } : {}),
					...(meta.videoCount !== null ? { videoCount: meta.videoCount } : {}),
				},
			})
			.catch(() => {});
	}

	/**
	 * Resolve a subscription URL to a YouTube channel ID (UC…) for RSS lookups.
	 * The result is cached on the subscription row; @handle URLs are resolved
	 * once via a single flat yt-dlp browse request, which also yields the
	 * channel's video count.
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

		const meta = await this.fetchChannelMeta(subscription.url, subscription.userId);
		if (meta?.channelId) {
			await prisma.subscription
				.update({
					where: { id: subscription.id },
					data: {
						channelId: meta.channelId,
						...(meta.videoCount !== null ? { videoCount: meta.videoCount } : {}),
					},
				})
				.catch(() => {});
			return meta.channelId;
		}
		return null;
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
		if (!res.ok) {
			// A 429 from the feed endpoint means the IP is throttled across YouTube,
			// so classify it as a rate limit: this arms the global cooldown and stops
			// the caller from "falling back" to more yt-dlp traffic while blocked.
			if (res.status === 429) throw new RateLimitError('Feed request failed: HTTP 429');
			throw new Error(`Feed request failed: HTTP ${res.status}`);
		}
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
	 * Fetch playlist entries from yt-dlp with optional limit and date filter.
	 * Uses -J (single JSON dump) so entry fields can never desync — the old
	 * --print line-triplet parsing shifted id/title/url whenever yt-dlp emitted
	 * an extra line (warning, unavailable entry).
	 */
	private async fetchPlaylistEntries(
		url: string,
		opts: { limit?: number; dateAfter?: string; userId?: string | null } = {},
	): Promise<any[]> {
		ytdlpService.validateUrl(url);

		const useFullExtraction = !!opts.dateAfter;
		const defaults = await this.getYtdlpDefaults({ userId: opts.userId });

		return new Promise((resolve, reject) => {
			const args = ['-J', '--no-warnings'];

			if (useFullExtraction) {
				// -J implies simulate; --dateafter lets yt-dlp skip extracting
				// entries older than the subscription's creation date.
				args.push('--dateafter', opts.dateAfter!);
			} else {
				args.push('--flat-playlist');
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
					try {
						const info = JSON.parse(output);
						resolve(SubscriptionService.mapPlaylistEntries(info, opts.dateAfter));
					} catch (e) {
						reject(new Error(`Failed to parse playlist JSON: ${e}`));
					}
				} else if (isRateLimitedError(error)) {
					reject(new RateLimitError(error.trim() || 'YouTube rate limit (HTTP 429)'));
				} else if (isAuthError(error)) {
					reject(new YtdlpAuthError(error.trim() || 'yt-dlp authentication required'));
				} else {
					reject(new Error(`yt-dlp failed: ${error.slice(-500)}`));
				}
			});
		});
	}

	/**
	 * Map a -J playlist dump to {id, title, url} video entries. In full
	 * extraction mode, re-apply the date filter client-side so an entry that
	 * slipped past yt-dlp's own filtering can't resurrect old videos.
	 */
	private static mapPlaylistEntries(
		info: any,
		dateAfter?: string,
	): { id: string; title: string; url: string; uploadedAt?: Date }[] {
		const entries: any[] = Array.isArray(info?.entries) ? info.entries : [];
		let cutoff: Date | null = null;
		if (dateAfter) {
			const y = parseInt(dateAfter.slice(0, 4));
			const m = parseInt(dateAfter.slice(4, 6));
			const d = parseInt(dateAfter.slice(6, 8));
			if (y && m && d) cutoff = new Date(Date.UTC(y, m - 1, d));
		}

		const videos: { id: string; title: string; url: string; uploadedAt?: Date }[] = [];
		for (const e of entries) {
			if (!e?.id) continue;
			let uploadedAt: Date | undefined;
			if (e.upload_date) {
				const y = parseInt(String(e.upload_date).slice(0, 4));
				const m = parseInt(String(e.upload_date).slice(4, 6));
				const d = parseInt(String(e.upload_date).slice(6, 8));
				if (y && m && d) uploadedAt = new Date(Date.UTC(y, m - 1, d));
			}
			if (cutoff && (!uploadedAt || uploadedAt < cutoff)) continue;
			videos.push({
				id: e.id,
				title: e.title ?? e.id,
				url: e.webpage_url ?? e.url ?? `https://www.youtube.com/watch?v=${e.id}`,
				uploadedAt,
			});
		}
		return videos;
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

		// Populate the card's video count (and the cached channel ID) from the
		// same browse call shape — fire-and-forget so seeding isn't slowed down.
		void this.refreshChannelMeta(subscriptionId);
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

		const videos = await this.fetchPlaylistEntries(subscription.url, {
			dateAfter: opts.dateAfter,
			userId: subscription.userId,
		});
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
				// A terminal download failure is archived with a timestamp so a
				// persistent error (e.g. disk full) can't re-enqueue the same video
				// on every sync. Once the cooldown lapses the entry is dropped and
				// the video becomes eligible again (completed downloads still block
				// re-queue via the existing-download check below).
				if (archived.reason === 'failed') {
					const FAILED_COOLDOWN_MS = 24 * 60 * 60 * 1000;
					if (archived.failedAt && Date.now() - archived.failedAt.getTime() < FAILED_COOLDOWN_MS) {
						continue;
					}
					await prisma.archive.delete({ where: { videoId: video.id } }).catch(() => {});
				} else if (archived.reason) {
					// Deliberately skipped (e.g. excluded short) — never re-queue.
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
		// DB queue tasks are stopped by stopping the QueueService
		console.log('[Subscriptions] stopAll called');
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
