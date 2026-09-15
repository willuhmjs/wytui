/**
 * Global rate-limit cooldown shared by every path that talks to YouTube
 * (subscription checks, playlist fetches, downloads). When any path detects a
 * 429 / bot-check, it arms the cooldown; background checks then back off
 * instead of hammering YouTube further. Lives in its own module so services
 * with cyclic import relationships (e.g. youtube.service ↔ subscription
 * boundaries) can share it.
 */
const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;

let cooldownUntil = 0;

export function armRateLimitCooldown(ms: number = DEFAULT_COOLDOWN_MS): void {
	cooldownUntil = Date.now() + ms;
}

export function isRateLimitCooldownActive(): boolean {
	return Date.now() < cooldownUntil;
}

export function getRateLimitCooldownUntil(): number {
	return cooldownUntil;
}

/** Test helper: clear the cooldown. */
export function resetRateLimitCooldown(): void {
	cooldownUntil = 0;
}
