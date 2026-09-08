import { prisma } from '../db';
import { parseSubtitleFile } from '../utils/subtitle-parser';
import { normalizeYouTubeSubtitles } from '../utils/vtt-normalize';
import { readdir, readFile, writeFile } from 'fs/promises';
import { join, dirname, basename, extname } from 'path';

class SubtitleService {
	/**
	 * Rewrite YouTube word-timed auto-caption files next to the video into
	 * conventional stable cues (in place). Returns the number of files
	 * rewritten. Files that are not word-timed captions are left untouched, so
	 * this is safe to run for any download.
	 */
	async normalizeSubtitles(downloadId: string): Promise<number> {
		const download = await prisma.download.findUnique({ where: { id: downloadId } });
		if (!download?.filepath) return 0;

		const dir = dirname(download.filepath);
		const videoBase = basename(download.filepath, extname(download.filepath));

		let files: string[];
		try {
			files = await readdir(dir);
		} catch {
			return 0;
		}

		const subFiles = files.filter((f) => {
			const ext = extname(f).toLowerCase();
			return (ext === '.vtt' || ext === '.srt') && f.startsWith(videoBase);
		});

		let normalized = 0;
		for (const f of subFiles) {
			const filePath = join(dir, f);
			let content: string;
			try {
				content = await readFile(filePath, 'utf-8');
			} catch {
				continue;
			}
			try {
				const format = f.toLowerCase().endsWith('.srt') ? 'srt' : 'vtt';
				const out = normalizeYouTubeSubtitles(content, format);
				if (out && out !== content) {
					await writeFile(filePath, out);
					normalized++;
				}
			} catch (error) {
				console.warn(`[SubtitleService] Failed to normalize ${f}: ${error}`);
			}
		}
		return normalized;
	}

	/**
	 * After a download completes, find subtitle files next to the video and index them.
	 */
	async indexSubtitles(downloadId: string): Promise<number> {
		const download = await prisma.download.findUnique({
			where: { id: downloadId },
		});

		if (!download?.filepath) return 0;

		const dir = dirname(download.filepath);
		const videoBase = basename(download.filepath, extname(download.filepath));

		let files: string[];
		try {
			files = await readdir(dir);
		} catch {
			return 0;
		}

		// Find subtitle files that match the video filename
		const subtitleFiles = files.filter((f) => {
			const ext = extname(f).toLowerCase();
			if (ext !== '.vtt' && ext !== '.srt') return false;
			// Subtitle files from yt-dlp follow the pattern: videoname.lang.vtt or videoname.vtt
			return f.startsWith(videoBase);
		});

		if (subtitleFiles.length === 0) return 0;

		// Delete any existing subtitle lines for this download (re-index)
		await prisma.subtitleLine.deleteMany({
			where: { downloadId },
		});

		let totalIndexed = 0;

		for (const subFile of subtitleFiles) {
			const filePath = join(dir, subFile);

			let content: string;
			try {
				content = await readFile(filePath, 'utf-8');
			} catch {
				continue;
			}

			// Extract language from filename (e.g., video.en.vtt -> "en")
			const lang = this.extractLang(subFile, videoBase);

			const entries = parseSubtitleFile(content, subFile);
			if (entries.length === 0) continue;

			// Deduplicate consecutive lines with identical text (common in auto-generated subs)
			const deduped = this.deduplicateEntries(entries);

			// Batch insert
			await prisma.subtitleLine.createMany({
				data: deduped.map((entry) => ({
					downloadId,
					startTime: entry.startTime,
					endTime: entry.endTime,
					text: entry.text,
					lang,
				})),
			});

			totalIndexed += deduped.length;
		}

		return totalIndexed;
	}

	/**
	 * Extract language code from subtitle filename.
	 * e.g., "My Video.en.vtt" with videoBase "My Video" -> "en"
	 */
	private extractLang(subFilename: string, videoBase: string): string {
		// Remove the subtitle extension
		const withoutExt = subFilename.replace(/\.(vtt|srt)$/i, '');
		// Remove the video base name
		const suffix = withoutExt.slice(videoBase.length);
		// The suffix should be like ".en" or ".en-US"
		const langMatch = suffix.match(/^\.(.+)$/);
		if (langMatch) {
			return langMatch[1];
		}
		return 'en';
	}

	/**
	 * Deduplicate consecutive subtitle entries with identical text.
	 * Auto-generated subtitles often have the same line repeated across multiple time segments.
	 */
	private deduplicateEntries(entries: { startTime: number; endTime: number; text: string }[]) {
		if (entries.length === 0) return entries;

		const result = [entries[0]];
		for (let i = 1; i < entries.length; i++) {
			const prev = result[result.length - 1];
			if (entries[i].text === prev.text) {
				// Extend the previous entry's end time
				prev.endTime = entries[i].endTime;
			} else {
				result.push({ ...entries[i] });
			}
		}
		return result;
	}

	/**
	 * Search subtitle lines by text.
	 * Returns matching lines with their download info.
	 */
	async search(query: string, userId: string, options: { limit?: number; offset?: number } = {}) {
		const { limit = 50, offset = 0 } = options;

		const subtitleMatches = await prisma.subtitleLine.findMany({
			where: {
				text: { contains: query, mode: 'insensitive' },
				download: {
					userId,
					status: 'COMPLETED',
				},
			},
			include: {
				download: {
					select: {
						id: true,
						title: true,
						thumbnail: true,
						uploader: true,
						duration: true,
					},
				},
			},
			take: limit,
			skip: offset,
			orderBy: { startTime: 'asc' },
		});

		const total = await prisma.subtitleLine.count({
			where: {
				text: { contains: query, mode: 'insensitive' },
				download: {
					userId,
					status: 'COMPLETED',
				},
			},
		});

		return {
			results: subtitleMatches.map((m) => ({
				id: m.id,
				downloadId: m.downloadId,
				startTime: m.startTime,
				endTime: m.endTime,
				text: m.text,
				lang: m.lang,
				download: m.download,
			})),
			total,
		};
	}
}

export const subtitleService = new SubtitleService();
