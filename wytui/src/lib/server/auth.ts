import { prisma } from './db';
import bcrypt from 'bcrypt';

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
): Promise<void> {
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
	await prisma.user.create({
		data: {
			email,
			password: hashedPassword,
			name,
			isAdmin: true,
			emailVerified: new Date(),
		},
	});
}
