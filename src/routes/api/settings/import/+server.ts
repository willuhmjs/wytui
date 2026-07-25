import { json, error } from '@sveltejs/kit';
import { load } from 'js-yaml';
import { prisma } from '$lib/server/db';
import { apiRoute } from '$lib/server/openapi';
import { requireAdmin } from '$lib/server/guards';
import {
	validateSettingsUpdate,
	applySettingsSideEffects,
	serializeSettingsResponse,
	envManagedSettingsFields,
	SECRET_SETTINGS_FIELDS,
	ENCRYPTED_SETTINGS_FIELDS,
} from '$lib/server/services/settings-validation';
import { decryptSecret } from '$lib/server/utils/crypto-box';
import type { RequestHandler } from './$types';

interface SettingsChange {
	field: string;
	from: unknown;
	to: unknown;
}

function normalize(value: unknown): unknown {
	return typeof value === 'bigint' ? value.toString() : value;
}

function sameValue(a: unknown, b: unknown): boolean {
	if (Array.isArray(a) || Array.isArray(b)) {
		return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
	}
	return a === b;
}

const ENCRYPTED_FIELD_SET: Set<string> = new Set(ENCRYPTED_SETTINGS_FIELDS);

/**
 * Encrypted secrets get a fresh IV on every write, so their ciphertexts never
 * compare equal — decrypt before diffing or they'd always look changed.
 */
function comparable(field: string, value: unknown): unknown {
	if (ENCRYPTED_FIELD_SET.has(field) && typeof value === 'string' && value) {
		try {
			return decryptSecret(value);
		} catch {
			// Legacy plaintext value — compare as-is.
		}
	}
	return value;
}

/** Diff a validated updates object against the currently persisted settings. */
function diffSettings(
	current: Record<string, unknown>,
	updates: Record<string, unknown>,
): SettingsChange[] {
	const changes: SettingsChange[] = [];
	for (const [field, rawTo] of Object.entries(updates)) {
		const from = normalize(comparable(field, current[field])) ?? null;
		const to = normalize(comparable(field, rawTo)) ?? null;
		if (!sameValue(from, to)) {
			// Never echo secret values back in a preview — report set/cleared only.
			if (SECRET_SETTINGS_FIELDS.has(field)) {
				changes.push({
					field,
					from: from ? '***SET***' : null,
					to: to ? '***SET***' : null,
				});
			} else {
				changes.push({ field, from, to });
			}
		}
	}
	return changes;
}

export const POST = apiRoute(
	'/api/settings/import',
	'POST',
	{
		summary: 'Import application settings from YAML',
		description:
			'Admin-only, two-phase. Call with confirm: false (or omitted) to preview the changes a config file would make without writing anything; call again with confirm: true to apply them.',
		tags: ['Settings'],
		auth: 'admin',
		body: {
			yaml: {
				type: 'string',
				description: 'YAML config content (as produced by GET /api/settings/export)',
			},
			confirm: {
				type: 'boolean',
				description: 'Set true to actually persist the change; omit/false to preview only',
			},
		},
		responses: {
			200: {
				description: 'Preview of changes, or the updated settings if confirmed',
				schema: { type: 'object' },
			},
		},
	},
	async ({ request, locals }) => {
		try {
			requireAdmin(locals);

			const body = await request.json();
			if (typeof body.yaml !== 'string' || !body.yaml.trim()) {
				throw error(400, 'Missing yaml content');
			}

			let parsed: unknown;
			try {
				parsed = load(body.yaml);
			} catch (e: any) {
				throw error(400, `Invalid YAML: ${e.message}`);
			}

			if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
				throw error(400, 'Invalid YAML: expected a mapping of settings keys');
			}

			// An export carries every field, including ones this instance pins via env
			// vars. Drop those instead of rejecting the file, and say which were dropped.
			const incoming = { ...(parsed as Record<string, any>) };
			const skipped: string[] = [];
			for (const field of await envManagedSettingsFields()) {
				if (field in incoming) {
					delete incoming[field];
					skipped.push(field);
				}
			}

			// Re-run full validation every time (preview AND confirm) — never trust a
			// client-held preview, since settings may have changed between the two calls.
			const updates = await validateSettingsUpdate(incoming);

			const currentSettings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
			if (!currentSettings) {
				throw error(500, 'Settings not initialized');
			}

			const changes = diffSettings(currentSettings as unknown as Record<string, unknown>, updates);

			if (body.confirm !== true) {
				return json({ preview: true, changes, skipped });
			}

			const settings = await prisma.settings.update({
				where: { id: 'singleton' },
				data: updates,
			});

			await applySettingsSideEffects(updates);

			return json({
				preview: false,
				changes,
				skipped,
				settings: serializeSettingsResponse(settings),
			});
		} catch (e: any) {
			console.error('Failed to import settings:', e);
			if (e.status) throw e;
			throw error(500, 'Internal server error');
		}
	},
) satisfies RequestHandler;
