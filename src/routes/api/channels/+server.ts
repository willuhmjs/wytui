import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.session?.user?.id) throw error(401, 'Authentication required');

	const search = url.searchParams.get('q')?.trim() || '';

	// Optional pagination — callers without `limit` get all channels (back-compat);
	// the UI passes limit/offset and uses a "load more" model.
	const hasLimit = url.searchParams.has('limit');
	let limit = parseInt(url.searchParams.get('limit') || '60', 10);
	let offset = parseInt(url.searchParams.get('offset') || '0', 10);
	if (isNaN(limit) || limit < 1) limit = 60;
	if (limit > 200) limit = 200;
	if (isNaN(offset) || offset < 0) offset = 0;

	const groups = await prisma.download.groupBy({
		by: ['uploader'],
		where: {
			userId: locals.session.user.id,
			status: 'COMPLETED',
			uploader: { not: null, ...(search ? { contains: search, mode: 'insensitive' } : {}) },
		},
		_count: { id: true },
		orderBy: { _count: { id: 'desc' } },
		...(hasLimit ? { take: limit, skip: offset } : {}),
	});

	// Fetch a representative thumbnail per uploader
	const uploaderNames = groups.map((g) => g.uploader).filter(Boolean) as string[];
	const thumbnails = await prisma.download.findMany({
		where: {
			userId: locals.session.user.id,
			status: 'COMPLETED',
			uploader: { in: uploaderNames },
			thumbnail: { not: null },
		},
		select: { uploader: true, thumbnail: true },
		distinct: ['uploader'],
	});
	const thumbMap = new Map(thumbnails.map((t) => [t.uploader, t.thumbnail]));

	return json(
		groups.map((g) => ({
			name: g.uploader,
			count: g._count.id,
			thumbnail: thumbMap.get(g.uploader!) ?? null,
		})),
	);
};
