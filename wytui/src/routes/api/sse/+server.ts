import { sseEmitter } from '$lib/server/sse/emitter';
import type { RequestHandler } from './$types';

/**
 * GET /api/sse
 * Server-Sent Events stream
 */
export const GET: RequestHandler = async ({ request, locals }) => {
	// Generate unique client ID
	const clientId = crypto.randomUUID();

	// Get user ID from session
	const userId = locals.session?.user?.id;

	// Create SSE stream
	const stream = sseEmitter.registerClient(clientId, userId);

	// Handle client disconnect
	request.signal.addEventListener('abort', () => {
		sseEmitter.removeClient(clientId);
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive',
			'X-Accel-Buffering': 'no', // Disable nginx buffering
		},
	});
};
