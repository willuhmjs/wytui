import { spawn } from 'child_process';

const YTDLP = process.env.YTDLP_PATH || '/usr/local/bin/yt-dlp';

export interface RunYtdlpJsonOptions {
	/** Netscape cookie file path. Omit for anonymous requests. */
	cookiePath?: string | null;
	/** Outbound proxy URL (http(s)/socks4/socks5/socks5h). */
	proxyUrl?: string | null;
	/** Hard kill after this many ms. Defaults to 120s. */
	timeoutMs?: number;
	/** Extra flags inserted after the base args, before the target. */
	extraArgs?: string[];
}

/** Thrown when YouTube returns HTTP 429 or similar rate-limit signals. */
export class RateLimitError extends Error {
	readonly isRateLimit = true;
	constructor(msg = 'YouTube rate limit reached') {
		super(msg);
		this.name = 'RateLimitError';
	}
}

/**
 * Thrown when yt-dlp stderr indicates the stored cookies no longer authorize
 * the account (dead session, terminated account) — the only condition that
 * legitimately requires re-linking the account.
 */
export class YtdlpAuthError extends Error {
	readonly isAuthError = true;
	constructor(msg: string) {
		super(msg);
		this.name = 'YtdlpAuthError';
	}
}

/**
 * Thrown when yt-dlp stderr indicates an age-restricted video: it needs an
 * age-verified account's cookies, which is a per-video condition — NOT an
 * IP-wide rate limit, so it must never arm the shared cooldown.
 */
export class AgeRestrictedError extends Error {
	readonly isAgeRestricted = true;
	constructor(msg: string) {
		super(msg);
		this.name = 'AgeRestrictedError';
	}
}

/** Thrown when the process is killed at the hard timeout. Always retryable. */
export class YtdlpTimeoutError extends Error {
	readonly isTimeout = true;
	constructor(msg = 'yt-dlp timed out') {
		super(msg);
		this.name = 'YtdlpTimeoutError';
	}
}

/**
 * Returns true when yt-dlp stderr indicates an age-restricted video.
 */
export function isAgeRestrictedError(stderr: string): boolean {
	return stderr.toLowerCase().includes('sign in to confirm your age');
}

/**
 * Returns true when yt-dlp stderr indicates a YouTube rate limit (HTTP 429).
 * YouTube surfaces these as "HTTP Error 429", "Too Many Requests", or
 * "Sign in to confirm you're not a bot" in certain cookie-less contexts.
 * Age-restriction prompts ("Sign in to confirm your age") share the "sign in
 * to confirm" wording but are a different, per-video condition — see
 * {@link isAgeRestrictedError}.
 */
export function isRateLimitedError(stderr: string): boolean {
	const s = stderr.toLowerCase();
	return (
		s.includes('http error 429') ||
		s.includes('too many requests') ||
		s.includes('rate limit') ||
		s.includes('ratelimit') ||
		/\berror 429\b/.test(s) ||
		// YouTube sometimes blocks anonymous yt-dlp with this message
		(s.includes('sign in to confirm') && !isAgeRestrictedError(s))
	);
}

/**
 * Returns true when yt-dlp stderr indicates the cookies are no longer valid
 * for the account. Only these errors mean "re-link your account" — network
 * blips, proxy failures, and timeouts must not be reported as expired
 * sessions.
 */
export function isAuthError(stderr: string): boolean {
	const s = stderr.toLowerCase();
	return (
		s.includes('account has been terminated') ||
		s.includes('account has been suspended') ||
		s.includes('account is not available') ||
		s.includes('please sign in') ||
		s.includes('log in to confirm')
	);
}

/**
 * Returns true when yt-dlp stderr indicates the stored cookies failed to
 * authorize the request — dead session, members-only content the account
 * can't access, or a bot-check the session didn't satisfy. These are the
 * failures that mean "the cookie file is no longer working"; the downloads
 * themselves are the check, so there is no proactive expiry parsing.
 *
 * Age-restriction is deliberately excluded: it is a per-video condition
 * (the account simply isn't age-verified), not a cookie failure.
 */
export function isCookieFailureError(stderr: string): boolean {
	if (isAgeRestrictedError(stderr)) return false;
	const s = stderr.toLowerCase();
	return (
		isAuthError(s) ||
		s.includes("sign in to confirm you're not a bot") ||
		s.includes('members-only') ||
		s.includes('members only') ||
		s.includes('join this channel') ||
		s.includes('available to members') ||
		s.includes('requires you to sign in')
	);
}

/**
 * Run yt-dlp in flat-JSON mode and resolve its stdout.
 *
 * The `settled` guard matters: without it a process that both times out and
 * later closes would settle the promise twice and leave a dangling timer.
 *
 * Throws {@link RateLimitError} when YouTube responds with HTTP 429 and
 * {@link AgeRestrictedError} for age-gated videos.
 */
export function runYtdlpJson(target: string, opts: RunYtdlpJsonOptions = {}): Promise<string> {
	const { cookiePath = null, proxyUrl = null, timeoutMs = 120000, extraArgs = [] } = opts;

	return new Promise((resolve, reject) => {
		const args = [
			'--flat-playlist',
			'--dump-single-json',
			'--no-warnings',
			...(cookiePath ? ['--cookies', cookiePath] : []),
			...(proxyUrl ? ['--proxy', proxyUrl] : []),
			...extraArgs,
			target,
		];
		const p = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		let out = '';
		let err = '';
		let settled = false;

		const timeout = setTimeout(() => {
			if (settled) return;
			settled = true;
			try {
				p.kill('SIGKILL');
			} catch {}
			reject(new YtdlpTimeoutError());
		}, timeoutMs);

		p.stdout.on('data', (c) => (out += c.toString()));
		p.stderr.on('data', (c) => (err += c.toString()));
		p.on('error', (e) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			reject(e);
		});
		p.on('close', (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (code === 0) {
				resolve(out);
			} else if (isAgeRestrictedError(err)) {
				reject(new AgeRestrictedError(err.trim() || 'Age-restricted video'));
			} else if (isRateLimitedError(err)) {
				reject(new RateLimitError(err.trim() || 'YouTube rate limit (HTTP 429)'));
			} else if (isAuthError(err)) {
				reject(new YtdlpAuthError(err.trim() || 'YouTube session expired'));
			} else {
				reject(new Error(err.trim() || `yt-dlp exit ${code}`));
			}
		});
	});
}
