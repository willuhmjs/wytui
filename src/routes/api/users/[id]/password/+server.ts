import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { hashPassword, validatePassword } from '$lib/server/auth';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const PATCH = apiRoute(
	'/api/users/[id]/password',
	'PATCH',
	{
		summary: 'Change user password',
		description: 'Users can change their own password. Admins can change non-admin passwords.',
		tags: ['Users'],
		auth: true,
		params: { id: { type: 'string', description: 'Target user ID' } },
		body: {
			newPassword: { type: 'string', required: true, description: 'New password' },
		},
		responses: {
			200: {
				description: 'Password changed',
				schema: {
					type: 'object',
					properties: {
						success: { type: 'boolean' },
						message: { type: 'string' },
					},
				},
			},
			404: { description: 'User not found' },
		},
	},
	async ({ params, request, locals }) => {
		try {
			const currentUser = locals.session?.user;
			if (!currentUser) {
				throw error(401, 'Unauthorized');
			}

			const { newPassword } = await request.json();
			const targetUserId = params.id;

			if (!newPassword || typeof newPassword !== 'string') {
				throw error(400, 'Password cannot be empty');
			}

			const passwordValidation = validatePassword(newPassword);
			if (!passwordValidation.valid) {
				throw error(400, passwordValidation.error!);
			}

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

			if (!isChangingOwnPassword && !currentUser.isAdmin) {
				throw error(403, 'You can only change your own password');
			}

			if (isAdminChangingOtherPassword && targetUser.isAdmin) {
				throw error(403, "Cannot change another admin's password");
			}

			const hashedPassword = await hashPassword(newPassword);

			// Update password and set passwordChangedAt for session revocation
			await prisma.user.update({
				where: { id: targetUserId },
				data: {
					password: hashedPassword,
					passwordChangedAt: new Date(), // Revoke all existing sessions
				},
			});

			return json({
				success: true,
				message: 'Password changed successfully. All active sessions have been revoked.',
			});
		} catch (e: any) {
			console.error('Failed to change password:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
