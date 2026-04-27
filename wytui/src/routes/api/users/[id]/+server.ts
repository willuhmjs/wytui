import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import type { RequestHandler } from './$types';

/**
 * PATCH /api/users/[id]
 * Update user (admin only)
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	try {
		// Check if user is admin
		if (!locals.session?.user?.isAdmin) {
			throw error(403, 'Admin access required');
		}

		const updates = await request.json();

		// Prevent demoting the last admin (including self-demotion when you're the last admin)
		if (updates.isAdmin === false) {
			const adminCount = await prisma.user.count({
				where: { isAdmin: true },
			});

			if (adminCount <= 1) {
				throw error(400, 'Cannot demote the last admin');
			}
		}

		const user = await prisma.user.update({
			where: { id: params.id },
			data: {
				name: updates.name,
				isAdmin: updates.isAdmin,
			},
			select: {
				id: true,
				email: true,
				name: true,
				isAdmin: true,
				createdAt: true,
			},
		});

		return json(user);
	} catch (e: any) {
		console.error('Failed to update user:', e);
		if (e.status) throw e;
		throw error(500, e.message || 'Failed to update user');
	}
};

/**
 * DELETE /api/users/[id]
 * Delete user (admin only)
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	try {
		// Check if user is admin
		if (!locals.session?.user?.isAdmin) {
			throw error(403, 'Admin access required');
		}

		// Prevent users from deleting themselves
		if (params.id === locals.session.user.id) {
			throw error(400, 'Cannot delete yourself');
		}

		// Check if user is admin
		const user = await prisma.user.findUnique({
			where: { id: params.id },
		});

		if (user?.isAdmin) {
			// Prevent deleting the last admin
			const adminCount = await prisma.user.count({
				where: { isAdmin: true },
			});

			if (adminCount <= 1) {
				throw error(400, 'Cannot delete the last admin');
			}
		}

		// Delete user
		await prisma.user.delete({
			where: { id: params.id },
		});

		return json({ success: true });
	} catch (e: any) {
		console.error('Failed to delete user:', e);
		if (e.status) throw e;
		throw error(500, e.message || 'Failed to delete user');
	}
};
