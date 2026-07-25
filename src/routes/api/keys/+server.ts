import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { generateApiKey, hashApiKey } from '$lib/server/auth';
import { apiRoute } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/keys',
	'GET',
	{
		summary: 'List API keys',
		tags: ['Auth'],
		auth: true,
		responses: {
			200: {
				description: 'Array of API keys (without the key itself)',
				schema: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							id: { type: 'string' },
							keyPrefix: { type: 'string', description: 'First 14 characters of the key' },
							name: { type: 'string' },
							lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
							createdAt: { type: 'string', format: 'date-time' },
						},
					},
				},
			},
		},
	},
	async ({ locals }) => {
		if (!locals.session?.user?.id) {
			throw error(401, 'Authentication required');
		}

		const keys = await prisma.apiKey.findMany({
			where: { userId: locals.session.user.id },
			select: { id: true, keyPrefix: true, name: true, lastUsedAt: true, createdAt: true },
			orderBy: { createdAt: 'desc' },
		});

		return json(keys);
	},
) satisfies RequestHandler;

export const POST = apiRoute(
	'/api/keys',
	'POST',
	{
		summary: 'Create an API key',
		description: 'The full key is returned only once in the response. Store it securely.',
		tags: ['Auth'],
		auth: true,
		body: {
			name: { type: 'string', required: true, description: 'Display name for the key' },
		},
		responses: {
			201: {
				description: 'Created API key with the full key (shown only once)',
				schema: {
					type: 'object',
					properties: {
						id: { type: 'string' },
						key: {
							type: 'string',
							description: 'The full API key — store this, it will not be shown again',
						},
						keyPrefix: { type: 'string' },
						name: { type: 'string' },
						createdAt: { type: 'string', format: 'date-time' },
					},
				},
			},
		},
	},
	async ({ request, locals }) => {
		if (!locals.session?.user?.id) {
			throw error(401, 'Authentication required');
		}

		const { name } = await request.json();
		if (!name || typeof name !== 'string') {
			throw error(400, 'Name is required');
		}

		const { key, hash, prefix } = generateApiKey();

		const apiKey = await prisma.apiKey.create({
			data: {
				keyHash: hash,
				keyPrefix: prefix,
				name,
				userId: locals.session.user.id,
			},
		});

		return json(
			{
				id: apiKey.id,
				key,
				keyPrefix: prefix,
				name: apiKey.name,
				createdAt: apiKey.createdAt,
			},
			{ status: 201 },
		);
	},
) satisfies RequestHandler;
