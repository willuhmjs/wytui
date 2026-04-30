import { prisma } from '../db';
import { downloadService } from './download.service';
import { ytdlpService } from './ytdlp.service';
import { sseEmitter } from '../sse/emitter';
import cron, { type ScheduledTask } from 'node-cron';
import type { Subscription } from '@prisma/client';
import { spawn } from 'child_process';

class SubscriptionService {
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
			const videos = await this.getLatestVideos(subscription.url, subscription.maxVideos || 5);

			// Filter out already downloaded videos
			const newVideos = await this.filterNewVideos(videos);

			// Update last checked time
			await prisma.subscription.update({
				where: { id: subscriptionId },
				data: { lastChecked: new Date() },
			});

			if (newVideos.length > 0 && subscription.autoDownload) {
				console.log(`[Subscriptions] Found ${newVideos.length} new videos for ${subscription.name}`);

				// Create downloads for new videos
				for (const video of newVideos) {
					await downloadService.createDownload(
						video.url,
						subscription.profileId,
						subscription.userId || undefined,
						subscriptionId
					);
				}

				// Broadcast event
				sseEmitter.broadcast('subscription:checked', {
					id: subscriptionId,
					name: subscription.name,
					newVideos: newVideos.length,
				});
			} else {
				console.log(`[Subscriptions] No new videos for ${subscription.name}`);
			}
		} catch (error) {
			console.error(`[Subscriptions] Check failed for ${subscriptionId}:`, error);
		} finally {
			this.activeChecks.delete(subscriptionId);
		}
	}

	/**
	 * Get latest videos from a channel/playlist
	 */
	private async getLatestVideos(url: string, maxVideos: number): Promise<any[]> {
		ytdlpService.validateUrl(url);

		return new Promise((resolve, reject) => {
			const args = [
				'--flat-playlist',
				'--print', 'id',
				'--print', 'title',
				'--print', 'webpage_url',
				'--playlist-end', maxVideos.toString(),
				url,
			];

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
					// Parse output (format: id\ntitle\nurl\nid\ntitle\nurl...)
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
	 * Filter out already downloaded videos
	 */
	private async filterNewVideos(videos: any[]): Promise<any[]> {
		const newVideos = [];

		for (const video of videos) {
			const exists = await prisma.archive.findUnique({
				where: { videoId: video.id },
			});

			if (!exists) {
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
