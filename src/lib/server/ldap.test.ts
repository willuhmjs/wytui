import { describe, it, expect, vi } from 'vitest';

// Avoid instantiating the real Prisma client when importing ldap.ts.
vi.mock('./db', () => ({ prisma: {} }));

import { pickLdapSource, type LdapDbSettings } from './ldap';

const DEFAULT_FILTER = '(uid={{username}})';

const fullDb: LdapDbSettings = {
	ldapEnabled: true,
	ldapUrl: 'ldap://db.example.com:389',
	ldapBindDn: 'cn=admin,dc=db',
	ldapBindPassword: 'db-pw',
	ldapSearchBase: 'ou=users,dc=db',
	ldapSearchFilter: '(mail={{username}})',
};

describe('pickLdapSource', () => {
	it('env fully governs when any LDAP_* var is present, ignoring DB', () => {
		const src = pickLdapSource(
			{
				LDAP_URL: 'ldap://env.example.com:389',
				LDAP_BIND_DN: 'cn=admin,dc=env',
				LDAP_BIND_PASSWORD: 'env-pw',
				LDAP_SEARCH_BASE: 'ou=users,dc=env',
				LDAP_SEARCH_FILTER: '(sAMAccountName={{username}})',
			},
			fullDb,
		);
		expect(src.url).toBe('ldap://env.example.com:389');
		expect(src.bindDn).toBe('cn=admin,dc=env');
		expect(src.bindPassword).toBe('env-pw');
		expect(src.searchBase).toBe('ou=users,dc=env');
		expect(src.searchFilter).toBe('(sAMAccountName={{username}})');
		expect(src.enabled).toBe(true);
		expect(src.managedByEnv).toBe(true);
		expect(src.configured).toBe(true);
	});

	it('defaults enabled to true and filter to the default when env omits them', () => {
		const src = pickLdapSource(
			{ LDAP_URL: 'ldap://env.example.com:389', LDAP_SEARCH_BASE: 'ou=users,dc=env' },
			null,
		);
		expect(src.enabled).toBe(true);
		expect(src.searchFilter).toBe(DEFAULT_FILTER);
		expect(src.configured).toBe(true);
	});

	it('honors LDAP_ENABLED=false and reports not configured', () => {
		const src = pickLdapSource(
			{
				LDAP_ENABLED: 'false',
				LDAP_URL: 'ldap://env.example.com:389',
				LDAP_SEARCH_BASE: 'ou=users,dc=env',
			},
			fullDb,
		);
		expect(src.enabled).toBe(false);
		expect(src.managedByEnv).toBe(true);
		expect(src.configured).toBe(false);
	});

	it('is managed by env but not configured when url is missing', () => {
		const src = pickLdapSource({ LDAP_BIND_DN: 'cn=admin,dc=env' }, fullDb);
		expect(src.managedByEnv).toBe(true);
		expect(src.configured).toBe(false);
		expect(src.url).toBe('');
	});

	it('uses DB config when no env vars are set', () => {
		const src = pickLdapSource({}, fullDb);
		expect(src.url).toBe('ldap://db.example.com:389');
		expect(src.bindDn).toBe('cn=admin,dc=db');
		expect(src.bindPassword).toBe('db-pw');
		expect(src.searchBase).toBe('ou=users,dc=db');
		expect(src.searchFilter).toBe('(mail={{username}})');
		expect(src.managedByEnv).toBe(false);
		expect(src.configured).toBe(true);
	});

	it('falls back to the default filter when DB filter is null', () => {
		const src = pickLdapSource({}, { ...fullDb, ldapSearchFilter: null });
		expect(src.searchFilter).toBe(DEFAULT_FILTER);
	});

	it('is not configured when DB is enabled but missing a search base', () => {
		const src = pickLdapSource({}, { ...fullDb, ldapSearchBase: null });
		expect(src.configured).toBe(false);
	});

	it('is not configured when DB config is present but disabled', () => {
		const src = pickLdapSource({}, { ...fullDb, ldapEnabled: false });
		expect(src.configured).toBe(false);
	});

	it('returns an unconfigured default source when nothing is set', () => {
		const src = pickLdapSource({}, null);
		expect(src.enabled).toBe(false);
		expect(src.configured).toBe(false);
		expect(src.managedByEnv).toBe(false);
		expect(src.searchFilter).toBe(DEFAULT_FILTER);
		expect(src.url).toBe('');
	});
});
