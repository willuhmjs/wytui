import { error } from '@sveltejs/kit';
import { backupService } from '$lib/server/services/backup.service';
import { createReadStream, existsSync } from 'fs';
import { stat } from 'fs/promises';
import { apiRoute } from '$lib/server/openapi';
import { requireAdmin } from '$lib/server/guards';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/backup/[id]/download',
	'GET',
	{
		summary: 'Download a backup file',
		tags: ['System'],
		auth: 'admin',
		params: { id: { type: 'string', description: 'Backup ID' } },
		responses: {
			200: { description: 'Backup JSON file stream' },
			404: { description: 'Backup not found' },
		},
	},
	async ({ params, locals }) => {
		try {
			requireAdmin(locals);

			const backup = await backupService.getBackup(params.id);
			if (!backup) throw error(404, 'Backup not found');

			if (!existsSync(backup.filepath)) {
				throw error(404, 'Backup file no longer exists on disk');
			}

			const stats = await stat(backup.filepath);

			const stream = createReadStream(backup.filepath);
			return new Response(stream as any, {
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': stats.size.toString(),
					'Content-Disposition': `attachment; filename="${backup.filename}"`,
				},
			});
		} catch (e: any) {
			console.error('Failed to download backup:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
