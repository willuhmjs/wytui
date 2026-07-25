import { prisma } from '$lib/server/db';
import { promises as fs } from 'fs';
import path from 'path';
import { ytdlpService } from './ytdlp.service';
import { DownloadStatus } from '@prisma/client';

const VIDEO_AUDIO_EXTENSIONS = new Set([
	'.mp4',
	'.mkv',
	'.webm',
	'.avi',
	'.mov',
	'.flv',
	'.m4a',
	'.mp3',
	'.ogg',
	'.opus',
	'.flac',
	'.wav',
	'.aac',
]);

const YOUTUBE_ID_PATTERN = /[a-zA-Z0-9_-]{11}/;

interface ScannedFile {
	filepath: string;
	filename: string;
	sizeBytes: string;
	videoId: string | null;
}

class ImportService {
	/**
	 * Recursively scan a directory for video/audio files
	 */
	async scanDirectory(dirPath: string): Promise<ScannedFile[]> {
		const results: ScannedFile[] = [];
		await this.walkDirectory(dirPath, results);
		return results;
	}

	private async walkDirectory(dirPath: string, results: ScannedFile[]): Promise<void> {
		const entries = await fs.readdir(dirPath, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(dirPath, entry.name);

			if (entry.isDirectory()) {
				await this.walkDirectory(fullPath, results);
			} else if (entry.isFile()) {
				const ext = path.extname(entry.name).toLowerCase();
				if (!VIDEO_AUDIO_EXTENSIONS.has(ext)) continue;

				const stat = await fs.stat(fullPath);
				const nameWithoutExt = path.basename(entry.name, ext);
				const videoId = this.extractVideoId(nameWithoutExt);

				results.push({
					filepath: fullPath,
					filename: entry.name,
					sizeBytes: stat.size.toString(),
					videoId,
				});
			}
		}
	}

	/**
	 * Try to extract a YouTube video ID from a filename.
	 * Looks for an 11-character alphanumeric/dash/underscore sequence.
	 */
	private extractVideoId(filename: string): string | null {
		const match = filename.match(YOUTUBE_ID_PATTERN);
		return match ? match[0] : null;
	}

	/**
	 * Import files into the database as completed Download records
	 */
	async importFiles(
		files: { filepath: string; videoId: string | null }[],
		userId: string,
		profileId: string,
	): Promise<{ imported: number; errors: string[] }> {
		let imported = 0;
		const errors: string[] = [];

		for (const file of files) {
			try {
				const stat = await fs.stat(file.filepath);
				const filename = path.basename(file.filepath);
				const nameWithoutExt = path.basename(filename, path.extname(filename));

				let title = nameWithoutExt;
				let uploader: string | undefined;
				let duration: number | undefined;
				let thumbnail: string | undefined;
				let videoType: string | undefined;
				let description: string | undefined;
				let category: string | undefined;
				let tags: string[] | undefined;
				let videoId = file.videoId ?? undefined;
				let url: string;

				if (file.videoId) {
					url = `https://www.youtube.com/watch?v=${file.videoId}`;
					try {
						const metadata = await ytdlpService.fetchMetadata(url);
						title = metadata.title || title;
						uploader = metadata.uploader;
						duration = metadata.duration;
						thumbnail = metadata.thumbnail;
						videoType = metadata.videoType;
						description = metadata.description;
						category = metadata.category;
						tags = metadata.tags;
						videoId = metadata.videoId || videoId;
					} catch {
						// Metadata fetch failed — use filename as title
					}
				} else {
					url = 'file://' + file.filepath;
				}

				await prisma.download.create({
					data: {
						url,
						title,
						filename,
						filepath: path.resolve(file.filepath),
						filesize: BigInt(stat.size),
						status: DownloadStatus.COMPLETED,
						storagePool: 'library',
						userId,
						profileId,
						completedAt: new Date(),
						uploader,
						duration,
						thumbnail,
						videoType,
						description,
						category,
						tags: tags ?? [],
						videoId: videoId ?? null,
						progress: 100,
					},
				});

				imported++;
			} catch (e: any) {
				errors.push(`${file.filepath}: ${e.message || String(e)}`);
			}
		}

		return { imported, errors };
	}
}

export const importService = new ImportService();
