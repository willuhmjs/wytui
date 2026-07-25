import { Client } from 'ldapts';
import { prisma } from './db';
import { decryptSecret } from './utils/crypto-box';

interface LdapUser {
	email: string;
	name: string;
}

export interface LdapEnv {
	LDAP_ENABLED?: string;
	LDAP_URL?: string;
	LDAP_BIND_DN?: string;
	LDAP_BIND_PASSWORD?: string;
	LDAP_SEARCH_BASE?: string;
	LDAP_SEARCH_FILTER?: string;
}

export interface LdapDbSettings {
	ldapEnabled: boolean;
	ldapUrl: string | null;
	ldapBindDn: string | null;
	ldapBindPassword: string | null; // already decrypted
	ldapSearchBase: string | null;
	ldapSearchFilter: string | null;
}

export interface LdapSource {
	enabled: boolean;
	url: string;
	bindDn: string;
	bindPassword: string;
	searchBase: string;
	searchFilter: string;
	/** True when any LDAP_* env var is set — env governs, GUI fields are read-only. */
	managedByEnv: boolean;
	/** True when a complete, usable config is available (from env or DB). */
	configured: boolean;
}

const DEFAULT_FILTER = '(uid={{username}})';

/**
 * Resolve the effective LDAP configuration from env vars and DB settings.
 * Environment variables take precedence: if any LDAP_* var is present, env
 * fully governs the integration and the DB config is ignored.
 * Pure and synchronous for straightforward testing.
 */
export function pickLdapSource(env: LdapEnv, db: LdapDbSettings | null): LdapSource {
	const anyEnv = !!(
		env.LDAP_URL ||
		env.LDAP_ENABLED ||
		env.LDAP_BIND_DN ||
		env.LDAP_BIND_PASSWORD ||
		env.LDAP_SEARCH_BASE ||
		env.LDAP_SEARCH_FILTER
	);

	if (anyEnv) {
		const enabled = env.LDAP_ENABLED ? env.LDAP_ENABLED === 'true' : true;
		const url = env.LDAP_URL || '';
		const searchBase = env.LDAP_SEARCH_BASE || '';
		return {
			enabled,
			url,
			bindDn: env.LDAP_BIND_DN || '',
			bindPassword: env.LDAP_BIND_PASSWORD || '',
			searchBase,
			searchFilter: env.LDAP_SEARCH_FILTER || DEFAULT_FILTER,
			managedByEnv: true,
			configured: enabled && !!url && !!searchBase,
		};
	}

	if (db?.ldapEnabled && db.ldapUrl && db.ldapSearchBase) {
		return {
			enabled: true,
			url: db.ldapUrl,
			bindDn: db.ldapBindDn || '',
			bindPassword: db.ldapBindPassword || '',
			searchBase: db.ldapSearchBase,
			searchFilter: db.ldapSearchFilter || DEFAULT_FILTER,
			managedByEnv: false,
			configured: true,
		};
	}

	return {
		enabled: false,
		url: '',
		bindDn: '',
		bindPassword: '',
		searchBase: '',
		searchFilter: DEFAULT_FILTER,
		managedByEnv: false,
		configured: false,
	};
}

/**
 * Escape special characters in LDAP filter strings to prevent injection attacks
 * Based on RFC 4515 section 3
 */
function escapeLdapFilter(input: string): string {
	return input
		.replace(/\\/g, '\\5c')
		.replace(/\*/g, '\\2a')
		.replace(/\(/g, '\\28')
		.replace(/\)/g, '\\29')
		.replace(/\0/g, '\\00');
}

async function resolveLdap(): Promise<LdapSource> {
	let db: LdapDbSettings | null = null;
	try {
		const s = await prisma.settings.findUnique({ where: { id: 'singleton' } });
		if (s) {
			let bindPassword = s.ldapBindPassword;
			if (bindPassword) {
				try {
					bindPassword = decryptSecret(bindPassword);
				} catch {
					// Legacy plaintext value — use as-is.
				}
			}
			db = {
				ldapEnabled: s.ldapEnabled,
				ldapUrl: s.ldapUrl,
				ldapBindDn: s.ldapBindDn,
				ldapBindPassword: bindPassword,
				ldapSearchBase: s.ldapSearchBase,
				ldapSearchFilter: s.ldapSearchFilter,
			};
		}
	} catch {
		// DB unavailable — fall back to env-only resolution.
	}
	return pickLdapSource(process.env, db);
}

export async function isLdapEnabled(): Promise<boolean> {
	return (await resolveLdap()).configured;
}

/** True when LDAP is governed by environment variables (GUI fields locked). */
export async function isLdapManagedByEnv(): Promise<boolean> {
	return (await resolveLdap()).managedByEnv;
}

export async function authenticateLdap(
	username: string,
	password: string,
): Promise<LdapUser | null> {
	const config = await resolveLdap();
	if (!config.configured) throw new Error('LDAP is not configured');

	// Reject empty credentials: an empty password triggers an unauthenticated
	// (anonymous) bind that many directories accept, which would be an auth bypass.
	if (!username || !password) return null;

	const client = new Client({ url: config.url });

	try {
		if (config.bindDn) {
			await client.bind(config.bindDn, config.bindPassword);
		}

		// Escape username to prevent LDAP injection
		const escapedUsername = escapeLdapFilter(username);
		const filter = config.searchFilter.replace(/\{\{username\}\}/g, escapedUsername);

		const { searchEntries } = await client.search(config.searchBase, {
			filter,
			scope: 'sub',
			attributes: ['dn', 'mail', 'email', 'cn', 'displayName', 'uid', 'sAMAccountName'],
		});

		if (searchEntries.length === 0) return null;

		const entry = searchEntries[0];
		const userDn = entry.dn;

		await client.unbind();

		const userClient = new Client({ url: config.url });
		try {
			await userClient.bind(userDn, password);
		} catch {
			return null;
		} finally {
			await userClient.unbind().catch(() => {});
		}

		const email = (entry.mail || entry.email || `${username}@ldap`) as string;
		const name = (entry.displayName || entry.cn || username) as string;

		return {
			email: Array.isArray(email) ? email[0] : email,
			name: Array.isArray(name) ? name[0] : name,
		};
	} catch (e) {
		console.error('[LDAP] Authentication error:', e);
		throw new Error('LDAP authentication failed');
	} finally {
		await client.unbind().catch(() => {});
	}
}
