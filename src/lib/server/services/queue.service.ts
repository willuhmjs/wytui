import { prisma } from '../db';
import type { QueueStats } from '$lib/types';
import type { JobQueue } from '@prisma/client';

export type JobHandler = (job: JobQueue) => Promise<void>;

export class QueueService {
	private maxConcurrentDownloads: number;
	private handlers = new Map<string, JobHandler>();
	private pollingTimer: NodeJS.Timeout | null = null;
	
	// Active state tracking
	private activeJobs = new Set<string>();
	private activeDownloads = 0;
	private activeMetadata = 0;
	private isPolling = false;

	constructor(maxConcurrent = 3) {
		this.maxConcurrentDownloads = maxConcurrent;
	}

	/**
	 * Register a handler for a specific job type
	 */
	registerHandler(type: string, handler: JobHandler) {
		this.handlers.set(type, handler);
	}

	/**
	 * Start the background queue worker
	 */
	async start() {
		if (this.pollingTimer) return;
		console.log('[QueueService] Starting background worker...');

		// Reset any stale RUNNING jobs back to PENDING from before a server restart
		await prisma.jobQueue.updateMany({
			where: { status: 'RUNNING' },
			data: { status: 'PENDING', startedAt: null }
		});

		this.poll();
		this.pollingTimer = setInterval(() => this.poll(), 5000);
	}

	/**
	 * Stop the background queue worker
	 */
	stop() {
		if (this.pollingTimer) {
			clearInterval(this.pollingTimer);
			this.pollingTimer = null;
		}
	}

	/**
	 * Main polling loop
	 */
	private async poll() {
		if (this.isPolling) return;
		this.isPolling = true;

		try {
			// Calculate how many download jobs we can start
			const availableDownloadSlots = this.maxConcurrentDownloads - this.activeDownloads;
			
			// If we have available slots, we can fetch downloads.
			// Metadata tasks use the same or separate limit? 
			// We can limit metadata to e.g. 1 at a time to not overwhelm YouTube.
			const availableMetadataSlots = 1 - this.activeMetadata;

			// Fetch pending jobs that are due
			const jobs = await prisma.jobQueue.findMany({
				where: {
					status: 'PENDING',
					runAt: { lte: new Date() },
					id: { notIn: Array.from(this.activeJobs) }
				},
				orderBy: [
					{ priority: 'desc' },
					{ runAt: 'asc' }
				],
				take: 20 // Fetch a batch
			});

			for (const job of jobs) {
				// Concurrency limits logic
				if (job.type === 'download' && availableDownloadSlots <= 0) continue;
				if (job.type === 'metadata' && availableMetadataSlots <= 0) continue;
				// Other types like system/subscription don't have explicit strict limits here, 
				// but we can let them run concurrently up to some safe number or just unbounded.
				
				// Mark as RUNNING
				const updatedJob = await prisma.jobQueue.update({
					where: { id: job.id, status: 'PENDING' },
					data: { status: 'RUNNING', startedAt: new Date() }
				}).catch(() => null);

				if (!updatedJob) continue; // someone else grabbed it

				// Track active stats
				this.activeJobs.add(job.id);
				if (job.type === 'download') this.activeDownloads++;
				if (job.type === 'metadata') this.activeMetadata++;

				// Execute in background
				this.executeJob(updatedJob);

				if (job.type === 'download') break; // Re-evaluate slots on next poll
			}
		} catch (error) {
			console.error('[QueueService] Poll error:', error);
		} finally {
			this.isPolling = false;
		}
	}

	private async executeJob(job: JobQueue) {
		const handler = this.handlers.get(job.type);
		
		try {
			if (!handler) throw new Error(`No handler registered for job type: ${job.type}`);
			await handler(job);
			
			// Success
			await prisma.jobQueue.update({
				where: { id: job.id },
				data: { status: 'COMPLETED', completedAt: new Date() }
			});
		} catch (error: any) {
			console.error(`[QueueService] Job ${job.id} (${job.type}) failed:`, error);
			// Failure
			await prisma.jobQueue.update({
				where: { id: job.id },
				data: { status: 'FAILED', completedAt: new Date(), error: error?.message || 'Unknown error' }
			});
		} finally {
			// Cleanup tracking
			this.activeJobs.delete(job.id);
			if (job.type === 'download') this.activeDownloads--;
			if (job.type === 'metadata') this.activeMetadata--;
			
			// Trigger next poll immediately to pick up more tasks
			setImmediate(() => this.poll());
		}
	}

	/**
	 * Enqueue a new job
	 */
	async enqueue(type: string, payload?: any, options?: { runAt?: Date; priority?: number }) {
		const job = await prisma.jobQueue.create({
			data: {
				type,
				payload: payload || null,
				runAt: options?.runAt || new Date(),
				priority: options?.priority || 0,
				status: 'PENDING'
			}
		});
		
		// trigger a poll immediately if possible
		if (!this.isPolling) {
			setImmediate(() => this.poll());
		}
		
		return job;
	}

	/**
	 * Get queue statistics
	 */
	async getStats(): Promise<QueueStats> {
		const queuedMetadata = await prisma.jobQueue.count({
			where: { type: 'metadata', status: 'PENDING' }
		});
		const queuedDownloads = await prisma.jobQueue.count({
			where: { type: 'download', status: 'PENDING' }
		});

		return {
			metadata: queuedMetadata,
			downloads: queuedDownloads,
			active: this.activeDownloads + this.activeMetadata,
		};
	}

	/**
	 * Update concurrent download limit
	 */
	setMaxConcurrent(max: number): void {
		if (max < 1) max = 1;
		if (max > 10) max = 10;
		this.maxConcurrentDownloads = max;
		
		if (!this.isPolling) {
			setImmediate(() => this.poll());
		}
	}

	/**
	 * Get current max concurrent downloads
	 */
	getMaxConcurrent(): number {
		return this.maxConcurrentDownloads;
	}

	/**
	 * Clear all pending operations
	 */
	async clearPending(): Promise<void> {
		await prisma.jobQueue.deleteMany({
			where: { status: 'PENDING', type: { in: ['download', 'metadata'] } }
		});
	}
}

// Singleton instance
export const queueService = new QueueService(2);
