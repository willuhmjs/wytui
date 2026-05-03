import pLimit from 'p-limit';
import type { QueueStats } from '$lib/types';

export class QueueService {
	private metadataLimit: ReturnType<typeof pLimit>;
	private downloadLimit: ReturnType<typeof pLimit>;
	private maxConcurrentDownloads: number;

	// Track active operations
	private activeMetadata = 0;
	private activeDownloads = 0;
	private queuedMetadata = 0;
	private queuedDownloads = 0;

	constructor(maxConcurrent = 3) {
		this.maxConcurrentDownloads = maxConcurrent;
		this.metadataLimit = pLimit(1); // Sequential metadata fetching
		this.downloadLimit = pLimit(maxConcurrent); // Parallel downloads
	}

	/**
	 * Enqueue metadata fetch operation (sequential)
	 */
	async enqueueMetadata<T>(fn: () => Promise<T>): Promise<T> {
		this.queuedMetadata++;
		return this.metadataLimit(async () => {
			this.queuedMetadata--;
			this.activeMetadata++;
			try {
				return await fn();
			} finally {
				this.activeMetadata--;
			}
		});
	}

	/**
	 * Enqueue download operation (parallel with limit)
	 */
	async enqueueDownload<T>(fn: () => Promise<T>): Promise<T> {
		this.queuedDownloads++;
		return this.downloadLimit(async () => {
			this.queuedDownloads--;
			this.activeDownloads++;
			try {
				return await fn();
			} finally {
				this.activeDownloads--;
			}
		});
	}

	/**
	 * Get queue statistics
	 */
	getStats(): QueueStats {
		return {
			metadata: this.queuedMetadata,
			downloads: this.queuedDownloads,
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
		this.downloadLimit = pLimit(max);
	}

	/**
	 * Get current max concurrent downloads
	 */
	getMaxConcurrent(): number {
		return this.maxConcurrentDownloads;
	}

	/**
	 * Clear all pending operations (cannot abort running ones)
	 */
	clearPending(): void {
		this.downloadLimit.clearQueue();
		this.metadataLimit.clearQueue();
		this.queuedMetadata = 0;
		this.queuedDownloads = 0;
	}
}

// Singleton instance
export const queueService = new QueueService(3);
