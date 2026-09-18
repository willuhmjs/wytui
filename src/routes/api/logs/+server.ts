import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { apiRoute } from '$lib/server/openapi';
import { requireAdmin } from '$lib/server/guards';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/logs',
	'GET',
	{
		summary: 'List event log entries (activity feed)',
		tags: ['System'],
		auth: 'admin',
		query: {
			type: {
				type: 'string',
				description: 'Filter by event type, e.g. "download.completed"',
			},
			limit: {
				type: 'integer',
				description: 'Max results',
				minimum: 1,
				maximum: 500,
				default: 100,
			},
			offset: { type: 'integer', description: 'Pagination offset', minimum: 0, default: 0 },
		},
		responses: {
			200: {
				description: 'Newest-first events, total matching count, and distinct event types',
				schema: {
					type: 'object',
					properties: {
						events: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									id: { type: 'string' },
									type: { type: 'string' },
									message: { type: 'string' },
									userId: { type: 'string', nullable: true },
									createdAt: { type: 'string', format: 'date-time' },
								},
							},
						},
						total: { type: 'integer' },
						types: { type: 'array', items: { type: 'string' } },
					},
				},
			},
		},
	},
	async ({ url, locals }) => {
		try {
			requireAdmin(locals);

			const typeParam = url.searchParams.get('type')?.trim() || undefined;

			let limit = parseInt(url.searchParams.get('limit') || '100');
			let offset = parseInt(url.searchParams.get('offset') || '0');

			if (isNaN(limit) || limit < 1) limit = 100;
			if (limit > 500) limit = 500;
			if (isNaN(offset) || offset < 0) offset = 0;

			const where = typeParam ? { type: typeParam } : {};

			const [events, total, typeGroups] = await Promise.all([
				prisma.eventLog.findMany({
					where,
					// Burst writers land rows in the same millisecond; without a
					// stable secondary key the engine's tie order is unspecified,
					// so an offset page boundary can re-serve or skip a row.
					orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
					take: limit,
					skip: offset,
				}),
				prisma.eventLog.count({ where }),
				// Unfiltered on purpose: the type dropdown must keep offering
				// every type present even while one is selected.
				prisma.eventLog.groupBy({ by: ['type'] }),
			]);

			const types = typeGroups.map((g) => g.type).sort();

			return json({ events, total, types });
		} catch (e: any) {
			console.error('Failed to list event logs:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;

export const DELETE = apiRoute(
	'/api/logs',
	'DELETE',
	{
		summary: 'Clear all event log entries',
		tags: ['System'],
		auth: 'admin',
		responses: {
			200: {
				description: 'Number of deleted entries',
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
	async ({ locals }) => {
		try {
			requireAdmin(locals);

			const result = await prisma.eventLog.deleteMany({});

			return json({ success: true, deleted: result.count });
		} catch (e: any) {
			console.error('Failed to clear event logs:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
