import { error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/tags',
	'GET',
	{
		summary: 'Get unique tags for autocomplete',
		tags: ['Downloads'],
		auth: true,
		responses: { 200: { description: 'Array of unique tag strings' } },
	},
	async ({ locals }) => {
		if (!locals.session?.user?.id) throw error(401, 'Authentication required');

		// Fetch all downloads with tags for this user using Prisma ORM
		const downloads = await prisma.download.findMany({
			where: {
				userId: locals.session.user.id,
				tags: {
					isEmpty: false,
				},
			},
			select: {
				tags: true,
			},
		});

		// Flatten and deduplicate tags in application code
		const uniqueTags = [...new Set(downloads.flatMap((d) => d.tags))].sort();

		return new Response(JSON.stringify(uniqueTags), {
			headers: { 'Content-Type': 'application/json' },
		});
	},
) satisfies RequestHandler;
