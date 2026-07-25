import { json, error } from '@sveltejs/kit';
import { readdir, stat } from 'fs/promises';
import { resolve, normalize, dirname, basename, sep } from 'path';
import { apiRoute } from '$lib/server/openapi';
import { requireAdmin } from '$lib/server/guards';
import type { RequestHandler } from '@sveltejs/kit';

// Whitelist of allowed base paths for directory browsing
const ALLOWED_BASE_PATHS = [
	process.env.DOWNLOADS_PATH || '/downloads',
	process.env.LIBRARY_PATH || '/media',
	process.env.MUSIC_PATH || '/music',
	'/tmp', // For temporary files
];

export const GET = apiRoute(
	'/api/browse',
	'GET',
	{
		summary: 'Browse server directories',
		tags: ['System'],
		auth: 'admin',
		query: {
			path: { type: 'string', description: 'Directory path to browse', default: '/' },
		},
		responses: {
			200: {
				description: 'Directory listing with parent, current path, and subdirectories',
				schema: {
					type: 'object',
					properties: {
						parent: { type: 'string' },
						current: { type: 'string' },
						dirs: { type: 'array', items: { type: 'string' } },
					},
				},
			},
		},
	},
	async ({ url, locals }) => {
		requireAdmin(locals);

		const path = url.searchParams.get('path') || '/';
		const normalized = normalize(resolve(path));

		if (normalized.includes('..')) {
			throw error(400, 'Invalid path');
		}

		// Validate path is within allowed base paths
		const isAllowed = ALLOWED_BASE_PATHS.some((basePath) => {
			const base = normalize(resolve(basePath));
			return normalized === base || normalized.startsWith(base + sep);
		});

		if (!isAllowed) {
			throw error(403, 'Access denied. Path must be within allowed directories.');
		}

		try {
			const info = await stat(normalized).catch(() => null);

			let dirPath: string;
			let prefix = '';

			if (info?.isDirectory()) {
				dirPath = normalized;
			} else {
				dirPath = dirname(normalized);
				prefix = basename(normalized).toLowerCase();
			}

			const entries = await readdir(dirPath, { withFileTypes: true });
			const dirs = entries
				.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
				.filter((e) => !prefix || e.name.toLowerCase().startsWith(prefix))
				.map((e) => resolve(dirPath, e.name))
				.sort();

			return json({ parent: dirname(dirPath), current: dirPath, dirs });
		} catch (e: any) {
			if (e.code === 'ENOENT' || e.code === 'ENOTDIR') {
				return json({ parent: dirname(normalized), current: normalized, dirs: [] });
			}
			if (e.code === 'EACCES') {
				throw error(403, 'Permission denied');
			}
			throw error(500, 'Failed to browse directory');
		}
	},
);
