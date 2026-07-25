import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { isOidcConfigured, getOidcDisplayName, isOidcManagedByEnv } from '$lib/server/oidc';
import { isLdapManagedByEnv } from '$lib/server/ldap';
import { apiRoute } from '$lib/server/openapi';
import { requireAdmin } from '$lib/server/guards';
import { libraryAccessStatus, effectiveCacheQuota } from '$lib/server/permissions';
import {
	validateSettingsUpdate,
	applySettingsSideEffects,
	serializeSettingsResponse,
} from '$lib/server/services/settings-validation';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/settings',
	'GET',
	{
		summary: 'Get application settings',
		description: 'Returns limited settings for regular users, full settings for admins',
		tags: ['Settings'],
		auth: true,
		responses: {
			200: {
				description: 'Settings object (scope varies by role)',
				schema: {
					type: 'object',
					properties: {
						maxConcurrentDownloads: { type: 'integer' },
						downloadPath: { type: 'string' },
						ytdlpPath: { type: 'string' },
						autoUpdateYtdlp: { type: 'boolean' },
						enableArchive: { type: 'boolean' },
						authMode: { type: 'string' },
						libraryPath: { type: 'string', nullable: true },
						musicLibraryPath: { type: 'string', nullable: true },
						cacheQuotaBytes: { type: 'string' },
						jellyfinUrl: { type: 'string', nullable: true },
						jellyfinApiKey: { type: 'string', nullable: true },
						oidcConfigured: { type: 'boolean' },
						maxDurationSeconds: { type: 'integer', nullable: true },
					},
				},
			},
		},
	},
	async ({ locals }) => {
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
				const user = await prisma.user.findUnique({
					where: { id: locals.session.user.id },
					select: { libraryAccess: true, isAdmin: true, cacheQuotaBytes: true },
				});
				const access = libraryAccessStatus(user, settings);
				const libraryConfigured = !!settings.libraryPath;
				return json({
					libraryAccess: access, // 'allowed' | 'request' | 'denied'
					canUseLibrary: access === 'allowed' && libraryConfigured,
					canRequestLibrary: access === 'request' && libraryConfigured,
					cacheQuotaBytes: effectiveCacheQuota(user, settings).toString(),
				});
			}

			const oidcConfigured = await isOidcConfigured();
			const oidcManagedByEnv = await isOidcManagedByEnv();
			const ldapManagedByEnv = await isLdapManagedByEnv();

			let canUsePasswordOnly = true;
			if (oidcConfigured) {
				const adminWithPassword = await prisma.user.findFirst({
					where: {
						isAdmin: true,
						password: { not: null },
					},
				});
				canUsePasswordOnly = !!adminWithPassword;
			}

			// Secrets are redacted by serializeSettingsResponse - show only if set.
			return json({
				...serializeSettingsResponse(settings),
				oidcConfigured,
				oidcManagedByEnv,
				ldapManagedByEnv,
				oidcDisplayName: oidcConfigured ? await getOidcDisplayName() : null,
				canUsePasswordOnly,
			});
		} catch (e: any) {
			console.error('Failed to get settings:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;

export const PATCH = apiRoute(
	'/api/settings',
	'PATCH',
	{
		summary: 'Update application settings',
		tags: ['Settings'],
		auth: 'admin',
		body: {
			maxConcurrentDownloads: {
				type: 'integer',
				description: 'Max concurrent downloads (1-20)',
				minimum: 1,
				maximum: 20,
			},
			downloadPath: { type: 'string', description: 'Download directory path' },
			ytdlpPath: { type: 'string', description: 'Path to yt-dlp binary' },
			autoUpdateYtdlp: { type: 'boolean', description: 'Auto-update yt-dlp' },
			updateCheckInterval: { type: 'integer', description: 'Update check interval (seconds)' },
			enableArchive: { type: 'boolean', description: 'Enable download archive' },
			archivePath: { type: 'string', description: 'Archive file path' },
			authMode: {
				type: 'string',
				description: 'Authentication mode',
				enum: ['password', 'oidc', 'both'],
			},
			libraryPath: { type: 'string', description: 'Library directory path' },
			musicLibraryPath: { type: 'string', description: 'Music library path' },
			cacheQuotaBytes: { type: 'string', description: 'Default per-user cache quota in bytes' },
			totalCacheQuotaBytes: {
				type: 'string',
				description: 'Global total cache cap in bytes; empty/null = auto (disk − 5 GB)',
				nullable: true,
			},
			jellyfinUrl: { type: 'string', description: 'Jellyfin server URL' },
			jellyfinApiKey: { type: 'string', description: 'Jellyfin API key' },
			jellyfinExternalUrl: { type: 'string', description: 'Jellyfin external URL' },
			plexUrl: { type: 'string', description: 'Plex server URL', nullable: true },
			plexToken: { type: 'string', description: 'Plex authentication token', nullable: true },
			maxDurationSeconds: {
				type: 'integer',
				description: 'Max download duration (0 = unlimited)',
				minimum: 0,
			},
			autoDeleteWatchedDays: {
				type: 'integer',
				description: 'Auto-delete watched videos after N days (null = disabled)',
				nullable: true,
				minimum: 0,
			},
			appriseUrl: {
				type: 'string',
				description: 'Apprise notification server URL',
				nullable: true,
			},
			notifyOnComplete: { type: 'boolean', description: 'Send notification on download complete' },
			notifyOnFail: { type: 'boolean', description: 'Send notification on download failure' },
			backupEnabled: { type: 'boolean', description: 'Enable scheduled backups' },
			backupCron: { type: 'string', description: 'Backup cron schedule', nullable: true },
			backupPath: { type: 'string', description: 'Backup directory path', nullable: true },
			ldapEnabled: { type: 'boolean', description: 'Enable LDAP authentication' },
			ldapUrl: { type: 'string', description: 'LDAP server URL', nullable: true },
			ldapBindDn: { type: 'string', description: 'LDAP bind DN', nullable: true },
			ldapBindPassword: { type: 'string', description: 'LDAP bind password', nullable: true },
			ldapSearchBase: { type: 'string', description: 'LDAP search base DN', nullable: true },
			ldapSearchFilter: {
				type: 'string',
				description: 'LDAP search filter template',
				nullable: true,
			},
			oidcEnabled: {
				type: 'boolean',
				description:
					'Enable OIDC SSO configured via the GUI (ignored when OIDC_* env vars are set)',
			},
			oidcIssuerUrl: { type: 'string', description: 'OIDC issuer URL', nullable: true },
			oidcClientId: { type: 'string', description: 'OIDC client ID', nullable: true },
			oidcClientSecret: {
				type: 'string',
				description: 'OIDC client secret (stored encrypted)',
				nullable: true,
			},
			oidcDisplayName: { type: 'string', description: 'OIDC sign-in button label', nullable: true },
			rateLimit: {
				type: 'string',
				description: 'Download speed limit (e.g. "5M" for 5MB/s)',
				nullable: true,
			},
			sleepInterval: {
				type: 'integer',
				description: 'Seconds to wait between downloads',
				nullable: true,
				minimum: 0,
			},
			proxyAuthEnabled: {
				type: 'boolean',
				description: 'Enable reverse-proxy authentication headers',
			},
			proxyAuthHeader: {
				type: 'string',
				description: 'Header name for proxy auth (e.g. X-Forwarded-User)',
			},
			versionCheckEnabled: {
				type: 'boolean',
				description: 'Enable automatic version update checks',
			},
			rydEnabled: { type: 'boolean', description: 'Enable Return YouTube Dislike integration' },
		},
		responses: {
			200: {
				description: 'Updated settings object',
				schema: {
					type: 'object',
					properties: {
						maxConcurrentDownloads: { type: 'integer' },
						downloadPath: { type: 'string' },
						ytdlpPath: { type: 'string' },
						autoUpdateYtdlp: { type: 'boolean' },
						enableArchive: { type: 'boolean' },
						authMode: { type: 'string' },
						libraryPath: { type: 'string', nullable: true },
						musicLibraryPath: { type: 'string', nullable: true },
						cacheQuotaBytes: { type: 'string' },
						jellyfinUrl: { type: 'string', nullable: true },
						jellyfinApiKey: { type: 'string', nullable: true },
						oidcConfigured: { type: 'boolean' },
						maxDurationSeconds: { type: 'integer', nullable: true },
					},
				},
			},
		},
	},
	async ({ request, locals }) => {
		try {
			requireAdmin(locals);

			const body = await request.json();
			const updates = await validateSettingsUpdate(body);

			const settings = await prisma.settings.update({
				where: { id: 'singleton' },
				data: updates,
			});

			await applySettingsSideEffects(updates);

			return json(serializeSettingsResponse(settings));
		} catch (e: any) {
			console.error('Failed to update settings:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
