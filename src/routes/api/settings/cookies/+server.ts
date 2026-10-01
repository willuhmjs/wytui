import { json, error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { eventLogService, EventTypes } from '$lib/server/services/event-log.service';
import { downloadService } from '$lib/server/services/download.service';
import { computeCookieStatus } from '$lib/server/utils/cookie-status';
import { encryptSecret } from '$lib/server/utils/crypto-box';
import type { RequestHandler } from './$types';

/** Uploads are small text files; anything bigger is not a cookies.txt. */
const MAX_COOKIE_BYTES = 1024 * 1024;

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

/** Effective cookie state for the requesting admin (see computeCookieStatus). */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.session?.user?.isAdmin) {
		throw error(403, 'Admin access required');
	}

	return json(await computeCookieStatus(locals.session.user.id));
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

	if (file.size > MAX_COOKIE_BYTES) {
		throw error(400, 'File too large (max 1MB)');
	}

	const content = await file.text();

	if (!validateCookieFile(content)) {
		throw error(
			400,
			'Invalid cookie file. Expected a Netscape-format cookies.txt file with tab-separated fields.',
		);
	}

	await prisma.settings.update({
		where: { id: 'singleton' },
		data: { cookiesTxtEnc: encryptSecret(content), cookiesUpdatedAt: new Date() },
	});

	eventLogService
		.record(EventTypes.COOKIES_UPDATED, 'Cookie file uploaded', locals.session.user.id)
		.catch(() => {});

	// New credentials invalidate the earlier auth failures, so those rows get a
	// fresh auto-heal budget — armed only, the paced heal job drains them. Every
	// user's rows: this is the server-wide fallback credential, unlike an account
	// re-link, which arms one user's.
	let armedForRetry = 0;
	try {
		armedForRetry = await downloadService.armCookieGatedFailures();
	} catch (e) {
		console.error('Failed to arm cookie-gated failures for retry:', e);
	}

	return json({ success: true, armedForRetry });
};

export const DELETE: RequestHandler = async ({ locals }) => {
	if (!locals.session?.user?.isAdmin) {
		throw error(403, 'Admin access required');
	}

	await prisma.settings.update({
		where: { id: 'singleton' },
		data: { cookiesTxtEnc: null, cookiesUpdatedAt: null },
	});

	eventLogService
		.record(EventTypes.COOKIES_UPDATED, 'Cookie file removed', locals.session.user.id)
		.catch(() => {});

	return json({ success: true });
};
