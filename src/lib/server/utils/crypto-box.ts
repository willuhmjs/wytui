import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';

function key(): Buffer {
	const secret = process.env.AUTH_SECRET;
	if (!secret) throw new Error('AUTH_SECRET is required for cookie encryption');
	// Derive a 32-byte key from AUTH_SECRET.
	return Buffer.from(hkdfSync('sha256', secret, 'wytui-youtube-salt', 'cookie-box', 32));
}

/**
 * Encrypt plaintext → base64 "iv:tag:ciphertext".
 *
 * `aad` (additional authenticated data) binds the ciphertext to the row it
 * belongs to without hiding it: GCM folds it into the auth tag, so the blob can
 * only be decrypted by a caller that presents the same value. Pass the owner's
 * id for per-user secrets — that is what stops one row's ciphertext being
 * replayed as another user's, which matters here because the payload is a
 * YouTube session an attacker would rather substitute than read.
 *
 * Omitting `aad` keeps the pre-binding format byte-for-byte, which is what the
 * single-row global secrets still use (the Settings singleton, as read by
 * settings-validation, the settings export/import routes, oidc.ts and ldap.ts):
 * there is no second row to bind against, and passing something for form's sake
 * would have made every stored value undecryptable on deploy for no gain.
 */
export function encryptSecret(plaintext: string, aad?: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key(), iv);
	if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
	const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

/**
 * Decrypt a payload from {@link encryptSecret}. Throws if tampered, malformed,
 * or encrypted under a different `aad` — a blob written for one owner fails to
 * decrypt for another, which callers already treat as "no usable secret".
 */
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
