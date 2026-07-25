import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { jobScheduler } from '$lib/server/jobs/scheduler';
import { apiRoute } from '$lib/server/openapi';
import { requireAdmin } from '$lib/server/guards';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/scheduler',
	'GET',
	{
		summary: 'Get scheduled jobs and run history',
		tags: ['System'],
		auth: 'admin',
		responses: {
			200: {
				description: 'Jobs list and recent run history',
				schema: {
					type: 'object',
					properties: {
						jobs: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									name: { type: 'string' },
									cron: { type: 'string' },
									enabled: { type: 'boolean' },
									description: { type: 'string' },
								},
							},
						},
						history: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									id: { type: 'string' },
									jobName: { type: 'string' },
									status: { type: 'string' },
									startedAt: { type: 'string', format: 'date-time' },
									endedAt: { type: 'string', format: 'date-time', nullable: true },
									error: { type: 'string', nullable: true },
									details: { type: 'string', nullable: true },
								},
							},
						},
					},
				},
			},
		},
	},
	async ({ locals }) => {
		try {
			requireAdmin(locals);

			const jobs = jobScheduler.getJobs();

			const history = await prisma.scheduledJobRun.findMany({
				orderBy: { startedAt: 'desc' },
				take: 50,
			});

			return json({ jobs, history });
		} catch (e: any) {
			console.error('Failed to get scheduler info:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
