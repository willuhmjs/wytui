import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { queueService } from '$lib/server/services/queue.service';
import { isOidcConfigured, getOidcDisplayName } from '$lib/server/oidc';
import { resolve, normalize } from 'path';
import type { RequestHandler } from './$types';

const ALLOWED_SETTINGS_FIELDS = new Set([
	'maxConcurrentDownloads',
	'downloadPath',
	'ytdlpPath',
	'autoUpdateYtdlp',
	'updateCheckInterval',
	'enableArchive',
	'archivePath',
	'authMode',
	'libraryPath',
	'musicLibraryPath',
	'cacheQuotaBytes',
	'jellyfinUrl',
	'jellyfinApiKey',
]);

export const GET: RequestHandler = async ({ locals }) => {
	try {
		if (!locals.session?.user?.id) {
			throw error(401, 'Authentication required');
		}

		let settings = await prisma.settings.findUnique({
			where: { id: 'singleton' },
		});

		if (!settings) {
			settings = await prisma.settings.create({
				data: { id: 'singleton' },
			});
		}

		if (!locals.session.user.isAdmin) {
			return json({
				libraryPath: settings.libraryPath,
				musicLibraryPath: settings.musicLibraryPath,
				cacheQuotaBytes: settings.cacheQuotaBytes.toString(),
			});
		}

		return json({
			...settings,
			cacheQuotaBytes: settings.cacheQuotaBytes.toString(),
			oidcConfigured: isOidcConfigured(),
			oidcDisplayName: isOidcConfigured() ? getOidcDisplayName() : null,
		});
	} catch (e: any) {
		console.error('Failed to get settings:', e);
		if (e.status) throw e;
		throw error(500, e.message || 'Failed to get settings');
	}
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	try {
		if (!locals.session?.user?.isAdmin) {
			throw error(403, 'Admin access required');
		}

		const body = await request.json();

		const updates: Record<string, any> = {};
		for (const key of Object.keys(body)) {
			if (!ALLOWED_SETTINGS_FIELDS.has(key)) {
				throw error(400, `Unknown setting: ${key}`);
			}
			updates[key] = body[key];
		}

		if (updates.downloadPath !== undefined) {
			const normalized = normalize(resolve(updates.downloadPath));
			if (normalized.includes('..')) {
				throw error(400, 'Invalid download path');
			}
			updates.downloadPath = normalized;
		}

		if (updates.ytdlpPath !== undefined) {
			const normalized = normalize(resolve(updates.ytdlpPath));
			if (normalized.includes('..')) {
				throw error(400, 'Invalid yt-dlp path');
			}
			updates.ytdlpPath = normalized;
		}

		if (updates.authMode !== undefined) {
			if (!['password', 'oidc', 'both'].includes(updates.authMode)) {
				throw error(400, 'Invalid auth mode');
			}
		}

		if (updates.libraryPath !== undefined && updates.libraryPath !== null) {
			const normalized = normalize(resolve(updates.libraryPath));
			if (normalized.includes('..')) {
				throw error(400, 'Invalid library path');
			}
			updates.libraryPath = normalized;
		}

		if (updates.musicLibraryPath !== undefined && updates.musicLibraryPath !== null) {
			const normalized = normalize(resolve(updates.musicLibraryPath));
			if (normalized.includes('..')) {
				throw error(400, 'Invalid music library path');
			}
			updates.musicLibraryPath = normalized;
		}

		if (updates.cacheQuotaBytes !== undefined) {
			const val = BigInt(updates.cacheQuotaBytes);
			if (val < BigInt(0)) {
				throw error(400, 'Cache quota must be positive');
			}
			updates.cacheQuotaBytes = val;
		}

		if (updates.maxConcurrentDownloads !== undefined) {
			const val = Number(updates.maxConcurrentDownloads);
			if (!Number.isInteger(val) || val < 1 || val > 20) {
				throw error(400, 'maxConcurrentDownloads must be between 1 and 20');
			}
			queueService.setMaxConcurrent(val);
		}

		const settings = await prisma.settings.update({
			where: { id: 'singleton' },
			data: updates,
		});

		return json({
			...settings,
			cacheQuotaBytes: settings.cacheQuotaBytes.toString(),
		});
	} catch (e: any) {
		console.error('Failed to update settings:', e);
		if (e.status) throw e;
		throw error(500, e.message || 'Failed to update settings');
	}
};
