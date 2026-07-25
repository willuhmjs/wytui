import { error } from '@sveltejs/kit';
import { dump } from 'js-yaml';
import { prisma } from '$lib/server/db';
import { apiRoute } from '$lib/server/openapi';
import { requireAdmin } from '$lib/server/guards';
import {
	ALLOWED_SETTINGS_FIELDS,
	ENCRYPTED_SETTINGS_FIELDS,
} from '$lib/server/services/settings-validation';
import { decryptSecret } from '$lib/server/utils/crypto-box';
import type { RequestHandler } from './$types';

export const GET = apiRoute(
	'/api/settings/export',
	'GET',
	{
		summary: 'Export application settings as YAML',
		description:
			'Admin-only. Downloads the full settings config as a YAML file, including secret values in plaintext (API keys, tokens, passwords) — store the file securely.',
		tags: ['Settings'],
		auth: 'admin',
		responses: {
			200: {
				description: 'YAML file containing all importable settings fields',
				schema: { type: 'string' },
			},
		},
	},
	async ({ locals }) => {
		try {
			requireAdmin(locals);

			let settings = await prisma.settings.findUnique({
				where: { id: 'singleton' },
			});

			if (!settings) {
				settings = await prisma.settings.create({
					data: { id: 'singleton' },
				});
			}

			const exportable: Record<string, unknown> = {};
			for (const field of ALLOWED_SETTINGS_FIELDS) {
				const value = (settings as Record<string, unknown>)[field];
				exportable[field] = typeof value === 'bigint' ? value.toString() : value;
			}

			// Secrets held encrypted at rest are exported in plaintext so the file can be
			// re-imported (import re-encrypts under the target instance's AUTH_SECRET).
			for (const field of ENCRYPTED_SETTINGS_FIELDS) {
				const value = exportable[field];
				if (typeof value === 'string' && value) {
					try {
						exportable[field] = decryptSecret(value);
					} catch {
						// Legacy plaintext value — export as-is.
					}
				}
			}

			const header = `# wytui config export\n# exported: ${new Date().toISOString()}\n\n`;
			const yamlBody = dump(exportable, { sortKeys: true });
			const date = new Date().toISOString().slice(0, 10);

			return new Response(header + yamlBody, {
				headers: {
					'Content-Type': 'application/yaml; charset=utf-8',
					'Content-Disposition': `attachment; filename="wytui-config-${date}.yaml"`,
				},
			});
		} catch (e: any) {
			console.error('Failed to export settings:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
