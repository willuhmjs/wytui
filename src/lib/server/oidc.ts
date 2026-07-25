import * as client from 'openid-client';
import { prisma } from './db';
import { decryptSecret } from './utils/crypto-box';

export interface OidcEnv {
	OIDC_ISSUER_URL?: string;
	OIDC_CLIENT_ID?: string;
	OIDC_CLIENT_SECRET?: string;
	OIDC_DISPLAY_NAME?: string;
}

export interface OidcDbSettings {
	oidcEnabled: boolean;
	oidcIssuerUrl: string | null;
	oidcClientId: string | null;
	oidcClientSecret: string | null; // already decrypted
	oidcDisplayName: string | null;
}

export interface OidcSource {
	issuerUrl: string | null;
	clientId: string | null;
	clientSecret: string | null;
	displayName: string;
	/** True when any OIDC_* env var is set — env governs, GUI fields are read-only. */
	managedByEnv: boolean;
	/** True when a complete, usable config is available (from env or DB). */
	configured: boolean;
}

/**
 * Resolve the effective OIDC configuration from env vars and DB settings.
 * Environment variables take precedence only when the COMPLETE trio
 * (OIDC_ISSUER_URL + OIDC_CLIENT_ID + OIDC_CLIENT_SECRET) is present: env then
 * fully governs the integration and the DB config is ignored. A *partial* env
 * config does not govern — we fall through to the DB-configured source so a
 * fully-configured DB OIDC row is not silently disabled by a stray env var.
 * Pure and synchronous for straightforward testing.
 */
export function pickOidcSource(env: OidcEnv, db: OidcDbSettings | null): OidcSource {
	const envComplete = !!(env.OIDC_ISSUER_URL && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET);

	if (envComplete) {
		return {
			issuerUrl: env.OIDC_ISSUER_URL ?? null,
			clientId: env.OIDC_CLIENT_ID ?? null,
			clientSecret: env.OIDC_CLIENT_SECRET ?? null,
			displayName: env.OIDC_DISPLAY_NAME || 'SSO',
			managedByEnv: true,
			configured: true,
		};
	}

	if (db?.oidcEnabled && db.oidcIssuerUrl && db.oidcClientId && db.oidcClientSecret) {
		return {
			issuerUrl: db.oidcIssuerUrl,
			clientId: db.oidcClientId,
			clientSecret: db.oidcClientSecret,
			displayName: db.oidcDisplayName || 'SSO',
			managedByEnv: false,
			configured: true,
		};
	}

	return {
		issuerUrl: null,
		clientId: null,
		clientSecret: null,
		displayName: db?.oidcDisplayName || 'SSO',
		managedByEnv: false,
		configured: false,
	};
}

async function resolveOidc(): Promise<OidcSource> {
	let db: OidcDbSettings | null = null;
	try {
		const s = await prisma.settings.findUnique({ where: { id: 'singleton' } });
		if (s) {
			let secret = s.oidcClientSecret;
			if (secret) {
				try {
					secret = decryptSecret(secret);
				} catch {
					// Legacy plaintext value — use as-is.
				}
			}
			db = {
				oidcEnabled: s.oidcEnabled,
				oidcIssuerUrl: s.oidcIssuerUrl,
				oidcClientId: s.oidcClientId,
				oidcClientSecret: secret,
				oidcDisplayName: s.oidcDisplayName,
			};
		}
	} catch {
		// DB unavailable — fall back to env-only resolution.
	}
	return pickOidcSource(process.env, db);
}

export async function isOidcConfigured(): Promise<boolean> {
	return (await resolveOidc()).configured;
}

export async function getOidcDisplayName(): Promise<string> {
	return (await resolveOidc()).displayName;
}

/** True when OIDC is governed by environment variables (GUI fields locked). */
export async function isOidcManagedByEnv(): Promise<boolean> {
	return (await resolveOidc()).managedByEnv;
}

let cachedConfig: client.Configuration | null = null;
let cachedKey: string | null = null;

export async function getOidcConfig(): Promise<client.Configuration> {
	const src = await resolveOidc();
	if (!src.configured || !src.issuerUrl || !src.clientId || !src.clientSecret) {
		throw new Error('OIDC is not configured');
	}

	const cacheKey = `${src.issuerUrl}|${src.clientId}|${src.clientSecret}`;
	if (cachedConfig && cachedKey === cacheKey) return cachedConfig;

	cachedConfig = await client.discovery(new URL(src.issuerUrl), src.clientId, {
		client_secret: src.clientSecret,
	});
	cachedKey = cacheKey;

	return cachedConfig;
}
