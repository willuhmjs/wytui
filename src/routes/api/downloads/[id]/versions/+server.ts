import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/downloads/[id]/versions',
	'GET',
	{
		summary: 'List saved copies/versions of a download',
		description:
			'Returns all COMPLETED downloads that share this video (same videoId) for the current user — the different saved formats/profiles available to download.',
		tags: ['Downloads'],
		auth: true,
		params: { id: { type: 'string', description: 'Download ID' } },
		responses: {
			200: { description: 'Array of downloadable versions' },
			404: { description: 'Download not found' },
		},
	},
	async ({ params, locals }) => {
		if (!locals.session?.user?.id) {
			throw error(401, 'Authentication required');
		}
		const isAdmin = !!locals.session.user.isAdmin;
		const userId = locals.session.user.id;

		const dl = await prisma.download.findUnique({
			where: { id: params.id },
			select: { id: true, videoId: true, userId: true },
		});
		if (!dl) throw error(404, 'Download not found');
		if (dl.userId !== userId && !isAdmin) throw error(403, 'Access denied');

		// Group by the stable videoId when available; otherwise just this download.
		const where = dl.videoId
			? { videoId: dl.videoId, status: 'COMPLETED' as const, ...(isAdmin ? {} : { userId }) }
			: { id: dl.id, status: 'COMPLETED' as const };

		const rows = await prisma.download.findMany({
			where,
			select: {
				id: true,
				title: true,
				format: true,
				height: true,
				videoType: true,
				filesize: true,
				storagePool: true,
				completedAt: true,
				profile: { select: { name: true, quality: true, audioOnly: true, audioFormat: true } },
			},
			orderBy: { completedAt: 'desc' },
		});

		return json(rows.map((r) => ({ ...r, filesize: r.filesize?.toString() ?? null })));
	},
) satisfies RequestHandler;
