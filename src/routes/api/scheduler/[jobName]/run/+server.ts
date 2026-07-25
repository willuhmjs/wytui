import { json, error } from '@sveltejs/kit';
import { jobScheduler } from '$lib/server/jobs/scheduler';
import { apiRoute } from '$lib/server/openapi';
import { requireAdmin } from '$lib/server/guards';
import type { RequestHandler } from './$types';

export const POST = apiRoute(
	'/api/scheduler/[jobName]/run',
	'POST',
	{
		summary: 'Manually trigger a scheduled job',
		tags: ['System'],
		auth: 'admin',
		params: {
			jobName: { type: 'string', description: 'Job name to trigger' },
		},
		responses: {
			200: {
				description: 'Job triggered successfully',
				schema: {
					type: 'object',
					properties: {
						success: { type: 'boolean' },
					},
				},
			},
			400: { description: 'Unknown job name' },
		},
	},
	async ({ params, locals }) => {
		try {
			requireAdmin(locals);

			await jobScheduler.runJob(params.jobName);
			return json({ success: true });
		} catch (e: any) {
			console.error(`Failed to run job ${params.jobName}:`, e);
			if (e.status) throw e;
			if (e.message?.startsWith('Unknown job:')) {
				throw error(400, e.message);
			}
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
