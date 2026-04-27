import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { hashPassword } from '$lib/server/auth';
import type { RequestHandler } from './$types';

/**
 * PATCH /api/users/[id]/password
 * Change user password
 * - Admins can change any non-admin user's password
 * - Users can change their own password
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	try {
		const currentUser = locals.session?.user;
		if (!currentUser) {
			throw error(401, 'Unauthorized');
		}

		const { newPassword } = await request.json();
		const targetUserId = params.id;

		// Basic validation
		if (!newPassword || newPassword.length === 0) {
			throw error(400, 'Password cannot be empty');
		}

		// Get target user
		const targetUser = await prisma.user.findUnique({
			where: { id: targetUserId },
			select: {
				id: true,
				isAdmin: true,
			},
		});

		if (!targetUser) {
			throw error(404, 'User not found');
		}

		const isChangingOwnPassword = currentUser.id === targetUserId;
		const isAdminChangingOtherPassword = currentUser.isAdmin && !isChangingOwnPassword;

		// Authorization checks
		if (!isChangingOwnPassword && !currentUser.isAdmin) {
			throw error(403, 'You can only change your own password');
		}

		// Admins cannot change other admins' passwords
		if (isAdminChangingOtherPassword && targetUser.isAdmin) {
			throw error(403, 'Cannot change another admin\'s password');
		}

		// Hash new password
		const hashedPassword = await hashPassword(newPassword);

		// Update password
		await prisma.user.update({
			where: { id: targetUserId },
			data: { password: hashedPassword },
		});

		return json({ success: true, message: 'Password changed successfully' });
	} catch (e: any) {
		console.error('Failed to change password:', e);
		if (e.status) throw e;
		throw error(500, e.message || 'Failed to change password');
	}
};
