import { prisma } from './db';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'crypto';
import type { Cookies } from '@sveltejs/kit';

const SESSION_COOKIE_NAME = 'wytui.session-token';
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days
function getJwtSecret(): string {
	const secret = process.env.AUTH_SECRET;
	if (!secret) {
		throw new Error('AUTH_SECRET environment variable is required');
	}
	return secret;
}

export interface SessionUser {
	id: string;
	email: string;
	isAdmin: boolean;
	passwordChangedAt?: Date | null;
}

export interface SessionPayload {
	userId: string;
	email: string;
	isAdmin: boolean;
	passwordChangedAt?: number; // Unix timestamp
	iat: number;
	exp: number;
}

/**
 * Issue a signed-in session cookie for the given user.
 */
export function issueSessionCookie(cookies: Cookies, user: SessionUser): void {
	const payload: any = {
		userId: user.id,
		email: user.email,
		isAdmin: user.isAdmin,
	};

	// Include password changed timestamp for session revocation
	if (user.passwordChangedAt) {
		payload.passwordChangedAt = Math.floor(user.passwordChangedAt.getTime() / 1000);
	}

	const sessionToken = jwt.sign(payload, getJwtSecret(), {
		expiresIn: SESSION_MAX_AGE_SECONDS,
	});

	cookies.set(SESSION_COOKIE_NAME, sessionToken, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: process.env.NODE_ENV === 'production',
		maxAge: SESSION_MAX_AGE_SECONDS,
	});
}

/**
 * Verify and decode a session token
 */
export function verifySessionToken(token: string): SessionPayload | null {
	try {
		const payload = jwt.verify(token, getJwtSecret()) as SessionPayload;
		return payload;
	} catch (error) {
		console.error('Invalid session token:', error);
		return null;
	}
}

/**
 * Validate password strength
 */
export function validatePassword(password: string): { valid: boolean; error?: string } {
	if (password.length < 8) {
		return { valid: false, error: 'Password must be at least 8 characters' };
	}

	if (password.length > 128) {
		return { valid: false, error: 'Password must not exceed 128 characters' };
	}

	// Check for common weak passwords
	const weakPasswords = [
		'password',
		'password123',
		'Password1',
		'Password123',
		'12345678',
		'123456789',
		'1234567890',
		'qwerty',
		'qwertyuiop',
		'admin',
		'admin123',
		'letmein',
		'welcome',
		'welcome123',
	];

	if (weakPasswords.includes(password.toLowerCase())) {
		return { valid: false, error: 'Password is too common. Please choose a stronger password.' };
	}

	// Require at least 3 of: uppercase, lowercase, digit, special character
	const hasLower = /[a-z]/.test(password);
	const hasUpper = /[A-Z]/.test(password);
	const hasDigit = /[0-9]/.test(password);
	const hasSpecial = /[^a-zA-Z0-9]/.test(password);

	const complexityCount = [hasLower, hasUpper, hasDigit, hasSpecial].filter(Boolean).length;

	if (complexityCount < 3) {
		return {
			valid: false,
			error:
				'Password must include at least 3 of: uppercase letters, lowercase letters, digits, special characters',
		};
	}

	return { valid: true };
}

/**
 * Hash password with bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
	return bcrypt.hash(password, 10);
}

let usersExistCache: boolean | null = null;

/**
 * Check if any users exist in the database (cached after first user creation)
 */
export async function hasUsers(): Promise<boolean> {
	if (usersExistCache === true) return true;
	const count = await prisma.user.count();
	usersExistCache = count > 0;
	return usersExistCache;
}

export function invalidateUsersCache(): void {
	usersExistCache = null;
}

export function hashApiKey(key: string): string {
	return createHash('sha256').update(key).digest('hex');
}

export function generateApiKey(): { key: string; hash: string; prefix: string } {
	const key = `wytui_${randomBytes(32).toString('hex')}`;
	const hash = hashApiKey(key);
	const prefix = key.slice(0, 14);
	return { key, hash, prefix };
}

export async function resolveApiKey(key: string): Promise<SessionUser | null> {
	const hash = hashApiKey(key);
	const apiKey = await prisma.apiKey.findUnique({
		where: { keyHash: hash },
		include: { user: true },
	});
	if (!apiKey) return null;

	prisma.apiKey
		.update({
			where: { id: apiKey.id },
			data: { lastUsedAt: new Date() },
		})
		.catch(() => {});

	// API keys never grant admin privileges, even when the owner is an admin.
	// Admin actions require an interactive session (least privilege for keys).
	return {
		id: apiKey.user.id,
		email: apiKey.user.email,
		isAdmin: false,
	};
}

/**
 * Create first admin user
 */
export async function createFirstAdmin(
	email: string,
	password: string,
	name: string,
	username?: string | null,
): Promise<SessionUser> {
	// Check if users already exist
	const userCount = await prisma.user.count();
	if (userCount > 0) {
		throw new Error('Users already exist. Cannot create first admin.');
	}

	// Validate password strength
	const passwordValidation = validatePassword(password);
	if (!passwordValidation.valid) {
		throw new Error(passwordValidation.error);
	}

	// Hash password
	const hashedPassword = await hashPassword(password);

	// Create admin user
	const user = await prisma.user.create({
		data: {
			email,
			username: username?.trim() || null,
			password: hashedPassword,
			name,
			isAdmin: true,
			emailVerified: new Date(),
		},
		select: { id: true, email: true, isAdmin: true },
	});

	return user;
}
