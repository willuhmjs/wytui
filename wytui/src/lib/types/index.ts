import type { Download, DownloadProfile, DownloadStatus, Subscription, Monitor, Settings, Archive } from '@prisma/client';

export type { Download, DownloadProfile, DownloadStatus, Subscription, Monitor, Settings, Archive };

export interface ProgressUpdate {
	id: string;
	progress: number;
	speed?: string;
	eta?: string;
	downloadedBytes?: bigint;
	totalBytes?: bigint;
}

export interface DownloadMetadata {
	title?: string;
	thumbnail?: string;
	duration?: number;
	uploader?: string;
	uploadDate?: Date;
	format?: string;
	filesize?: bigint;
}

export interface SSEEvent {
	event: string;
	data: any;
}

export interface QueueStats {
	metadata: number;
	downloads: number;
	active: number;
}
