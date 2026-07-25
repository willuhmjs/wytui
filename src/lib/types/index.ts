import type {
	Download,
	DownloadProfile,
	DownloadStatus,
	Subscription,
	Monitor,
	Settings,
	Archive,
} from '@prisma/client';

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
	channelUrl?: string;
	uploadDate?: Date;
	format?: string;
	filesize?: bigint;
	artist?: string;
	track?: string;
	album?: string;
	releaseYear?: number;
	videoType?: string;
	description?: string;
	category?: string;
	tags?: string[];
	videoId?: string;
	dislikeCount?: number;
	height?: number;
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
