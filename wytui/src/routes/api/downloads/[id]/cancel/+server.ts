import { json, error } from '@sveltejs/kit';
import { downloadService } from '$lib/server/services/download.service';
import type { RequestHandler } from './$types';

/**
 * POST /api/downloads/[id]/cancel
 * Cancel download
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	try {
		// Require authentication
		if (!locals.session?.user?.id) {
			throw error(401, 'Authentication required');
		}

		const download = await downloadService.getDownload(params.id);

		if (!download) {
			throw error(404, 'Download not found');
		}

		// Check ownership or admin
		if (download.userId !== locals.session.user.id && !locals.session.user.isAdmin) {
			throw error(403, 'Access denied');
		}

		await downloadService.cancelDownload(params.id);
		return json({ success: true });
	} catch (e: any) {
		console.error('Failed to cancel download:', e);
		if (e.status) throw e;
		throw error(500, e.message || 'Failed to cancel download');
	}
};
