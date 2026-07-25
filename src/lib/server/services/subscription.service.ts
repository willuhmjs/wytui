import { prisma } from '../db';
import { downloadService } from './download.service';
import { ytdlpService } from './ytdlp.service';
import { youtubeService } from './youtube.service';
import { sseEmitter } from '../sse/emitter';
import cron, { type ScheduledTask } from 'node-cron';
import type { Subscription } from '@prisma/client';
import { spawn } from 'child_process';
import { access } from 'fs/promises';

class SubscriptionService {
	private static readonly CHECK_DEPTH = 15;
	private scheduledTasks = new Map<string, ScheduledTask>();
	private activeChecks = new Set<string>();

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

		// Convert seconds to cron expression (check every X seconds)
		const cronExpr = this.secondsToCron(subscription.checkInterval);

		const task = cron.schedule(cronExpr, async () => {
			await this.checkSubscription(subscription.id);
		});

		this.scheduledTasks.set(subscription.id, task);
		console.log(`[Subscriptions] Scheduled ${subscription.name} (${cronExpr})`);
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
	 */
	async checkSubscription(subscriptionId: string): Promise<void> {
		// Prevent concurrent checks
		if (this.activeChecks.has(subscriptionId)) {
			console.log(`[Subscriptions] Check already in progress for ${subscriptionId}`);
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
				// Get latest videos from channel, including real publish dates so we can
				// tell genuinely-new uploads apart from back-catalog / pre-seeded entries.
				videos = await this.getLatestVideosWithDates(subscription.url);
			}

			// Filter out already downloaded videos
			const newVideos = await this.filterNewVideos(videos, subscription);

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

			await prisma.subscription.update({
				where: { id: subscriptionId },
				data: { lastChecked: new Date() },
			});

			sseEmitter.broadcast('subscription:checked', {
				id: subscriptionId,
				name: subscription.name,
				newVideos: newVideos.length,
			});
		} catch (error) {
			console.error(`[Subscriptions] Check failed for ${subscriptionId}:`, error);
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
	 * Get latest videos from a channel/playlist (fixed depth)
	 */
	private async getLatestVideos(url: string): Promise<any[]> {
		return this.fetchPlaylistEntries(url, { limit: SubscriptionService.CHECK_DEPTH });
	}

	/**
	 * Get latest videos with publish dates and live status (full extraction).
	 *
	 * The subscription checker needs the real upload timestamp of each video so it
	 * can distinguish a genuinely-new upload from a back-catalog entry that was
	 * pre-seeded into the archive. Flat-playlist mode does not return timestamps,
	 * so this does a single full extraction limited to CHECK_DEPTH videos.
	 */
	private async getLatestVideosWithDates(url: string): Promise<any[]> {
		ytdlpService.validateUrl(url);

		// Unit Separator — won't appear in titles, so a single delimited line per
		// video can be parsed without the fragile "group every 3 lines" assumption.
		const SEP = String.fromCharCode(31);

		return new Promise((resolve, reject) => {
			const args = [
				'--no-download',
				'--print',
				`%(id)s${SEP}%(title)s${SEP}%(webpage_url)s${SEP}%(timestamp)s${SEP}%(live_status)s`,
				'--playlist-end',
				SubscriptionService.CHECK_DEPTH.toString(),
				url,
			];

			const proc = spawn(ytdlpService.getPath(), args);
			let output = '';
			let error = '';
			let settled = false;

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

				if (code !== 0) {
					reject(new Error(`yt-dlp failed: ${error}`));
					return;
				}

				const videos = [];
				for (const line of output.split('\n')) {
					if (!line.trim()) continue;
					const parts = line.split(SEP);
					if (parts.length < 3) continue;

					const [id, title, webpageUrl, tsRaw, liveStatus] = parts;
					const ts = tsRaw && tsRaw !== 'NA' ? parseInt(tsRaw, 10) : NaN;

					videos.push({
						id,
						title,
						url: webpageUrl,
						uploadedAt: Number.isFinite(ts) ? new Date(ts * 1000) : null,
						liveStatus: liveStatus && liveStatus !== 'NA' ? liveStatus : null,
					});
				}

				resolve(videos);
			});
		});
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

			args.push(url);

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

		const videos = await this.getLatestVideos(subscription.url);
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
		const newVideos = await this.filterNewVideos(videos);

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
	 * scheduled-check path), the archive is no longer treated as an unconditional
	 * skip: a video that was only *seeded* (archived without ever being downloaded)
	 * is reconsidered if it was actually published after the subscription was
	 * created. This heals the case where a scheduled/premiere video gets pre-seeded
	 * into the global archive and is then silently skipped once it goes public.
	 */
	private async filterNewVideos(videos: any[], subscription?: any): Promise<any[]> {
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
					// Seed-only archive entry (recorded without ever being downloaded).
					// Only un-skip it if we can *positively* confirm the video was
					// published after the subscription was created (e.g. a scheduled
					// premiere that was pre-seeded and later went public). Feed entries
					// carry no upload timestamp, so they cannot clear this bar and must
					// keep respecting the pre-seed/archive skip — otherwise a
					// back-catalog video surfacing in the feed would be resurrected.
					const publishedAfterSub =
						subCreatedAt != null &&
						video.uploadedAt instanceof Date &&
						video.uploadedAt.getTime() > subCreatedAt;

					if (!publishedAfterSub) {
						continue;
					}

					// Stale skip-entry for a genuinely new upload — clear it and treat
					// the video as new so it downloads (and re-archives properly).
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
	 * Convert seconds to cron expression
	 */
	private secondsToCron(seconds: number): string {
		// Convert seconds to nearest cron expression
		if (seconds < 60) {
			// Every X seconds not supported by cron, use every minute
			return '* * * * *';
		} else if (seconds < 3600) {
			// Every X minutes
			const minutes = Math.floor(seconds / 60);
			return `*/${minutes} * * * *`;
		} else if (seconds < 86400) {
			// Every X hours
			const hours = Math.floor(seconds / 3600);
			return `0 */${hours} * * *`;
		} else {
			// Every X days
			const days = Math.floor(seconds / 86400);
			return `0 0 */${days} * *`;
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

// Singleton instance
export const subscriptionService = new SubscriptionService();
