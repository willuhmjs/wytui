import type { RequestEvent } from '@sveltejs/kit';

interface RateLimitEntry {
	count: number;
	resetAt: number;
}

interface RateLimitConfig {
	windowMs: number;
	maxRequests: number;
}

class RateLimiter {
	private store = new Map<string, RateLimitEntry>();
	private cleanupInterval: NodeJS.Timeout;

	constructor() {
		// Clean up expired entries every minute
		this.cleanupInterval = setInterval(() => {
			const now = Date.now();
			for (const [key, entry] of this.store.entries()) {
				if (entry.resetAt < now) {
					this.store.delete(key);
				}
			}
		}, 60000);
	}

	/**
	 * Check if request should be rate limited
	 * Returns true if rate limit exceeded, false otherwise
	 */
	check(identifier: string, config: RateLimitConfig): boolean {
		const now = Date.now();
		const entry = this.store.get(identifier);

		if (!entry || entry.resetAt < now) {
			// New window or expired
			this.store.set(identifier, {
				count: 1,
				resetAt: now + config.windowMs,
			});
			return false;
		}

		// Increment count
		entry.count++;

		if (entry.count > config.maxRequests) {
			return true; // Rate limit exceeded
		}

		return false;
	}

	/**
	 * Get rate limit info for response headers
	 */
	getInfo(
		identifier: string,
		config: RateLimitConfig,
	): {
		limit: number;
		remaining: number;
		reset: number;
	} {
		const entry = this.store.get(identifier);
		const now = Date.now();

		if (!entry || entry.resetAt < now) {
			return {
				limit: config.maxRequests,
				remaining: config.maxRequests,
				reset: now + config.windowMs,
			};
		}

		return {
			limit: config.maxRequests,
			remaining: Math.max(0, config.maxRequests - entry.count),
			reset: entry.resetAt,
		};
	}

	cleanup() {
		clearInterval(this.cleanupInterval);
		this.store.clear();
	}
}

// Global rate limiter instance
export const rateLimiter = new RateLimiter();

// Rate limit configurations for different endpoints
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
	auth: {
		windowMs: 60 * 1000,
		maxRequests: 100,
	},
	downloads: {
		windowMs: 60 * 1000,
		maxRequests: 200,
	},
	settings: {
		windowMs: 60 * 1000,
		maxRequests: 100,
	},
	// Each uncached search spawns a yt-dlp process. Cache hits count against
	// this too (the hook runs before the handler and cannot tell), so the
	// budget has to accommodate filter-fiddling, which is mostly cache hits.
	youtubeSearch: {
		windowMs: 60 * 1000,
		maxRequests: 120,
	},
	// Playlist/subscription/history/watch-later routes each spawn one or more
	// yt-dlp processes per request (playlist sync fans out to one call per
	// selected playlist), and some support a cache-bypassing `refresh` flag.
	// Kept far below `general` so this can't be used to hammer yt-dlp/YouTube.
	youtubeScrape: {
		windowMs: 60 * 1000,
		maxRequests: 30,
	},
	general: {
		windowMs: 60 * 1000,
		maxRequests: 500,
	},
};

/**
 * Get client identifier for rate limiting (IP address + user agent)
 */
export function getClientIdentifier(event: RequestEvent): string {
	// Key on IP only. Including the client-controlled User-Agent let a single
	// IP mint unlimited buckets (rotate UA) and defeated brute-force throttling.
	const forwarded = event.request.headers.get('x-forwarded-for');
	return forwarded ? forwarded.split(',')[0].trim() : event.getClientAddress();
}

/**
 * Check rate limit for a request
 * Throws 429 error if rate limit exceeded
 */
export function checkRateLimit(
	event: RequestEvent,
	config: RateLimitConfig,
	identifier?: string,
): void {
	const clientId = identifier || getClientIdentifier(event);
	const isExceeded = rateLimiter.check(clientId, config);

	if (isExceeded) {
		const info = rateLimiter.getInfo(clientId, config);
		throw new Error(
			`Rate limit exceeded. Try again in ${Math.ceil((info.reset - Date.now()) / 1000)} seconds.`,
		);
	}
}
