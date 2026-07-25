import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { join, resolve, normalize } from 'path';
import type { RequestHandler } from './$types';

const COOKIE_DIR = resolve('data');
const COOKIE_FILENAME = 'cookies.txt';

function getCookiePath(): string {
	return join(COOKIE_DIR, COOKIE_FILENAME);
}

/**
 * Validate that the file content looks like a Netscape cookie file.
 * Accepts files starting with the standard header or files with
 * tab-separated cookie lines (domain, flag, path, secure, expiry, name, value).
 */
function validateCookieFile(content: string): boolean {
	const lines = content.split('\n');

	// Check for Netscape header
	const hasHeader = lines.some((line) =>
		line.trim().toLowerCase().includes('netscape http cookie file'),
	);
	if (hasHeader) return true;

	// Otherwise check for tab-separated cookie lines
	const dataLines = lines.filter((line) => {
		const trimmed = line.trim();
		return trimmed.length > 0 && !trimmed.startsWith('#');
	});

	if (dataLines.length === 0) return false;

	// At least one line should have 6+ tab-separated fields
	return dataLines.some((line) => {
		const fields = line.split('\t');
		return fields.length >= 6;
	});
}

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.session?.user?.isAdmin) {
		throw error(403, 'Admin access required');
	}

	const settings = await prisma.settings.findUnique({
		where: { id: 'singleton' },
	});

	return json({
		hasCookies: !!settings?.cookiePath,
		path: settings?.cookiePath || null,
	});
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.session?.user?.isAdmin) {
		throw error(403, 'Admin access required');
	}

	const formData = await request.formData();
	const file = formData.get('file');

	if (!file || !(file instanceof File)) {
		throw error(400, 'No file provided');
	}

	// Size limit: 1MB
	if (file.size > 1024 * 1024) {
		throw error(400, 'File too large (max 1MB)');
	}

	const content = await file.text();

	if (!validateCookieFile(content)) {
		throw error(
			400,
			'Invalid cookie file. Expected a Netscape-format cookies.txt file with tab-separated fields.',
		);
	}

	// Ensure the directory exists
	await mkdir(COOKIE_DIR, { recursive: true });

	const cookiePath = getCookiePath();

	// Validate the resolved path to prevent traversal
	const normalizedPath = normalize(resolve(cookiePath));
	if (!normalizedPath.startsWith(COOKIE_DIR)) {
		throw error(400, 'Invalid cookie path');
	}

	await writeFile(cookiePath, content, { mode: 0o600 });

	await prisma.settings.update({
		where: { id: 'singleton' },
		data: { cookiePath },
	});

	return json({ success: true, path: cookiePath });
};

export const DELETE: RequestHandler = async ({ locals }) => {
	if (!locals.session?.user?.isAdmin) {
		throw error(403, 'Admin access required');
	}

	const settings = await prisma.settings.findUnique({
		where: { id: 'singleton' },
	});

	if (settings?.cookiePath) {
		try {
			await unlink(settings.cookiePath);
		} catch {
			// File may already be gone
		}
	}

	await prisma.settings.update({
		where: { id: 'singleton' },
		data: { cookiePath: null },
	});

	return json({ success: true });
};
