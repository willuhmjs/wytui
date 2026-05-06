import { json, error } from '@sveltejs/kit';
import { downloadService } from '$lib/server/services/download.service';
import { libraryService } from '$lib/server/services/library.service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals }) => {
	try {
		if (!locals.session?.user?.id) {
			throw error(401, 'Authentication required');
		}

		const download = await downloadService.getDownload(params.id);

		if (!download) {
			throw error(404, 'Download not found');
		}

		if (download.userId !== locals.session.user.id && !locals.session.user.isAdmin) {
			throw error(403, 'Access denied');
		}

		if (download.status !== 'COMPLETED') {
			throw error(400, 'Download must be completed');
		}

		await libraryService.promoteToLibrary(params.id);

		const updated = await downloadService.getDownload(params.id);
		return json(updated);
	} catch (e: any) {
		console.error('Failed to promote download:', e);
		if (e.status) throw e;
		throw error(500, e.message || 'Failed to promote download');
	}
};
