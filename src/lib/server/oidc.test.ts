import { describe, it, expect, vi } from 'vitest';

// Avoid instantiating the real Prisma client when importing oidc.ts.
vi.mock('./db', () => ({ prisma: {} }));

import { pickOidcSource, type OidcDbSettings } from './oidc';

const fullDb: OidcDbSettings = {
	oidcEnabled: true,
	oidcIssuerUrl: 'https://db.example.com/',
	oidcClientId: 'db-client',
	oidcClientSecret: 'db-secret',
	oidcDisplayName: 'DB SSO',
};

describe('pickOidcSource', () => {
	it('env fully governs when the complete OIDC_* trio is present, ignoring DB', () => {
		const src = pickOidcSource(
			{
				OIDC_ISSUER_URL: 'https://env.example.com/',
				OIDC_CLIENT_ID: 'env-client',
				OIDC_CLIENT_SECRET: 'env-secret',
				OIDC_DISPLAY_NAME: 'Env SSO',
			},
			fullDb,
		);
		expect(src.issuerUrl).toBe('https://env.example.com/');
		expect(src.clientId).toBe('env-client');
		expect(src.clientSecret).toBe('env-secret');
		expect(src.displayName).toBe('Env SSO');
		expect(src.managedByEnv).toBe(true);
		expect(src.configured).toBe(true);
	});

	it('falls through to DB config when env is partial (a stray env var must not disable DB)', () => {
		const src = pickOidcSource({ OIDC_ISSUER_URL: 'https://env.example.com/' }, fullDb);
		expect(src.managedByEnv).toBe(false);
		expect(src.configured).toBe(true);
		expect(src.issuerUrl).toBe('https://db.example.com/');
		expect(src.clientId).toBe('db-client');
	});

	it('is unconfigured when env is partial and no DB config exists', () => {
		const src = pickOidcSource({ OIDC_ISSUER_URL: 'https://env.example.com/' }, null);
		expect(src.managedByEnv).toBe(false);
		expect(src.configured).toBe(false);
		expect(src.clientId).toBeNull();
	});

	it('defaults display name to SSO when env omits it', () => {
		const src = pickOidcSource(
			{
				OIDC_ISSUER_URL: 'https://env.example.com/',
				OIDC_CLIENT_ID: 'env-client',
				OIDC_CLIENT_SECRET: 'env-secret',
			},
			null,
		);
		expect(src.displayName).toBe('SSO');
	});

	it('uses DB config when no env vars are set', () => {
		const src = pickOidcSource({}, fullDb);
		expect(src.issuerUrl).toBe('https://db.example.com/');
		expect(src.clientId).toBe('db-client');
		expect(src.clientSecret).toBe('db-secret');
		expect(src.displayName).toBe('DB SSO');
		expect(src.managedByEnv).toBe(false);
		expect(src.configured).toBe(true);
	});

	it('is not configured when DB is enabled but incomplete', () => {
		const src = pickOidcSource({}, { ...fullDb, oidcClientSecret: null });
		expect(src.configured).toBe(false);
		expect(src.managedByEnv).toBe(false);
	});

	it('is not configured when DB config is present but disabled', () => {
		const src = pickOidcSource({}, { ...fullDb, oidcEnabled: false });
		expect(src.configured).toBe(false);
	});

	it('returns an unconfigured source with default name when nothing is set', () => {
		const src = pickOidcSource({}, null);
		expect(src.configured).toBe(false);
		expect(src.managedByEnv).toBe(false);
		expect(src.displayName).toBe('SSO');
		expect(src.issuerUrl).toBeNull();
	});

	it('preserves the DB display name for an unconfigured source', () => {
		const src = pickOidcSource({}, { ...fullDb, oidcEnabled: false, oidcDisplayName: 'Draft SSO' });
		expect(src.displayName).toBe('Draft SSO');
	});
});
