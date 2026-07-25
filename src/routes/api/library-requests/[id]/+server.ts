import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { libraryService } from '$lib/server/services/library.service';
import { apiRoute } from '$lib/server/openapi';
import { requireAdmin } from '$lib/server/guards';
import type { RequestHandler } from './$types';

export const PATCH = apiRoute(
	'/api/library-requests/[id]',
	'PATCH',
	{
		summary: 'Approve or deny a library-save request (admin)',
		tags: ['Library'],
		auth: 'admin',
		params: { id: { type: 'string', description: 'Library request ID' } },
		body: { action: { type: 'string', required: true, description: 'approve | deny' } },
		responses: {
			200: { description: 'Updated request' },
			404: { description: 'Request not found' },
		},
	},
	async ({ params, request, locals }) => {
		requireAdmin(locals);
		const adminId = locals.session!.user!.id;

		const { action } = await request.json();
		if (action !== 'approve' && action !== 'deny') {
			throw error(400, "action must be 'approve' or 'deny'");
		}

		const req = await prisma.libraryRequest.findUnique({
			where: { id: params.id },
			include: { download: { select: { id: true, status: true, storagePool: true } } },
		});
		if (!req) throw error(404, 'Request not found');

		if (action === 'deny') {
			const updated = await prisma.libraryRequest.update({
				where: { id: req.id },
				data: { status: 'denied', resolvedAt: new Date(), resolvedBy: adminId },
			});
			return json(updated);
		}

		// approve: promote now if the download is already completed & still in cache;
		// otherwise mark approved and the completion hook will promote it.
		const updated = await prisma.libraryRequest.update({
			where: { id: req.id },
			data: { status: 'approved', resolvedAt: new Date(), resolvedBy: adminId },
		});

		if (req.download.status === 'COMPLETED' && req.download.storagePool === 'cache') {
			try {
				await libraryService.promoteToLibrary(req.download.id);
			} catch (e) {
				console.error('Failed to promote on library-request approval:', e);
				throw error(500, 'Failed to move download to library');
			}
		}

		return json(updated);
	},
) satisfies RequestHandler;
