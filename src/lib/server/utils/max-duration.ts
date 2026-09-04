import { error } from '@sveltejs/kit';

export const MAX_DURATION_LIMIT_SECONDS = 2_592_000; // 30 days

/**
 * Normalize a per-subscription max video duration (seconds).
 * null/undefined/0 mean "no limit"; anything else must be a positive integer.
 */
export function normalizeMaxDuration(value: unknown): number | null {
	if (value === null || value === undefined || value === 0) return null;
	const val = Number(value);
	if (!Number.isInteger(val) || val < 1 || val > MAX_DURATION_LIMIT_SECONDS) {
		throw error(
			400,
			`maxDurationSeconds must be null or an integer between 1 and ${MAX_DURATION_LIMIT_SECONDS}`,
		);
	}
	return val;
}
