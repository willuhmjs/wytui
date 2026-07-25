import { error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { createReadStream, existsSync } from 'fs';
import { stat } from 'fs/promises';
import { resolve, normalize, sep } from 'path';
import type { Readable } from 'stream';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

function nodeStreamToWeb(nodeStream: Readable): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			nodeStream.on('data', (chunk: Buffer) => {
				try {
					controller.enqueue(new Uint8Array(chunk));
				} catch {
					nodeStream.destroy();
				}
			});
			nodeStream.on('end', () => {
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			});
			nodeStream.on('error', (err) => {
				try {
					controller.error(err);
				} catch {
					nodeStream.destroy();
				}
			});
		},
		cancel() {
			nodeStream.destroy();
		},
	});
}

function sanitizeFilename(filename: string): string {
	return filename
		.replace(/[^\w\s.-]/g, '_')
		.replace(/\.\./g, '_')
		.replace(/["\n\r]/g, '')
		.trim();
}

export const GET = apiRoute(
	'/api/files/[id]',
	'GET',
	{
		summary: 'Download a completed file',
		tags: ['Downloads'],
		auth: true,
		params: { id: { type: 'string', description: 'Download ID' } },
		responses: {
			200: { description: 'Binary file stream' },
			404: { description: 'File not found' },
		},
	},
	async ({ params, locals, request }) => {
		try {
			console.log('[File Download] Request for:', params.id);
			console.log('[File Download] User session:', locals.session?.user?.id || 'none');

			if (!locals.session?.user?.id) {
				console.log('[File Download] 401: No authentication');
				throw error(401, 'Authentication required');
			}

			const download = await prisma.download.findUnique({
				where: { id: params.id },
			});

			console.log('[File Download] Download record:', {
				found: !!download,
				filepath: download?.filepath,
				userId: download?.userId,
			});

			if (!download || !download.filepath) {
				console.log('[File Download] 404: No download or filepath');
				throw error(404, 'File not found');
			}

			if (download.userId !== locals.session.user.id && !locals.session.user.isAdmin) {
				console.log('[File Download] 403: User ID mismatch', {
					sessionUserId: locals.session.user.id,
					downloadUserId: download.userId,
					isAdmin: locals.session.user.isAdmin,
				});
				throw error(403, 'Access denied');
			}

			const settings = await prisma.settings.findUnique({
				where: { id: 'singleton' },
			});
			const allowedDirs = [
				settings?.downloadPath || '/downloads',
				...(settings?.libraryPath ? [settings.libraryPath] : []),
				...(settings?.musicLibraryPath ? [settings.musicLibraryPath] : []),
			];
			const normalizedPath = normalize(resolve(download.filepath));
			const allowed = allowedDirs.some((dir) => {
				const base = normalize(resolve(dir));
				// Require an exact match or a true subpath — `startsWith(base)` alone
				// would let a sibling like `/downloads-evil` pass for base `/downloads`.
				return normalizedPath === base || normalizedPath.startsWith(base + sep);
			});
			if (!allowed) {
				throw error(403, 'Access denied: file path outside allowed directory');
			}

			if (!existsSync(download.filepath)) {
				throw error(404, 'File no longer exists on disk');
			}

			const stats = await stat(download.filepath);
			const filename = sanitizeFilename(download.filename || 'download');
			const mimeType = getMimeType(download.filepath);
			const fileSize = stats.size;

			const userAgent = request.headers.get('user-agent') || '';
			const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
				userAgent,
			);
			const disposition = isMobile ? 'attachment' : 'inline';
			const rangeHeader = request.headers.get('range');

			if (rangeHeader) {
				const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
				if (match) {
					const start = parseInt(match[1], 10);
					const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

					if (start >= fileSize || end >= fileSize || start > end) {
						return new Response(null, {
							status: 416,
							headers: { 'Content-Range': `bytes */${fileSize}` },
						});
					}

					const stream = nodeStreamToWeb(createReadStream(download.filepath, { start, end }));
					return new Response(stream, {
						status: 206,
						headers: {
							'Content-Type': mimeType,
							'Content-Range': `bytes ${start}-${end}/${fileSize}`,
							'Content-Length': (end - start + 1).toString(),
							'Content-Disposition': `${disposition}; filename="${filename}"`,
							'Accept-Ranges': 'bytes',
							'X-Content-Type-Options': 'nosniff',
							'Cache-Control': 'private, no-store, max-age=0',
						},
					});
				}
			}

			const stream = nodeStreamToWeb(createReadStream(download.filepath));
			return new Response(stream, {
				headers: {
					'Content-Type': mimeType,
					'Content-Length': fileSize.toString(),
					'Content-Disposition': `${disposition}; filename="${filename}"`,
					'Accept-Ranges': 'bytes',
					'X-Content-Type-Options': 'nosniff',
					'Cache-Control': 'private, no-store, max-age=0',
				},
			});
		} catch (e: any) {
			console.error('Failed to download file:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;

function getMimeType(filepath: string): string {
	const ext = filepath.split('.').pop()?.toLowerCase();
	const mimeTypes: Record<string, string> = {
		mp4: 'video/mp4',
		webm: 'video/webm',
		mkv: 'video/x-matroska',
		mp3: 'audio/mpeg',
		m4a: 'audio/mp4',
		aac: 'audio/aac',
		flac: 'audio/flac',
		opus: 'audio/opus',
	};
	return mimeTypes[ext || ''] || 'application/octet-stream';
}
