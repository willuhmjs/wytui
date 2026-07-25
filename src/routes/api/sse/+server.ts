import { sseEmitter } from '$lib/server/sse/emitter';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/sse',
	'GET',
	{
		summary: 'Server-Sent Events stream',
		tags: ['System'],
		auth: 'optional',
		responses: { 200: { description: 'SSE event stream' } },
	},
	async ({ request, locals }) => {
		const clientId = crypto.randomUUID();
		const userId = locals.session?.user?.id;
		const stream = sseEmitter.registerClient(clientId, userId);

		request.signal.addEventListener('abort', () => {
			sseEmitter.removeClient(clientId);
		});

		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
				'X-Accel-Buffering': 'no',
			},
		});
	},
) satisfies RequestHandler;
