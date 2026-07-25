import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { statfs } from 'fs/promises';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/settings/disk',
	'GET',
	{
		summary: 'Get disk space info',
		tags: ['Settings'],
		auth: 'admin',
		responses: {
			200: {
				description: 'Disk total and available bytes',
				schema: {
					type: 'object',
					properties: {
						totalBytes: { type: 'string' },
						availableBytes: { type: 'string' },
					},
				},
			},
			500: { description: 'Could not determine disk space' },
		},
	},
	async ({ locals }) => {
		if (!locals.session?.user?.isAdmin) {
			throw error(403, 'Admin access required');
		}

		const settings = await prisma.settings.findUnique({
			where: { id: 'singleton' },
		});

		const downloadPath = settings?.downloadPath || '/downloads';

		try {
			const stats = await statfs(downloadPath);
			const totalBytes = stats.bsize * stats.blocks;
			const availableBytes = stats.bsize * stats.bavail;

			return json({ totalBytes: String(totalBytes), availableBytes: String(availableBytes) });
		} catch {
			throw error(500, 'Could not determine disk space for download path');
		}
	},
) satisfies RequestHandler;
