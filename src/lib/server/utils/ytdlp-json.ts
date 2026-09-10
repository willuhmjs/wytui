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

/** Thrown when the process is killed at the hard timeout. Always retryable. */
export class YtdlpTimeoutError extends Error {
	readonly isTimeout = true;
	constructor(msg = 'yt-dlp timed out') {
		super(msg);
		this.name = 'YtdlpTimeoutError';
	}
}

/**
 * Returns true when yt-dlp stderr indicates a YouTube rate limit (HTTP 429).
 * YouTube surfaces these as "HTTP Error 429", "Too Many Requests", or
 * "Sign in to confirm you're not a bot" in certain cookie-less contexts.
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
		s.includes('sign in to confirm')
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
 * Run yt-dlp in flat-JSON mode and resolve its stdout.
 *
 * The `settled` guard matters: without it a process that both times out and
 * later closes would settle the promise twice and leave a dangling timer.
 *
 * Throws {@link RateLimitError} when YouTube responds with HTTP 429.
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
