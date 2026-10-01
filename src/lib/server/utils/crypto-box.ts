import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';

function key(): Buffer {
	const secret = process.env.AUTH_SECRET;
	if (!secret) throw new Error('AUTH_SECRET is required for cookie encryption');
	// Derive a 32-byte key from AUTH_SECRET.
	return Buffer.from(hkdfSync('sha256', secret, 'wytui-youtube-salt', 'cookie-box', 32));
}

/** Encrypt plaintext → base64 "iv:tag:ciphertext". `aad` binds the blob to the row that owns it; omitting it keeps the pre-binding byte format the Settings singleton still uses. */
export function encryptSecret(plaintext: string, aad?: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key(), iv);
	if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
	const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

/** Decrypt a payload from {@link encryptSecret}. Throws if tampered, malformed, or encrypted under a different `aad`. */
export function decryptSecret(payload: string, aad?: string): string {
	const [ivB64, tagB64, ctB64] = payload.split(':');
	if (!ivB64 || !tagB64 || !ctB64) throw new Error('Malformed encrypted payload');
	const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
	if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
	decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
	return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString(
		'utf8',
	);
}
