import { prisma } from '../db';
import { downloadService } from './download.service';
import { ytdlpService } from './ytdlp.service';
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

			// Get latest videos from channel
			const videos = await this.getLatestVideos(subscription.url);

			// Filter out already downloaded videos
			const newVideos = await this.filterNewVideos(videos);

			if (newVideos.length > 0 && subscription.autoDownload) {
				console.log(`[Subscriptions] Found ${newVideos.length} new videos for ${subscription.name}`);

				for (const video of newVideos) {
					try {
						await downloadService.createDownload(
							video.url,
							subscription.profileId,
							subscription.userId || undefined,
							subscriptionId,
							subscription.saveToLibrary
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
	 * Get latest videos from a channel/playlist (fixed depth)
	 */
	private async getLatestVideos(url: string): Promise<any[]> {
		return this.fetchPlaylistEntries(url, { limit: SubscriptionService.CHECK_DEPTH });
	}

	/**
	 * Fetch playlist entries from yt-dlp with optional limit and date filter
	 */
	private async fetchPlaylistEntries(url: string, opts: { limit?: number; dateAfter?: string } = {}): Promise<any[]> {
		ytdlpService.validateUrl(url);

		const useFullExtraction = !!opts.dateAfter;

		return new Promise((resolve, reject) => {
			const args = [
				'--print', 'id',
				'--print', 'title',
				'--print', 'webpage_url',
			];

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

			proc.stdout.on('data', (data) => {
				output += data.toString();
			});

			proc.stderr.on('data', (data) => {
				error += data.toString();
			});

			proc.on('close', (code) => {
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
	async backfillSubscription(subscriptionId: string, opts: { dateAfter?: string } = {}): Promise<{ totalVideos: number; newVideos: number }> {
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
					subscription.saveToLibrary
				);
			} catch (err) {
				console.error(`[Subscriptions] Backfill: failed to create download for ${video.url}:`, err);
			}
		}

		console.log(`[Subscriptions] Backfill for ${subscription.name}: ${newVideos.length} new of ${videos.length} total`);

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
	 * Checks both the archive and pending/active downloads to prevent duplicates
	 */
	private async filterNewVideos(videos: any[]): Promise<any[]> {
		const newVideos = [];

		for (const video of videos) {
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
					continue;
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
