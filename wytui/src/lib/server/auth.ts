import { prisma } from './db';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import type { Cookies } from '@sveltejs/kit';

const SESSION_COOKIE_NAME = 'wytui.session-token';
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days
if (!process.env.AUTH_SECRET) {
	throw new Error('AUTH_SECRET environment variable is required');
}
const JWT_SECRET: string = process.env.AUTH_SECRET;

export interface SessionUser {
	id: string;
	email: string;
	isAdmin: boolean;
}

export interface SessionPayload {
	userId: string;
	email: string;
	isAdmin: boolean;
	iat: number;
	exp: number;
}

/**
 * Issue a signed-in session cookie for the given user.
 */
export function issueSessionCookie(cookies: Cookies, user: SessionUser): void {
	const sessionToken = jwt.sign(
		{
			userId: user.id,
			email: user.email,
			isAdmin: user.isAdmin,
		},
		JWT_SECRET,
		{
			expiresIn: SESSION_MAX_AGE_SECONDS,
		}
	);

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
		const payload = jwt.verify(token, JWT_SECRET) as SessionPayload;
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
		return { valid: false, error: 'Password must be at least 8 characters long' };
	}

	if (password.length > 128) {
		return { valid: false, error: 'Password must not exceed 128 characters' };
	}

	// Require at least one lowercase letter
	if (!/[a-z]/.test(password)) {
		return {
			valid: false,
			error: 'Password must contain at least one lowercase letter',
		};
	}

	// Require at least one uppercase letter
	if (!/[A-Z]/.test(password)) {
		return {
			valid: false,
			error: 'Password must contain at least one uppercase letter',
		};
	}

	// Require at least one number
	if (!/[0-9]/.test(password)) {
		return {
			valid: false,
			error: 'Password must contain at least one number',
		};
	}

	// Require at least one special character
	if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
		return {
			valid: false,
			error: 'Password must contain at least one special character (!@#$%^&* etc.)',
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
			password: hashedPassword,
			name,
			isAdmin: true,
			emailVerified: new Date(),
		},
		select: { id: true, email: true, isAdmin: true },
	});

	return user;
}
