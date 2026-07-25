import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';

function key(): Buffer {
	const secret = process.env.AUTH_SECRET;
	if (!secret) throw new Error('AUTH_SECRET is required for cookie encryption');
	// Derive a 32-byte key from AUTH_SECRET.
	return Buffer.from(hkdfSync('sha256', secret, 'wytui-youtube-salt', 'cookie-box', 32));
}

/** Encrypt plaintext → base64 "iv:tag:ciphertext". */
export function encryptSecret(plaintext: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key(), iv);
	const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

/** Decrypt a payload from encryptSecret. Throws if tampered or malformed. */
export function decryptSecret(payload: string): string {
	const [ivB64, tagB64, ctB64] = payload.split(':');
	if (!ivB64 || !tagB64 || !ctB64) throw new Error('Malformed encrypted payload');
	const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
	decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
	return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString(
		'utf8',
	);
}
