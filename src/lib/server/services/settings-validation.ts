import { error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { queueService } from '$lib/server/services/queue.service';
import { isOidcManagedByEnv } from '$lib/server/oidc';
import { isLdapManagedByEnv } from '$lib/server/ldap';
import { encryptSecret } from '$lib/server/utils/crypto-box';
import { resolve, normalize } from 'path';
import { statfs } from 'fs/promises';

export const ALLOWED_SETTINGS_FIELDS = new Set([
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
	'totalCacheQuotaBytes',
	'jellyfinUrl',
	'jellyfinApiKey',
	'jellyfinExternalUrl',
	'plexUrl',
	'plexToken',
	'maxDurationSeconds',
	'cleanupEnabled',
	'cleanupUserIds',
	'cleanupIntervalSeconds',
	'cleanupProfileTypes',
	'cleanupGraceHours',
	'autoDeleteWatchedDays',
	'appriseUrl',
	'notifyOnComplete',
	'notifyOnFail',
	'backupEnabled',
	'backupCron',
	'backupPath',
	'ldapEnabled',
	'ldapUrl',
	'ldapBindDn',
	'ldapBindPassword',
	'ldapSearchBase',
	'ldapSearchFilter',
	'oidcEnabled',
	'oidcIssuerUrl',
	'oidcClientId',
	'oidcClientSecret',
	'oidcDisplayName',
	'rateLimit',
	'sleepInterval',
	'proxyAuthEnabled',
	'proxyAuthHeader',
	'versionCheckEnabled',
	'rydEnabled',
	'libraryAccessMode',
	'statsVisibleToNonAdmins',
	'showTotalSizeToNonAdmins',
	'concurrentFragments',
	'useAria2c',
	'httpChunkSize',
	'generateJellyfinPosters',
	'ytdlpProxyUrl',
	'ytdlpExtraFlags',
]);

/**
 * Fields returned as '***SET***' rather than their value. A client echoing the
 * mask back must not overwrite the stored secret with the literal mask.
 */
export const SECRET_SETTINGS_FIELDS = new Set([
	'jellyfinApiKey',
	'plexToken',
	'ldapBindPassword',
	'appriseUrl',
	'oidcClientSecret',
]);

/** Secrets stored encrypted at rest (see crypto-box). */
export const ENCRYPTED_SETTINGS_FIELDS = ['oidcClientSecret', 'ldapBindPassword'] as const;

const OIDC_FIELDS = [
	'oidcEnabled',
	'oidcIssuerUrl',
	'oidcClientId',
	'oidcClientSecret',
	'oidcDisplayName',
];

const LDAP_FIELDS = [
	'ldapEnabled',
	'ldapUrl',
	'ldapBindDn',
	'ldapBindPassword',
	'ldapSearchBase',
	'ldapSearchFilter',
];

/**
 * Settings fields currently governed by environment variables and therefore
 * read-only. A config export always carries every field, so import strips these
 * rather than failing the whole file; PATCH rejects them outright.
 */
export async function envManagedSettingsFields(): Promise<string[]> {
	const locked: string[] = [];
	if (await isOidcManagedByEnv()) locked.push(...OIDC_FIELDS);
	if (await isLdapManagedByEnv()) locked.push(...LDAP_FIELDS);
	return locked;
}

/**
 * Validate and normalize a settings update payload against ALLOWED_SETTINGS_FIELDS.
 * Shared by PATCH and config import so both go through identical checks. Pure
 * validation only — no side effects (e.g. live queue concurrency changes) belong
 * here, since import previews call this without writing anything.
 */
export async function validateSettingsUpdate(
	body: Record<string, any>,
): Promise<Record<string, any>> {
	const updates: Record<string, any> = {};
	for (const key of Object.keys(body)) {
		if (!ALLOWED_SETTINGS_FIELDS.has(key)) {
			throw error(400, `Unknown setting: ${key}`);
		}
		if (SECRET_SETTINGS_FIELDS.has(key) && body[key] === '***SET***') {
			continue; // unchanged masked secret — leave existing value untouched
		}
		updates[key] = body[key];
	}

	// OIDC/LDAP fields are read-only when governed by environment variables.
	if (OIDC_FIELDS.some((f) => f in updates) && (await isOidcManagedByEnv())) {
		throw error(400, 'OIDC is managed by environment variables and cannot be edited here');
	}
	if (LDAP_FIELDS.some((f) => f in updates) && (await isLdapManagedByEnv())) {
		throw error(400, 'LDAP is managed by environment variables and cannot be edited here');
	}

	// Encrypt secrets at rest. Empty string clears the secret (store null).
	for (const field of ENCRYPTED_SETTINGS_FIELDS) {
		if (updates[field] !== undefined) {
			updates[field] = updates[field] ? encryptSecret(String(updates[field])) : null;
		}
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

		if (updates.authMode === 'password') {
			const adminWithPassword = await prisma.user.findFirst({
				where: {
					isAdmin: true,
					password: { not: null },
				},
			});
			if (!adminWithPassword) {
				throw error(
					400,
					'Cannot switch to password-only authentication: no admin accounts have a password set. Create a password for an admin account first.',
				);
			}
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

		const currentSettings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
		const downloadPath = updates.downloadPath || currentSettings?.downloadPath || '/downloads';
		try {
			const stats = await statfs(downloadPath);
			const totalBytes = BigInt(stats.bsize) * BigInt(stats.blocks);
			if (val > totalBytes) {
				const totalGB = Number(totalBytes) / (1024 * 1024 * 1024);
				throw error(400, `Cache quota exceeds total disk space (${totalGB.toFixed(1)} GB)`);
			}
		} catch (e: any) {
			if (e.status) throw e;
		}

		updates.cacheQuotaBytes = val;
	}

	if (updates.totalCacheQuotaBytes !== undefined) {
		// Empty string or null clears the override → auto (disk − 5 GB).
		if (updates.totalCacheQuotaBytes === null || updates.totalCacheQuotaBytes === '') {
			updates.totalCacheQuotaBytes = null;
		} else {
			const val = BigInt(updates.totalCacheQuotaBytes);
			if (val < BigInt(0)) {
				throw error(400, 'Total cache quota must be positive');
			}

			const currentSettings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
			const downloadPath = updates.downloadPath || currentSettings?.downloadPath || '/downloads';
			try {
				const stats = await statfs(downloadPath);
				const totalBytes = BigInt(stats.bsize) * BigInt(stats.blocks);
				if (val > totalBytes) {
					const totalGB = Number(totalBytes) / (1024 * 1024 * 1024);
					throw error(400, `Total cache quota exceeds total disk space (${totalGB.toFixed(1)} GB)`);
				}
			} catch (e: any) {
				if (e.status) throw e;
			}

			updates.totalCacheQuotaBytes = val;
		}
	}

	if (updates.maxConcurrentDownloads !== undefined) {
		const val = Number(updates.maxConcurrentDownloads);
		if (!Number.isInteger(val) || val < 1 || val > 20) {
			throw error(400, 'maxConcurrentDownloads must be between 1 and 20');
		}
	}

	if (updates.maxDurationSeconds !== undefined) {
		const val = Number(updates.maxDurationSeconds);
		if (!Number.isInteger(val) || val < 0) {
			throw error(400, 'maxDurationSeconds must be a non-negative integer');
		}
	}

	if (updates.cleanupIntervalSeconds !== undefined) {
		const val = Number(updates.cleanupIntervalSeconds);
		if (!Number.isInteger(val) || val < 600 || val > 86400) {
			throw error(400, 'cleanupIntervalSeconds must be between 600 and 86400');
		}
	}

	if (updates.cleanupGraceHours !== undefined) {
		const val = Number(updates.cleanupGraceHours);
		if (!Number.isInteger(val) || val < 0 || val > 720) {
			throw error(400, 'cleanupGraceHours must be between 0 and 720');
		}
	}

	if (updates.cleanupUserIds !== undefined) {
		if (
			!Array.isArray(updates.cleanupUserIds) ||
			!updates.cleanupUserIds.every((id: unknown) => typeof id === 'string' && id.length > 0)
		) {
			throw error(400, 'cleanupUserIds must be an array of non-empty strings');
		}
	}

	if (updates.cleanupProfileTypes !== undefined) {
		const allowed = ['video', 'music'];
		if (
			!Array.isArray(updates.cleanupProfileTypes) ||
			!updates.cleanupProfileTypes.every((t: unknown) => allowed.includes(t as string))
		) {
			throw error(400, 'cleanupProfileTypes must only contain "video" or "music"');
		}
	}

	if (updates.rateLimit !== undefined && updates.rateLimit !== null) {
		const rateLimitPattern = /^\d+(\.\d+)?[KMG]?$/i;
		if (!rateLimitPattern.test(updates.rateLimit)) {
			throw error(400, 'rateLimit must be a number optionally followed by K, M, or G (e.g. "5M")');
		}
	}

	if (updates.sleepInterval !== undefined && updates.sleepInterval !== null) {
		const val = Number(updates.sleepInterval);
		if (!Number.isInteger(val) || val < 0 || val > 3600) {
			throw error(400, 'sleepInterval must be an integer between 0 and 3600');
		}
	}

	if (updates.proxyAuthHeader !== undefined) {
		const header = String(updates.proxyAuthHeader).trim();
		if (!header || !/^[a-zA-Z0-9-]+$/.test(header)) {
			throw error(
				400,
				'proxyAuthHeader must be a valid HTTP header name (letters, digits, hyphens)',
			);
		}
		updates.proxyAuthHeader = header;
	}

	if (updates.concurrentFragments !== undefined) {
		const val = Number(updates.concurrentFragments);
		if (!Number.isInteger(val) || val < 0 || val > 16) {
			throw error(400, 'concurrentFragments must be an integer between 0 and 16');
		}
	}

	if (updates.useAria2c !== undefined) {
		if (typeof updates.useAria2c !== 'boolean') {
			throw error(400, 'useAria2c must be a boolean');
		}
	}

	if (updates.httpChunkSize !== undefined) {
		// Allow null or empty string → coerce to null
		if (updates.httpChunkSize === null || updates.httpChunkSize === '') {
			updates.httpChunkSize = null;
		} else {
			if (typeof updates.httpChunkSize !== 'string') {
				throw error(400, 'httpChunkSize must be a string or null');
			}
			// Validate format: bare number or number with K/M/G suffix (e.g. "10M", "1.5G", "500K")
			const chunkSizePattern = /^\d+(\.\d+)?[KMGkmg]?$/;
			if (!chunkSizePattern.test(updates.httpChunkSize)) {
				throw error(
					400,
					'httpChunkSize must be a number optionally followed by K, M, or G (e.g. "10M", "1.5G", "500K")',
				);
			}
		}
	}

	if (updates.generateJellyfinPosters !== undefined) {
		if (typeof updates.generateJellyfinPosters !== 'boolean') {
			throw error(400, 'generateJellyfinPosters must be a boolean');
		}
	}

	if (updates.ytdlpProxyUrl !== undefined) {
		// Empty string or null clears the proxy.
		if (updates.ytdlpProxyUrl === null || updates.ytdlpProxyUrl === '') {
			updates.ytdlpProxyUrl = null;
		} else {
			const proxy = String(updates.ytdlpProxyUrl).trim();
			const allowedSchemes = ['http:', 'https:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'];
			let scheme: string | null = null;
			try {
				scheme = new URL(proxy).protocol;
			} catch {
				// fall through to the error below
			}
			if (!scheme || !allowedSchemes.includes(scheme)) {
				throw error(
					400,
					'ytdlpProxyUrl must be a valid http(s)/socks4/socks5/socks5h proxy URL (e.g. "socks5://host:port")',
				);
			}
			updates.ytdlpProxyUrl = proxy;
		}
	}

	if (updates.ytdlpExtraFlags !== undefined) {
		if (
			!Array.isArray(updates.ytdlpExtraFlags) ||
			!updates.ytdlpExtraFlags.every((f: unknown) => typeof f === 'string')
		) {
			throw error(400, 'ytdlpExtraFlags must be an array of strings');
		}
		const { ytdlpService } = await import('$lib/server/services/ytdlp.service');
		const badFlag = ytdlpService.findDangerousFlag(updates.ytdlpExtraFlags);
		if (badFlag) {
			throw error(400, `Forbidden ytdlp flag: ${badFlag}`);
		}
	}

	return updates;
}

/**
 * Side effects that should only fire once a settings update is actually persisted
 * (not during an import preview / dry run).
 */
export async function applySettingsSideEffects(updates: Record<string, any>): Promise<void> {
	if (updates.maxConcurrentDownloads !== undefined) {
		queueService.setMaxConcurrent(Number(updates.maxConcurrentDownloads));
	}

	if (
		updates.cleanupEnabled !== undefined ||
		updates.cleanupIntervalSeconds !== undefined ||
		updates.cleanupUserIds !== undefined
	) {
		const { jobScheduler } = await import('$lib/server/jobs/scheduler');
		await jobScheduler.restartCleanupTask();
	}
}

/**
 * Shape a raw Settings row for JSON responses: stringify BigInt fields and
 * redact secrets down to a '***SET***' marker so values never leave the server.
 */
export function serializeSettingsResponse(settings: {
	cacheQuotaBytes: bigint;
	totalCacheQuotaBytes: bigint | null;
	[key: string]: any;
}) {
	const redacted: Record<string, any> = { ...settings };
	for (const field of SECRET_SETTINGS_FIELDS) {
		redacted[field] = redacted[field] ? '***SET***' : null;
	}
	return {
		...redacted,
		cacheQuotaBytes: settings.cacheQuotaBytes.toString(),
		totalCacheQuotaBytes: settings.totalCacheQuotaBytes?.toString() ?? null,
	};
}
