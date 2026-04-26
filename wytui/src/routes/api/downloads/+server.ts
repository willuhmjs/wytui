import { json, error } from '@sveltejs/kit';
import { downloadService } from '$lib/server/services/download.service';
import { prisma } from '$lib/server/db';
import type { RequestHandler } from './$types';

/**
 * POST /api/downloads
 * Create a new download
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const { url, profileId } = await request.json();

		if (!url || !profileId) {
			throw error(400, 'Missing required fields: url, profileId');
		}

		// Validate URL format
		try {
			const urlObj = new URL(url);
			if (!['http:', 'https:'].includes(urlObj.protocol)) {
				throw error(400, 'Only HTTP(S) URLs are allowed');
			}
		} catch {
			throw error(400, 'Invalid URL format');
		}

		// Verify profile exists
		const profile = await prisma.downloadProfile.findUnique({
			where: { id: profileId },
		});
		if (!profile) {
			throw error(400, 'Invalid profile ID');
		}

		const userId = locals.session?.user?.id;
		const download = await downloadService.createDownload(url, profileId, userId);

		return json(download, { status: 201 });
	} catch (e: any) {
		console.error('Failed to create download:', e);
		if (e.status) throw e;
		throw error(500, e.message || 'Failed to create download');
	}
};

/**
 * GET /api/downloads
 * List downloads
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	try {
		// Require authentication
		if (!locals.session?.user?.id) {
			throw error(401, 'Authentication required');
		}

		const userId = locals.session.user.id;
		const statusParam = url.searchParams.get('status');

		// Validate and limit pagination parameters
		let limit = parseInt(url.searchParams.get('limit') || '50');
		let offset = parseInt(url.searchParams.get('offset') || '0');

		if (isNaN(limit) || limit < 1) limit = 50;
		if (limit > 100) limit = 100; // Max 100 items per request

		if (isNaN(offset) || offset < 0) offset = 0;

		// Build arguments array, only include status if provided
		const args: Parameters<typeof downloadService.listDownloads> = [
			userId,
			statusParam as any,
			limit,
			offset
		];

		const downloads = await downloadService.listDownloads(...args);

		return json(downloads);
	} catch (e: any) {
		console.error('Failed to list downloads:', e);
		if (e.status) throw e;
		throw error(500, e.message || 'Failed to list downloads');
	}
};
