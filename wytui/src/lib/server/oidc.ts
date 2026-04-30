import * as client from 'openid-client';

const OIDC_ISSUER_URL = process.env.OIDC_ISSUER_URL;
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID;
const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET;
const OIDC_DISPLAY_NAME = process.env.OIDC_DISPLAY_NAME || 'SSO';

let cachedConfig: client.Configuration | null = null;

export function isOidcConfigured(): boolean {
	return !!(OIDC_ISSUER_URL && OIDC_CLIENT_ID && OIDC_CLIENT_SECRET);
}

export function getOidcDisplayName(): string {
	return OIDC_DISPLAY_NAME;
}

export async function getOidcConfig(): Promise<client.Configuration> {
	if (cachedConfig) return cachedConfig;

	if (!OIDC_ISSUER_URL || !OIDC_CLIENT_ID || !OIDC_CLIENT_SECRET) {
		throw new Error('OIDC is not configured');
	}

	cachedConfig = await client.discovery(
		new URL(OIDC_ISSUER_URL),
		OIDC_CLIENT_ID,
		{ client_secret: OIDC_CLIENT_SECRET },
	);

	return cachedConfig;
}
