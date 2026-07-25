import { json, error } from '@sveltejs/kit';
import { backupService } from '$lib/server/services/backup.service';
import { apiRoute } from '$lib/server/openapi';
import { requireAdmin } from '$lib/server/guards';
import type { RequestHandler } from './$types';

export const DELETE = apiRoute(
	'/api/backup/[id]',
	'DELETE',
	{
		summary: 'Delete a backup',
		tags: ['System'],
		auth: 'admin',
		params: { id: { type: 'string', description: 'Backup ID' } },
		responses: {
			200: {
				description: 'Backup deleted',
				schema: {
					type: 'object',
					properties: {
						success: { type: 'boolean' },
					},
				},
			},
			404: { description: 'Backup not found' },
		},
	},
	async ({ params, locals }) => {
		try {
			requireAdmin(locals);

			await backupService.deleteBackup(params.id);
			return json({ success: true });
		} catch (e: any) {
			console.error('Failed to delete backup:', e);
			if (e.status) throw e;
			if (e.message === 'Backup not found') throw error(404, 'Backup not found');
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
