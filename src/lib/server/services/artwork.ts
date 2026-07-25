import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

/** Build ffmpeg args that composite a 16:9 image onto a blurred-fill 2:3 poster. */
export function buildPosterFilterArgs(srcPath: string, outPath: string): string[] {
	const filter =
		'[0:v]scale=1000:1500:force_original_aspect_ratio=increase,crop=1000:1500,boxblur=20:5[bg];' +
		'[0:v]scale=1000:-1[fg];' +
		'[bg][fg]overlay=(W-w)/2:(H-h)/2';
	return ['-y', '-i', srcPath, '-filter_complex', filter, '-frames:v', '1', '-q:v', '2', outPath];
}

/** Build ffmpeg args that convert any source image to a plain JPEG (landscape 16:9 as-is). */
export function buildConvertArgs(srcPath: string, outPath: string): string[] {
	return ['-y', '-i', srcPath, '-frames:v', '1', '-q:v', '2', outPath];
}

function runFfmpeg(args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const p = spawn(FFMPEG, args, { stdio: 'ignore' });
		p.on('error', reject);
		p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
	});
}

/**
 * Fetch the source thumbnail and write Jellyfin artwork into videoDir:
 *   - cover.jpg    (backward-compat primary; landscape)
 *   - backdrop.jpg + landscape.jpg (16:9 fanart/thumb)
 *   - poster.jpg   (2:3 blurred-fill) when generatePoster is true
 * Best-effort: any failure leaves whatever succeeded and does not throw the
 * pipeline. Falls back to writing raw bytes as cover.jpg if ffmpeg fails.
 */
export async function writeJellyfinArtwork(opts: {
	sourceUrl: string;
	videoDir: string;
	generatePoster: boolean;
}): Promise<void> {
	const { sourceUrl, videoDir, generatePoster } = opts;

	let raw: Buffer;
	try {
		const res = await fetch(sourceUrl);
		if (!res.ok) return;
		raw = Buffer.from(await res.arrayBuffer());
	} catch {
		return;
	}

	// Write the raw source to a temp file for ffmpeg input.
	const tmpSrc = join(tmpdir(), `wytui-thumb-${Date.now()}-${Math.round(Math.random() * 1e6)}`);
	try {
		await writeFile(tmpSrc, raw);

		const cover = join(videoDir, 'cover.jpg');
		const backdrop = join(videoDir, 'backdrop.jpg');
		const landscape = join(videoDir, 'landscape.jpg');
		const poster = join(videoDir, 'poster.jpg');

		// Landscape JPEG (cover + backdrop + landscape share the same 16:9 render).
		// Convert once to cover.jpg, then copy to backdrop.jpg and landscape.jpg.
		let coverOk = false;
		try {
			await runFfmpeg(buildConvertArgs(tmpSrc, cover));
			coverOk = true;
		} catch {
			// ffmpeg unavailable/failed — fall back to raw bytes as cover.jpg only.
			try {
				await writeFile(cover, raw);
			} catch {
				/* ignore */
			}
		}
		if (coverOk) {
			// Copy the converted file to the other two 16:9 names (no re-conversion).
			// A copy failure must NOT clobber the good cover.jpg, so each copy is
			// isolated and best-effort — never falls back to raw bytes.
			const { copyFile } = await import('fs/promises');
			try {
				await copyFile(cover, backdrop);
			} catch {
				/* best-effort */
			}
			try {
				await copyFile(cover, landscape);
			} catch {
				/* best-effort */
			}
		}

		if (generatePoster) {
			try {
				await runFfmpeg(buildPosterFilterArgs(tmpSrc, poster));
			} catch {
				/* poster is best-effort */
			}
		}
	} finally {
		try {
			await unlink(tmpSrc);
		} catch {
			/* ignore */
		}
	}
}
