import { prisma } from './db';
import bcrypt from 'bcrypt';
import type { Cookies } from '@sveltejs/kit';

const SESSION_COOKIE_NAME = 'wytui.session-token';
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

interface SessionUser {
	id: string;
	email: string;
	isAdmin: boolean;
}

/**
 * Issue a signed-in session cookie for the given user.
 */
export function issueSessionCookie(cookies: Cookies, user: SessionUser): void {
	const sessionToken = Buffer.from(
		JSON.stringify({
			userId: user.id,
			email: user.email,
			isAdmin: user.isAdmin,
			exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
		})
	).toString('base64');

	cookies.set(SESSION_COOKIE_NAME, sessionToken, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: process.env.NODE_ENV === 'production',
		maxAge: SESSION_MAX_AGE_SECONDS,
	});
}

/**
 * Hash password with bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
	return bcrypt.hash(password, 10);
}

/**
 * Check if any users exist in the database
 */
export async function hasUsers(): Promise<boolean> {
	const count = await prisma.user.count();
	return count > 0;
}

/**
 * Create first admin user
 */
export async function createFirstAdmin(
	email: string,
	password: string,
	name: string
): Promise<SessionUser> {
	// Check if users already exist
	const userCount = await prisma.user.count();
	if (userCount > 0) {
		throw new Error('Users already exist. Cannot create first admin.');
	}

	// Validate password strength
	if (password.length < 8) {
		throw new Error('Password must be at least 8 characters long');
	}

	// Hash password
	const hashedPassword = await hashPassword(password);

	// Create admin user
	const user = await prisma.user.create({
		data: {
			email,
			password: hashedPassword,
			name,
			isAdmin: true,
			emailVerified: new Date(),
		},
		select: { id: true, email: true, isAdmin: true },
	});

	return user;
}
