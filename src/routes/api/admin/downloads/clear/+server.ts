import { json, error } from '@sveltejs/kit';
import { downloadService } from '$lib/server/services/download.service';
import { apiRoute } from '$lib/server/openapi';
import { requireAdmin } from '$lib/server/guards';
import type { RequestHandler } from './$types';

export const POST = apiRoute(
	'/api/admin/downloads/clear',
	'POST',
	{
		summary: 'Delete all downloads (admin), optionally scoped to a single user',
		tags: ['Admin'],
		auth: 'admin',
		body: {
			userId: {
				type: 'string',
				nullable: true,
				description: 'Restrict deletion to this user. Omit to clear every user’s downloads.',
			},
		},
		responses: {
			200: {
				description: 'Downloads cleared with deleted count',
				schema: {
					type: 'object',
					properties: {
						success: { type: 'boolean' },
						deleted: { type: 'integer' },
					},
				},
			},
		},
	},
	async ({ request, locals }) => {
		try {
			requireAdmin(locals);

			const { userId } = await request.json().catch(() => ({}));
			const deleted = await downloadService.clearAllDownloads(
				typeof userId === 'string' && userId ? userId : undefined,
			);
			return json({ success: true, deleted });
		} catch (e: any) {
			console.error('Failed to clear downloads:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
