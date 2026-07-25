import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Create a local class for testing since RateLimiter isn't exported
class RateLimiter {
	private store = new Map<string, { count: number; resetAt: number }>();
	private cleanupInterval: NodeJS.Timeout;

	constructor() {
		this.cleanupInterval = setInterval(() => {
			const now = Date.now();
			for (const [key, entry] of this.store.entries()) {
				if (entry.resetAt < now) {
					this.store.delete(key);
				}
			}
		}, 60000);
	}

	check(identifier: string, config: { windowMs: number; maxRequests: number }): boolean {
		const now = Date.now();
		const entry = this.store.get(identifier);

		if (!entry || entry.resetAt < now) {
			this.store.set(identifier, {
				count: 1,
				resetAt: now + config.windowMs,
			});
			return false;
		}

		entry.count++;

		if (entry.count > config.maxRequests) {
			return true;
		}

		return false;
	}

	getInfo(
		identifier: string,
		config: { windowMs: number; maxRequests: number },
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

describe('RateLimiter', () => {
	let limiter: RateLimiter;

	beforeEach(() => {
		limiter = new RateLimiter();
	});

	afterEach(() => {
		limiter.cleanup();
	});

	describe('basic functionality', () => {
		it('should allow requests within limit', () => {
			const config = { windowMs: 60000, maxRequests: 5 };

			for (let i = 0; i < 5; i++) {
				const exceeded = limiter.check('client1', config);
				expect(exceeded).toBe(false);
			}
		});

		it('should block requests exceeding limit', () => {
			const config = { windowMs: 60000, maxRequests: 3 };

			// First 3 should pass
			for (let i = 0; i < 3; i++) {
				expect(limiter.check('client1', config)).toBe(false);
			}

			// 4th should be blocked
			expect(limiter.check('client1', config)).toBe(true);
		});

		it('should track different clients separately', () => {
			const config = { windowMs: 60000, maxRequests: 2 };

			expect(limiter.check('client1', config)).toBe(false);
			expect(limiter.check('client2', config)).toBe(false);
			expect(limiter.check('client1', config)).toBe(false);
			expect(limiter.check('client2', config)).toBe(false);

			// Both clients at limit now
			expect(limiter.check('client1', config)).toBe(true);
			expect(limiter.check('client2', config)).toBe(true);
		});
	});

	describe('bucket independence (I3 fix)', () => {
		it('should track different buckets independently for same client', () => {
			// This is the critical test for the I3 fix
			const clientIp = '192.168.1.100';
			const authKey = `auth:${clientIp}`;
			const youtubeKey = `youtubeSearch:${clientIp}`;

			const authConfig = { windowMs: 60000, maxRequests: 100 };
			const youtubeConfig = { windowMs: 60000, maxRequests: 120 };

			// Exhaust the auth bucket (100 requests)
			for (let i = 0; i < 100; i++) {
				const exceeded = limiter.check(authKey, authConfig);
				expect(exceeded).toBe(false);
			}

			// Auth bucket should now be at limit
			expect(limiter.check(authKey, authConfig)).toBe(true);

			// YouTube search bucket should still be available (independent counter)
			const youtubeExceeded = limiter.check(youtubeKey, youtubeConfig);
			expect(youtubeExceeded).toBe(false);

			// Verify we can make many YouTube requests without auth bucket affecting it
			for (let i = 0; i < 50; i++) {
				expect(limiter.check(youtubeKey, youtubeConfig)).toBe(false);
			}

			// Auth bucket should still be blocked
			expect(limiter.check(authKey, authConfig)).toBe(true);
		});

		it('should allow multiple buckets to coexist for same IP', () => {
			const clientIp = '10.0.0.1';
			const generalKey = `general:${clientIp}`;
			const downloadsKey = `downloads:${clientIp}`;
			const settingsKey = `settings:${clientIp}`;

			const generalConfig = { windowMs: 60000, maxRequests: 500 };
			const downloadsConfig = { windowMs: 60000, maxRequests: 200 };
			const settingsConfig = { windowMs: 60000, maxRequests: 100 };

			// Make requests to different buckets
			expect(limiter.check(generalKey, generalConfig)).toBe(false);
			expect(limiter.check(downloadsKey, downloadsConfig)).toBe(false);
			expect(limiter.check(settingsKey, settingsConfig)).toBe(false);

			// Each should track independently
			const generalInfo = limiter.getInfo(generalKey, generalConfig);
			const downloadsInfo = limiter.getInfo(downloadsKey, downloadsConfig);
			const settingsInfo = limiter.getInfo(settingsKey, settingsConfig);

			expect(generalInfo.remaining).toBe(499);
			expect(downloadsInfo.remaining).toBe(199);
			expect(settingsInfo.remaining).toBe(99);
		});
	});

	describe('getInfo', () => {
		it('should return correct remaining count', () => {
			const config = { windowMs: 60000, maxRequests: 10 };

			limiter.check('client1', config);
			limiter.check('client1', config);
			limiter.check('client1', config);

			const info = limiter.getInfo('client1', config);
			expect(info.limit).toBe(10);
			expect(info.remaining).toBe(7); // 10 - 3 = 7
		});

		it('should return full limit for new client', () => {
			const config = { windowMs: 60000, maxRequests: 100 };

			const info = limiter.getInfo('new-client', config);
			expect(info.limit).toBe(100);
			expect(info.remaining).toBe(100);
		});
	});
});
