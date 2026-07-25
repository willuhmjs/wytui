import { json, error } from '@sveltejs/kit';
import { backupService } from '$lib/server/services/backup.service';
import { apiRoute } from '$lib/server/openapi';
import { requireAdmin } from '$lib/server/guards';
import type { RequestHandler } from './$types';

export const POST = apiRoute(
	'/api/backup/restore',
	'POST',
	{
		summary: 'Restore from a backup',
		tags: ['System'],
		auth: 'admin',
		body: {
			backupId: { type: 'string', description: 'ID of the backup to restore', required: true },
		},
		responses: {
			200: {
				description: 'Restore result',
				schema: {
					type: 'object',
					properties: {
						restored: { type: 'boolean' },
					},
				},
			},
			404: { description: 'Backup not found' },
		},
	},
	async ({ request, locals }) => {
		try {
			requireAdmin(locals);

			const body = await request.json();
			if (!body.backupId) throw error(400, 'backupId is required');

			const backup = await backupService.getBackup(body.backupId);
			if (!backup) throw error(404, 'Backup not found');

			const result = await backupService.restoreBackup(backup.filepath);
			return json(result);
		} catch (e: any) {
			console.error('Failed to restore backup:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
