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

	describe('AAD binding', () => {
		it('round-trips with the same AAD', () => {
			const enc = encryptSecret('jar', 'user-1');
			expect(decryptSecret(enc, 'user-1')).toBe('jar');
		});

		it('will not decrypt for another owner', () => {
			const asUserA = encryptSecret('jar', 'user-A');
			// The whole point: a blob that is byte-identical and perfectly intact is
			// worthless to a caller that cannot name the row it was written for.
			expect(() => decryptSecret(asUserA, 'user-B')).toThrow();
		});

		it('will not decrypt with the AAD omitted, nor an unbound blob with one', () => {
			expect(() => decryptSecret(encryptSecret('jar', 'user-A'))).toThrow();
			expect(() => decryptSecret(encryptSecret('jar'), 'user-A')).toThrow();
		});

		it('leaves unbound payloads readable (global secrets must survive the change)', () => {
			const legacy = encryptSecret('jellyfin-api-key');
			expect(decryptSecret(legacy)).toBe('jellyfin-api-key');
			// Same bytes an old build would have produced: no marker, still "iv:tag:ct".
			expect(legacy.split(':')).toHaveLength(3);
		});

		it('still rejects a tampered AAD-bound payload', () => {
			const enc = encryptSecret('jar', 'user-1');
			const tampered = enc.slice(0, -2) + (enc.slice(-2) === 'AA' ? 'BB' : 'AA');
			expect(() => decryptSecret(tampered, 'user-1')).toThrow();
		});
	});
});
