import { prisma } from '../db';
import { readdir, readFile, writeFile, unlink, stat } from 'fs/promises';
import { join, resolve, extname, basename, dirname, sep } from 'path';

/**
 * NFO metadata for the Jellyfin/Emby/Kodi "TV Shows" library model:
 * each YouTube channel folder is a series, each per-video folder an episode.
 * Episodes get season = upload year and a 1-based episode number per year, so
 * releases appear in chronological order without season folders on disk.
 */

/** Video extensions recognized inside per-video library folders. */
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mkv', 'flv', 'mov', 'avi', 'm4v']);

export function escapeXml(value: string): string {
	return value
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

export interface SeriesNfoInput {
	title: string;
	channelId?: string | null;
}

export function buildSeriesNfo(input: SeriesNfoInput): string {
	const lines = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '<tvshow>'];
	lines.push(`\t<title>${escapeXml(input.title)}</title>`);
	if (input.channelId) {
		lines.push(
			`\t<uniqueid type="youtube" default="true">${escapeXml(input.channelId)}</uniqueid>`,
		);
	}
	lines.push('</tvshow>', '');
	return lines.join('\n');
}

export interface EpisodeNfoInput {
	title: string;
	showTitle?: string | null;
	season: number;
	episode: number;
	aired?: Date | null;
	plot?: string | null;
	runtimeSeconds?: number | null;
	videoId?: string | null;
}

export function buildEpisodeNfo(input: EpisodeNfoInput): string {
	const lines = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '<episodedetails>'];
	lines.push(`\t<title>${escapeXml(input.title)}</title>`);
	if (input.showTitle) lines.push(`\t<showtitle>${escapeXml(input.showTitle)}</showtitle>`);
	lines.push(`\t<season>${input.season}</season>`);
	lines.push(`\t<episode>${input.episode}</episode>`);
	if (input.aired) {
		lines.push(`\t<aired>${input.aired.toISOString().slice(0, 10)}</aired>`);
	}
	if (input.plot) lines.push(`\t<plot>${escapeXml(input.plot)}</plot>`);
	if (input.runtimeSeconds && input.runtimeSeconds > 0) {
		lines.push(`\t<runtime>${Math.round(input.runtimeSeconds / 60)}</runtime>`);
	}
	if (input.videoId) {
		lines.push(`\t<uniqueid type="youtube" default="true">${escapeXml(input.videoId)}</uniqueid>`);
	}
	lines.push('</episodedetails>', '');
	return lines.join('\n');
}

class NfoService {
	/** Write only when the content actually changed — keeps library scans quiet. */
	private async writeIfChanged(path: string, content: string): Promise<void> {
		const existing = await readFile(path, 'utf-8').catch(() => null);
		if (existing === content) return;
		await writeFile(path, content, 'utf-8');
	}

	/**
	 * In a TV library a per-episode 2:3 poster.jpg would win over the landscape
	 * cover.jpg as the episode's primary image. Covers predate the TV-library
	 * integration, so drop legacy posters (only when a cover exists).
	 */
	private async removeLegacyEpisodePoster(videoDir: string): Promise<void> {
		const poster = join(videoDir, 'poster.jpg');
		const cover = join(videoDir, 'cover.jpg');
		try {
			await stat(cover);
			await unlink(poster);
		} catch {
			// no cover (keep the poster) or no poster (nothing to do)
		}
	}

	/**
	 * Recompute and rewrite all NFO files for one channel folder. Numbering is
	 * derived from the DB rows (upload/completion date) with an mtime fallback
	 * for files that no longer have a row, so it stays deterministic no matter
	 * in which order videos were added.
	 */
	async syncChannel(channelDir: string): Promise<{ episodes: number; channelUrl?: string }> {
		const resolved = resolve(channelDir);
		const channelEntries = await readdir(resolved, { withFileTypes: true }).catch(() => null);
		if (!channelEntries) return { episodes: 0 };

		const rows = await prisma.download.findMany({
			where: { storagePool: 'library', filepath: { startsWith: resolved + sep } },
		});
		const rowByDir = new Map<string, (typeof rows)[number]>();
		for (const row of rows) {
			if (!row.filepath) continue;
			const dir = resolve(dirname(row.filepath));
			const prev = rowByDir.get(dir);
			// Prefer a completed row when several point at the same folder.
			if (!prev || (prev.status !== 'COMPLETED' && row.status === 'COMPLETED')) {
				rowByDir.set(dir, row);
			}
		}

		interface Episode {
			dir: string;
			stem: string;
			sortDate: Date;
			row?: (typeof rows)[number];
		}
		const episodes: Episode[] = [];
		for (const entry of channelEntries) {
			if (!entry.isDirectory()) continue;
			const videoDir = join(resolved, entry.name);
			const files = await readdir(videoDir).catch(() => [] as string[]);
			const media = files.find(
				(f) => !f.startsWith('.') && VIDEO_EXTENSIONS.has(extname(f).toLowerCase().slice(1)),
			);
			if (!media) continue;
			const mediaPath = join(videoDir, media);
			const mtime = await stat(mediaPath)
				.then((s) => s.mtime)
				.catch(() => new Date());
			episodes.push({
				dir: videoDir,
				stem: basename(media, extname(media)),
				sortDate: (rowByDir.get(resolve(videoDir))?.uploadDate ??
					rowByDir.get(resolve(videoDir))?.completedAt ??
					mtime) as Date,
				row: rowByDir.get(resolve(videoDir)),
			});
		}

		// Chronological order; ties broken by folder name for stability.
		episodes.sort(
			(a, b) => a.sortDate.getTime() - b.sortDate.getTime() || a.dir.localeCompare(b.dir),
		);

		const byCompleted = [...rows].sort(
			(a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0),
		);
		const channelTitle = byCompleted.find((r) => r.uploader)?.uploader ?? basename(resolved);
		const channelUrl = byCompleted.find((r) => r.channelUrl)?.channelUrl ?? undefined;
		const channelId = channelUrl?.match(/\/channel\/(UC[\w-]+)/)?.[1] ?? undefined;

		let written = 0;
		const perYear = new Map<number, number>();
		for (const ep of episodes) {
			const year = ep.sortDate.getUTCFullYear();
			const episodeNumber = (perYear.get(year) ?? 0) + 1;
			perYear.set(year, episodeNumber);

			const nfo = buildEpisodeNfo({
				title: ep.row?.title ?? basename(ep.dir),
				showTitle: channelTitle,
				season: year,
				episode: episodeNumber,
				aired: ep.row?.uploadDate ?? null,
				plot: ep.row?.description ?? null,
				runtimeSeconds: ep.row?.duration ?? null,
				videoId: ep.row?.videoId ?? null,
			});
			await this.writeIfChanged(join(ep.dir, `${ep.stem}.nfo`), nfo);
			await this.removeLegacyEpisodePoster(ep.dir);
			written++;
		}

		await this.writeIfChanged(
			join(resolved, 'tvshow.nfo'),
			buildSeriesNfo({ title: channelTitle, channelId }),
		);
		return { episodes: written, channelUrl };
	}
}

export const nfoService = new NfoService();
