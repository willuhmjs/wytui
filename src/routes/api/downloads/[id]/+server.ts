import { json, error } from '@sveltejs/kit';
import { downloadService } from '$lib/server/services/download.service';
import { prisma } from '$lib/server/db';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/downloads/[id]',
	'GET',
	{
		summary: 'Get download by ID',
		tags: ['Downloads'],
		auth: true,
		params: { id: { type: 'string', description: 'Download ID' } },
		responses: {
			200: {
				description: 'Download object',
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
			404: { description: 'Download not found' },
		},
	},
	async ({ params, locals }) => {
		try {
			if (!locals.session?.user?.id) {
				throw error(401, 'Authentication required');
			}

			const download = await downloadService.getDownload(params.id);

			if (!download) {
				throw error(404, 'Download not found');
			}

			if (download.userId !== locals.session.user.id && !locals.session.user.isAdmin) {
				throw error(403, 'Access denied');
			}

			return json(download);
		} catch (e: any) {
			console.error('Failed to get download:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;

export const PATCH = apiRoute(
	'/api/downloads/[id]',
	'PATCH',
	{
		summary: 'Update download metadata (tags)',
		tags: ['Downloads'],
		auth: true,
		params: { id: { type: 'string', description: 'Download ID' } },
		body: {
			tags: { type: 'array', description: 'Array of tag strings' },
		},
		responses: {
			200: { description: 'Updated download' },
			404: { description: 'Download not found' },
		},
	},
	async ({ params, locals, request }) => {
		if (!locals.session?.user?.id) throw error(401, 'Authentication required');

		const download = await downloadService.getDownload(params.id);
		if (!download) throw error(404, 'Download not found');
		if (download.userId !== locals.session.user.id && !locals.session.user.isAdmin) {
			throw error(403, 'Access denied');
		}

		const body = await request.json();
		const data: any = {};
		if (Array.isArray(body.tags)) {
			data.tags = body.tags
				.filter((t: any) => typeof t === 'string' && t.trim())
				.map((t: string) => t.trim());
		}

		const updated = await prisma.download.update({
			where: { id: params.id },
			data,
			include: { profile: true },
		});

		return json({
			...updated,
			filesize: updated.filesize?.toString() ?? null,
			downloadedBytes: updated.downloadedBytes?.toString() ?? null,
			totalBytes: updated.totalBytes?.toString() ?? null,
		});
	},
) satisfies RequestHandler;

export const DELETE = apiRoute(
	'/api/downloads/[id]',
	'DELETE',
	{
		summary: 'Delete a download',
		tags: ['Downloads'],
		auth: true,
		params: { id: { type: 'string', description: 'Download ID' } },
		responses: {
			200: {
				description: 'Download deleted',
				schema: {
					type: 'object',
					properties: {
						success: { type: 'boolean' },
					},
				},
			},
			404: { description: 'Download not found' },
		},
	},
	async ({ params, locals }) => {
		try {
			if (!locals.session?.user?.id) {
				throw error(401, 'Authentication required');
			}

			const download = await downloadService.getDownload(params.id);

			if (!download) {
				throw error(404, 'Download not found');
			}

			if (download.userId !== locals.session.user.id && !locals.session.user.isAdmin) {
				throw error(403, 'Access denied');
			}

			await downloadService.deleteDownload(params.id);
			return json({ success: true });
		} catch (e: any) {
			console.error('Failed to delete download:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
