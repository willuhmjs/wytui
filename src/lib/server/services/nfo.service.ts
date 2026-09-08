import { prisma } from '../db';
import { readdir, readFile, writeFile, unlink, stat } from 'fs/promises';
import { join, resolve, extname, basename, dirname, sep } from 'path';

/**
 * NFO metadata for the Jellyfin "Movies" library model:
 * each YouTube channel folder is a BoxSet (collection), each per-video folder
 * a movie. Movies carry their YouTube upload date as the premiere date, so
 * release dates are first-class in the Movies UI instead of hidden in an
 * episode list. The channel folder's collection.xml both flags it as a BoxSet
 * (Jellyfin requires it for subfolder collections) and carries the channel's
 * title and YouTube channel id.
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

export interface CollectionNfoInput {
	title: string;
	channelId?: string | null;
}

export function buildCollectionXml(input: CollectionNfoInput): string {
	const lines = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '<collection>'];
	lines.push(`\t<title>${escapeXml(input.title)}</title>`);
	if (input.channelId) {
		lines.push(
			`\t<uniqueid type="youtube" default="true">${escapeXml(input.channelId)}</uniqueid>`,
		);
	}
	lines.push('</collection>', '');
	return lines.join('\n');
}

export interface MovieNfoInput {
	title: string;
	premiered?: Date | null;
	plot?: string | null;
	runtimeSeconds?: number | null;
	videoId?: string | null;
}

export function buildMovieNfo(input: MovieNfoInput): string {
	const lines = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '<movie>'];
	lines.push(`\t<title>${escapeXml(input.title)}</title>`);
	if (input.premiered) {
		lines.push(`\t<premiered>${input.premiered.toISOString().slice(0, 10)}</premiered>`);
	}
	if (input.plot) lines.push(`\t<plot>${escapeXml(input.plot)}</plot>`);
	if (input.runtimeSeconds && input.runtimeSeconds > 0) {
		lines.push(`\t<runtime>${Math.round(input.runtimeSeconds / 60)}</runtime>`);
	}
	if (input.videoId) {
		lines.push(`\t<uniqueid type="youtube" default="true">${escapeXml(input.videoId)}</uniqueid>`);
	}
	lines.push('</movie>', '');
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
	 * A legacy 2:3 poster.jpg would win over the landscape video thumbnail as
	 * the movie's primary image. Posters predate the movies-library model, so
	 * drop them (only when a cover exists to keep).
	 */
	private async removeLegacyPoster(videoDir: string): Promise<void> {
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
	 * Recompute and rewrite all NFO files for one channel folder: a movie NFO
	 * per per-video folder and the channel's collection.xml. Content comes from
	 * the DB rows (upload date, description, duration) keyed by the video
	 * folder, so re-running it stays deterministic no matter when videos were
	 * added.
	 */
	async syncChannel(channelDir: string): Promise<{ movies: number; channelUrl?: string }> {
		const resolved = resolve(channelDir);
		const channelEntries = await readdir(resolved, { withFileTypes: true }).catch(() => null);
		if (!channelEntries) return { movies: 0 };

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

		let written = 0;
		for (const entry of channelEntries) {
			if (!entry.isDirectory()) continue;
			const videoDir = join(resolved, entry.name);
			const files = await readdir(videoDir).catch(() => [] as string[]);
			const media = files.find(
				(f) => !f.startsWith('.') && VIDEO_EXTENSIONS.has(extname(f).toLowerCase().slice(1)),
			);
			if (!media) continue;
			const row = rowByDir.get(resolve(videoDir));

			const nfo = buildMovieNfo({
				title: row?.title ?? basename(videoDir),
				premiered: row?.uploadDate ?? null,
				plot: row?.description ?? null,
				runtimeSeconds: row?.duration ?? null,
				videoId: row?.videoId ?? null,
			});
			await this.writeIfChanged(join(videoDir, `${basename(media, extname(media))}.nfo`), nfo);
			await this.removeLegacyPoster(videoDir);
			written++;
		}

		const byCompleted = [...rows].sort(
			(a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0),
		);
		const channelTitle = byCompleted.find((r) => r.uploader)?.uploader ?? basename(resolved);
		const channelUrl = byCompleted.find((r) => r.channelUrl)?.channelUrl ?? undefined;
		const channelId = channelUrl?.match(/\/channel\/(UC[\w-]+)/)?.[1] ?? undefined;

		await this.writeIfChanged(
			join(resolved, 'collection.xml'),
			buildCollectionXml({ title: channelTitle, channelId }),
		);
		// Legacy TV-model series file: drop it so the movies library stays clean.
		await unlink(join(resolved, 'tvshow.nfo')).catch(() => {
			/* no legacy file (nothing to do) */
		});
		return { movies: written, channelUrl };
	}
}

export const nfoService = new NfoService();
