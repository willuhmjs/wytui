import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { apiRoute } from '$lib/server/openapi';
import { requireAdmin } from '$lib/server/guards';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/library-requests',
	'GET',
	{
		summary: 'List library-save requests (admin)',
		description: 'Returns pending library-save requests with download + requester info.',
		tags: ['Library'],
		auth: 'admin',
		responses: { 200: { description: 'Array of library requests' } },
	},
	async ({ locals, url }) => {
		requireAdmin(locals);

		const status = url.searchParams.get('status') ?? 'pending';
		const requests = await prisma.libraryRequest.findMany({
			where: status === 'all' ? {} : { status },
			orderBy: { createdAt: 'desc' },
			include: {
				user: { select: { id: true, email: true, name: true } },
				download: {
					select: {
						id: true,
						title: true,
						thumbnail: true,
						status: true,
						url: true,
						uploader: true,
					},
				},
			},
		});

		return json(requests);
	},
) satisfies RequestHandler;
