import { json, error } from '@sveltejs/kit';
import { backupService } from '$lib/server/services/backup.service';
import { apiRoute } from '$lib/server/openapi';
import { requireAdmin } from '$lib/server/guards';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/backup',
	'GET',
	{
		summary: 'List backups',
		tags: ['System'],
		auth: 'admin',
		responses: {
			200: {
				description: 'List of backups',
				schema: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							id: { type: 'string' },
							filename: { type: 'string' },
							filepath: { type: 'string' },
							sizeBytes: { type: 'string' },
							type: { type: 'string' },
							createdAt: { type: 'string', format: 'date-time' },
						},
					},
				},
			},
		},
	},
	async ({ locals }) => {
		try {
			requireAdmin(locals);

			const backups = await backupService.listBackups();
			return json(backups);
		} catch (e: any) {
			console.error('Failed to list backups:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;

export const POST = apiRoute(
	'/api/backup',
	'POST',
	{
		summary: 'Create a manual backup',
		tags: ['System'],
		auth: 'admin',
		responses: {
			200: {
				description: 'Created backup object',
				schema: {
					type: 'object',
					properties: {
						id: { type: 'string' },
						filename: { type: 'string' },
						filepath: { type: 'string' },
						sizeBytes: { type: 'string' },
						type: { type: 'string' },
						createdAt: { type: 'string', format: 'date-time' },
					},
				},
			},
		},
	},
	async ({ locals }) => {
		try {
			requireAdmin(locals);

			const backup = await backupService.createBackup('manual');
			return json(backup);
		} catch (e: any) {
			console.error('Failed to create backup:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
