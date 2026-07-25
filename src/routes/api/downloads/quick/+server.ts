import { json, error } from '@sveltejs/kit';
import { downloadService } from '$lib/server/services/download.service';
import { prisma } from '$lib/server/db';
import { apiRoute } from '$lib/server/openapi';
import { extractVideoId } from '$lib/utils/youtube';
import type { RequestHandler } from './$types';

// Whitelist of allowed origins for CORS
const ALLOWED_ORIGINS = [
	process.env.ORIGIN || 'http://localhost:5173',
	'http://localhost:5173',
	'http://localhost:3000',
];

// Helper to get CORS headers based on request origin
function getCorsHeaders(request: Request): Record<string, string> {
	const origin = request.headers.get('origin');

	// Check if origin is allowed or is a chrome-extension (for browser extensions)
	const isAllowed =
		origin &&
		(ALLOWED_ORIGINS.includes(origin) ||
			origin.startsWith('chrome-extension://') ||
			origin.startsWith('moz-extension://'));

	if (isAllowed) {
		return {
			'Access-Control-Allow-Origin': origin,
			'Access-Control-Allow-Headers': 'Authorization, Content-Type',
			'Access-Control-Allow-Credentials': 'true',
		};
	}

	return {};
}

export const OPTIONS: RequestHandler = async ({ request }) => {
	return new Response(null, { status: 204, headers: getCorsHeaders(request) });
};

export const GET: RequestHandler = async ({ url, locals, request }) => {
	if (!locals.session?.user?.id) {
		return json({ error: 'Unauthorized' }, { status: 401, headers: getCorsHeaders(request) });
	}

	const lookupUrl = url.searchParams.get('url');
	if (!lookupUrl) {
		return json(
			{ error: 'Missing url parameter' },
			{ status: 400, headers: getCorsHeaders(request) },
		);
	}

	// Match on the stable videoId (indexed) when we can derive one — exact-URL
	// matching misses youtu.be/timestamp/param-order variants of the same video.
	// Fall back to exact URL for non-YouTube links.
	const videoId = extractVideoId(lookupUrl);

	const downloads = await prisma.download.findMany({
		where: {
			userId: locals.session.user.id,
			status: { notIn: ['DELETED'] },
			...(videoId ? { OR: [{ videoId }, { url: lookupUrl }] } : { url: lookupUrl }),
		},
		select: {
			id: true,
			title: true,
			thumbnail: true,
			status: true,
			storagePool: true,
			duration: true,
			uploader: true,
			filesize: true,
			completedAt: true,
			videoId: true,
			profileId: true,
			format: true,
			height: true,
			videoType: true,
			profile: {
				select: { id: true, name: true, quality: true, audioOnly: true, audioFormat: true },
			},
		},
		orderBy: { createdAt: 'desc' },
	});

	// filesize is a Prisma BigInt — JSON.stringify can't serialize it, so coerce
	// to a string (matching serializeDownload) before responding.
	const serialized = downloads.map((d) => ({
		...d,
		filesize: d.filesize != null ? d.filesize.toString() : null,
	}));

	return json(serialized, { headers: getCorsHeaders(request) });
};

export const POST = apiRoute(
	'/api/downloads/quick',
	'POST',
	{
		summary: 'Quick download (browser extension)',
		description:
			'Simplified endpoint for browser extensions. Accepts just a URL and uses the default profile.',
		tags: ['Downloads'],
		auth: true,
		body: {
			url: { type: 'string', required: true, description: 'URL to download' },
		},
		responses: {
			201: {
				description: 'Created download object',
				schema: {
					type: 'object',
					properties: {
						id: { type: 'string' },
						url: { type: 'string' },
						status: {
							type: 'string',
							enum: [
								'PENDING',
								'FETCHING_INFO',
								'DOWNLOADING',
								'PROCESSING',
								'COMPLETED',
								'FAILED',
								'CANCELLED',
							],
						},
						title: { type: 'string', nullable: true },
						thumbnail: { type: 'string', nullable: true },
						duration: { type: 'integer', nullable: true },
						uploader: { type: 'string', nullable: true },
						progress: { type: 'number' },
						speed: { type: 'string', nullable: true },
						eta: { type: 'string', nullable: true },
						filename: { type: 'string', nullable: true },
						filepath: { type: 'string', nullable: true },
						filesize: { type: 'string', nullable: true },
						profileId: { type: 'string' },
						userId: { type: 'string', nullable: true },
						storagePool: { type: 'string', enum: ['cache', 'library'] },
						createdAt: { type: 'string', format: 'date-time' },
						completedAt: { type: 'string', format: 'date-time', nullable: true },
					},
				},
			},
		},
	},
	async ({ request, locals }) => {
		try {
			const { url, profileId, saveToLibrary } = await request.json();

			if (!url) {
				return json(
					{ error: 'Missing required field: url' },
					{ status: 400, headers: getCorsHeaders(request) },
				);
			}

			// Validate URL format
			try {
				const urlObj = new URL(url);
				if (!['http:', 'https:'].includes(urlObj.protocol)) {
					return json(
						{ error: 'Only HTTP(S) URLs are allowed' },
						{ status: 400, headers: getCorsHeaders(request) },
					);
				}
			} catch {
				return json(
					{ error: 'Invalid URL format' },
					{ status: 400, headers: getCorsHeaders(request) },
				);
			}

			const userId = locals.session?.user?.id;

			// Use specified profile if provided, otherwise fall back to user's default
			let profile;
			if (profileId) {
				profile = await prisma.downloadProfile.findFirst({
					where: {
						id: profileId,
						OR: [{ isSystem: true }, { userId }],
					},
				});
			}
			if (!profile) {
				profile = await prisma.downloadProfile.findFirst({
					where: userId ? { OR: [{ userId }, { isSystem: true }] } : { isSystem: true },
					orderBy: [{ isDefault: 'desc' }, { isSystem: 'asc' }],
				});
			}

			if (!profile) {
				return json(
					{ error: 'No download profile found. Create a profile first.' },
					{ status: 400, headers: getCorsHeaders(request) },
				);
			}

			const download = await downloadService.createDownload(
				url,
				profile.id,
				userId,
				undefined,
				!!saveToLibrary,
			);

			return json(download, { status: 201, headers: getCorsHeaders(request) });
		} catch (e: any) {
			console.error('Failed to create quick download:', e);
			return json(
				{ error: e.message || 'Failed to create download' },
				{ status: e.status || 500, headers: getCorsHeaders(request) },
			);
		}
	},
) satisfies RequestHandler;
