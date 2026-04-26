import { error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { createReadStream, existsSync } from 'fs';
import { stat } from 'fs/promises';
import { resolve, normalize } from 'path';
import type { RequestHandler } from './$types';

/**
 * Sanitize filename for Content-Disposition header
 */
function sanitizeFilename(filename: string): string {
	// Remove or replace dangerous characters
	return filename
		.replace(/[^\w\s.-]/g, '_')  // Replace special chars
		.replace(/\.\./g, '_')        // Remove path traversal
		.replace(/["\n\r]/g, '')      // Remove quotes and newlines
		.trim();
}

/**
 * Validate file path to prevent directory traversal
 */
async function validateFilePath(filepath: string, allowedDir: string): Promise<void> {
	// Normalize and resolve paths
	const normalizedPath = normalize(resolve(filepath));
	const normalizedAllowedDir = normalize(resolve(allowedDir));

	// Check if file is within allowed directory
	if (!normalizedPath.startsWith(normalizedAllowedDir)) {
		throw new Error('Access denied: file path outside allowed directory');
	}
}

/**
 * GET /api/files/[id]
 * Download completed file
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	try {
		console.log('[File Download] Request for:', params.id);
		console.log('[File Download] User session:', locals.session?.user?.id || 'none');

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

		// Check ownership if user is authenticated
		if (locals.session?.user?.id && download.userId !== locals.session.user.id) {
			console.log('[File Download] 403: User ID mismatch', {
				sessionUserId: locals.session.user.id,
				downloadUserId: download.userId,
			});
			throw error(403, 'Access denied');
		}

		// Validate file path to prevent directory traversal
		const settings = await prisma.settings.findUnique({
			where: { id: 'singleton' },
		});
		const allowedDir = settings?.downloadPath || '/downloads';
		await validateFilePath(download.filepath, allowedDir);

		if (!existsSync(download.filepath)) {
			throw error(404, 'File no longer exists on disk');
		}

		const stats = await stat(download.filepath);
		const filename = sanitizeFilename(download.filename || 'download');
		const mimeType = getMimeType(download.filepath);

		// Create readable stream
		const stream = createReadStream(download.filepath);

		return new Response(stream as any, {
			headers: {
				'Content-Type': mimeType,
				'Content-Length': stats.size.toString(),
				'Content-Disposition': `attachment; filename="${filename}"`,
			},
		});
	} catch (e: any) {
		console.error('Failed to download file:', e);
		if (e.status) throw e;
		throw error(500, e.message || 'Failed to download file');
	}
};

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
