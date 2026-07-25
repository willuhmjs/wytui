import { json, error } from '@sveltejs/kit';
import { rescanService } from '$lib/server/services/rescan.service';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/rescan',
	'GET',
	{
		summary: 'Rescan library for missing files',
		tags: ['System'],
		auth: 'admin',
		responses: {
			200: {
				description: 'Rescan report',
				schema: {
					type: 'object',
					properties: {
						missing: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									id: { type: 'string' },
									title: { type: 'string', nullable: true },
									filepath: { type: 'string' },
								},
							},
						},
						ok: { type: 'integer' },
					},
				},
			},
		},
	},
	async ({ locals }) => {
		try {
			if (!locals.session?.user?.isAdmin) throw error(403, 'Admin access required');

			const report = await rescanService.rescan();
			return json(report);
		} catch (e: any) {
			console.error('Rescan failed:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;

export const POST = apiRoute(
	'/api/rescan',
	'POST',
	{
		summary: 'Reconcile missing files',
		tags: ['System'],
		auth: 'admin',
		body: {
			markMissing: { type: 'array', description: 'Download IDs to mark as DELETED' },
			deleteRecords: { type: 'array', description: 'Download IDs to delete from database' },
		},
		responses: {
			200: {
				description: 'Reconciliation result',
				schema: {
					type: 'object',
					properties: {
						marked: { type: 'integer' },
						deleted: { type: 'integer' },
					},
				},
			},
		},
	},
	async ({ request, locals }) => {
		try {
			if (!locals.session?.user?.isAdmin) throw error(403, 'Admin access required');

			const body = await request.json();
			const result = await rescanService.reconcile({
				markMissing: body.markMissing,
				deleteRecords: body.deleteRecords,
			});
			return json(result);
		} catch (e: any) {
			console.error('Reconcile failed:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
