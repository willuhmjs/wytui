import { describe, it, expect, beforeAll } from 'vitest';
import { encryptSecret, decryptSecret } from './crypto-box';

beforeAll(() => {
	process.env.AUTH_SECRET = 'test-secret-value-for-crypto-box';
});

describe('crypto-box', () => {
	it('round-trips a value', () => {
		const plain = 'cookie-jar-contents\nline2';
		const enc = encryptSecret(plain);
		expect(enc).not.toContain('cookie-jar-contents');
		expect(decryptSecret(enc)).toBe(plain);
	});

	it('produces different ciphertext each call (random IV)', () => {
		expect(encryptSecret('x')).not.toBe(encryptSecret('x'));
	});

	it('throws on tampered payload', () => {
		const enc = encryptSecret('secret');
		const tampered = enc.slice(0, -2) + (enc.slice(-2) === 'AA' ? 'BB' : 'AA');
		expect(() => decryptSecret(tampered)).toThrow();
	});
});
