import { prisma } from '../db';
import type { QueueStats } from '$lib/types';
import type { JobQueue } from '@prisma/client';

export type JobHandler = (job: JobQueue) => Promise<void>;

/**
 * Read a positive integer env var, clamped to the same 1-20 range the
 * settings validation enforces. Falls back when unset or malformed.
 */
function envInt(name: string, fallback: number): number {
	const raw = parseInt(process.env[name] ?? '', 10);
	if (Number.isFinite(raw) && raw >= 1) return Math.min(raw, 20);
	return fallback;
}

export class QueueService {
	/**
	 * Per-type concurrency limits, overridable via env vars
	 * (QUEUE_MAX_DOWNLOADS, QUEUE_MAX_METADATA, QUEUE_MAX_SUBSCRIPTIONS,
	 * QUEUE_MAX_SYSTEM, QUEUE_MAX_UNLISTED). The download limit is also
	 * controllable from app settings; an explicitly set QUEUE_MAX_DOWNLOADS
	 * takes precedence over the stored setting at startup. Types without an
	 * entry get QUEUE_MAX_UNLISTED so a new job type can't silently run
	 * unbounded.
	 */
	private maxConcurrentByType: Record<string, number> = {
		download: envInt('QUEUE_MAX_DOWNLOADS', 2),
		metadata: envInt('QUEUE_MAX_METADATA', 1),
		subscription: envInt('QUEUE_MAX_SUBSCRIPTIONS', 3),
		system: envInt('QUEUE_MAX_SYSTEM', 2),
	};
	private static readonly DEFAULT_TYPE_LIMIT = envInt('QUEUE_MAX_UNLISTED', 5);

	private handlers = new Map<string, JobHandler>();
	private pollingTimer: NodeJS.Timeout | null = null;
	// Boot enqueues (system + subscription scheduling) fire an immediate poll
	// via setImmediate; jobs must not execute before start() — handlers are
	// still being registered and leftover jobs from a previous run would fail
	// against a missing handler.
	private started = false;

	// Active state tracking
	private activeJobs = new Set<string>();
	private activeByType = new Map<string, number>();
	private isPolling = false;

	constructor(maxConcurrent?: number) {
		if (maxConcurrent !== undefined) {
			this.maxConcurrentByType.download = maxConcurrent;
		}
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

		this.started = true;

		// Reset any stale RUNNING jobs back to PENDING from before a server restart
		await prisma.jobQueue.updateMany({
			where: { status: 'RUNNING' },
			data: { status: 'PENDING', startedAt: null },
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
		this.started = false;
	}

	/**
	 * Main polling loop
	 */
	private async poll() {
		if (this.isPolling || !this.started) return;
		this.isPolling = true;

		try {
			// Fetch pending jobs that are due
			const jobs = await prisma.jobQueue.findMany({
				where: {
					status: 'PENDING',
					runAt: { lte: new Date() },
					id: { notIn: Array.from(this.activeJobs) },
				},
				orderBy: [{ priority: 'desc' }, { runAt: 'asc' }],
				take: 20, // Fetch a batch
			});

			for (const job of jobs) {
				// Concurrency limits logic: every type has a cap so one poll batch
				// can't launch an unbounded number of yt-dlp-hitting jobs at once.
				const limit = this.maxConcurrentByType[job.type] ?? QueueService.DEFAULT_TYPE_LIMIT;
				const active = this.activeByType.get(job.type) ?? 0;
				if (active >= limit) continue;

				// Mark as RUNNING
				const updatedJob = await prisma.jobQueue
					.update({
						where: { id: job.id, status: 'PENDING' },
						data: { status: 'RUNNING', startedAt: new Date() },
					})
					.catch(() => null);

				if (!updatedJob) continue; // someone else grabbed it

				// Track active stats
				this.activeJobs.add(job.id);
				this.activeByType.set(job.type, active + 1);

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
			// A job claimed before its handler registered (boot-ordering race)
			// must not fail terminally — that permanently kills self-rescheduling
			// chains. Release it for a later poll instead.
			if (!handler) {
				console.warn(`[QueueService] No handler for ${job.type} yet — requeueing job ${job.id}`);
				await prisma.jobQueue
					.updateMany({
						where: { id: job.id },
						data: { status: 'PENDING', startedAt: null, runAt: new Date(Date.now() + 5000) },
					})
					.catch(() => {});
				return;
			}
			await handler(job);

			// Success. updateMany, not update: self-rescheduling handlers (e.g.
			// subscription jobs) may delete this row before we get here, and a
			// P2025 from a missing row must not kill the worker process.
			await prisma.jobQueue.updateMany({
				where: { id: job.id },
				data: { status: 'COMPLETED', completedAt: new Date() },
			});
		} catch (error: any) {
			console.error(`[QueueService] Job ${job.id} (${job.type}) failed:`, error);
			// Failure. executeJob runs detached, so anything thrown here becomes
			// an unhandled rejection and terminates Node — never let bookkeeping
			// (e.g. the row vanishing mid-run) escape.
			try {
				await prisma.jobQueue.updateMany({
					where: { id: job.id },
					data: {
						status: 'FAILED',
						completedAt: new Date(),
						error: error?.message || 'Unknown error',
					},
				});
			} catch (recordError) {
				console.error(`[QueueService] Failed to record failure for job ${job.id}:`, recordError);
			}
		} finally {
			// Cleanup tracking
			this.activeJobs.delete(job.id);
			const active = this.activeByType.get(job.type) ?? 0;
			if (active <= 1) this.activeByType.delete(job.type);
			else this.activeByType.set(job.type, active - 1);

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
				status: 'PENDING',
			},
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
			where: { type: 'metadata', status: 'PENDING' },
		});
		const queuedDownloads = await prisma.jobQueue.count({
			where: { type: 'download', status: 'PENDING' },
		});

		return {
			metadata: queuedMetadata,
			downloads: queuedDownloads,
			active: Array.from(this.activeByType.values()).reduce((sum, n) => sum + n, 0),
		};
	}

	/**
	 * Update concurrent download limit
	 */
	setMaxConcurrent(max: number): void {
		// Bounds match the settings validation (1-20).
		if (max < 1) max = 1;
		if (max > 20) max = 20;
		this.maxConcurrentByType.download = max;

		if (!this.isPolling) {
			setImmediate(() => this.poll());
		}
	}

	/**
	 * Get current max concurrent downloads
	 */
	getMaxConcurrent(): number {
		return this.maxConcurrentByType.download;
	}

	/**
	 * Clear all pending operations
	 */
	async clearPending(): Promise<void> {
		await prisma.jobQueue.deleteMany({
			where: { status: 'PENDING', type: { in: ['download', 'metadata'] } },
		});
	}
}

// Singleton instance
export const queueService = new QueueService();
