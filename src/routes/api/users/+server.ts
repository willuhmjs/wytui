import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { hashPassword, validatePassword, invalidateUsersCache } from '$lib/server/auth';
import { apiRoute } from '$lib/server/openapi';
import { requireAdmin } from '$lib/server/guards';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/users',
	'GET',
	{
		summary: 'List users (paginated, searchable)',
		tags: ['Users'],
		auth: 'admin',
		query: {
			search: { type: 'string', description: 'Filter by email or name (case-insensitive)' },
			limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
			offset: { type: 'integer', minimum: 0, default: 0 },
		},
		responses: {
			200: {
				description: 'Page of users with total count',
				schema: {
					type: 'object',
					properties: {
						users: { type: 'array', items: { type: 'object' } },
						total: { type: 'integer' },
						limit: { type: 'integer' },
						offset: { type: 'integer' },
					},
				},
			},
		},
	},
	async ({ url, locals }) => {
		try {
			requireAdmin(locals);

			let limit = parseInt(url.searchParams.get('limit') || '25', 10);
			let offset = parseInt(url.searchParams.get('offset') || '0', 10);
			if (isNaN(limit) || limit < 1) limit = 25;
			if (limit > 100) limit = 100;
			if (isNaN(offset) || offset < 0) offset = 0;

			const search = (url.searchParams.get('search') || '').trim();
			const where = search
				? {
						OR: [
							{ email: { contains: search, mode: 'insensitive' as const } },
							{ name: { contains: search, mode: 'insensitive' as const } },
						],
					}
				: {};

			const [users, total] = await Promise.all([
				prisma.user.findMany({
					where,
					select: {
						id: true,
						email: true,
						name: true,
						isAdmin: true,
						libraryAccess: true,
						cacheQuotaBytes: true,
						createdAt: true,
						_count: {
							select: {
								downloads: true,
								subscriptions: true,
							},
						},
					},
					orderBy: { createdAt: 'desc' },
					take: limit,
					skip: offset,
				}),
				prisma.user.count({ where }),
			]);

			return json({
				users: users.map((u) => ({ ...u, cacheQuotaBytes: u.cacheQuotaBytes?.toString() ?? null })),
				total,
				limit,
				offset,
			});
		} catch (e: any) {
			console.error('Failed to list users:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;

export const POST = apiRoute(
	'/api/users',
	'POST',
	{
		summary: 'Create a new user',
		tags: ['Users'],
		auth: 'admin',
		body: {
			email: { type: 'string', required: true, description: 'User email' },
			username: {
				type: 'string',
				description: 'Optional login handle (login accepts email or username)',
			},
			password: { type: 'string', required: true, description: 'User password' },
			name: { type: 'string', required: true, description: 'Display name' },
			isAdmin: { type: 'boolean', description: 'Grant admin privileges' },
		},
		responses: {
			201: {
				description: 'Created user',
				schema: {
					type: 'object',
					properties: {
						id: { type: 'string' },
						email: { type: 'string' },
						name: { type: 'string' },
						isAdmin: { type: 'boolean' },
						createdAt: { type: 'string', format: 'date-time' },
					},
				},
			},
			400: { description: 'Invalid input or user exists' },
		},
	},
	async ({ request, locals }) => {
		try {
			requireAdmin(locals);

			const { email, username, password, name, isAdmin } = await request.json();

			if (!email || !password || !name) {
				throw error(400, 'Email, password, and name are required');
			}

			const passwordValidation = validatePassword(password);
			if (!passwordValidation.valid) {
				throw error(400, passwordValidation.error!);
			}

			const existing = await prisma.user.findUnique({
				where: { email },
			});

			if (existing) {
				throw error(400, 'User with this email already exists');
			}

			const normalizedUsername =
				typeof username === 'string' && username.trim() ? username.trim() : null;
			if (normalizedUsername) {
				const existingUsername = await prisma.user.findUnique({
					where: { username: normalizedUsername },
				});
				if (existingUsername) {
					throw error(400, 'User with this username already exists');
				}
			}

			const hashedPassword = await hashPassword(password);

			const user = await prisma.user.create({
				data: {
					email,
					username: normalizedUsername,
					password: hashedPassword,
					name,
					isAdmin: isAdmin || false,
				},
				select: {
					id: true,
					email: true,
					username: true,
					name: true,
					isAdmin: true,
					createdAt: true,
				},
			});

			invalidateUsersCache();
			return json(user, { status: 201 });
		} catch (e: any) {
			console.error('Failed to create user:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
