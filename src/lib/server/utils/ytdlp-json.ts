import { spawn } from 'child_process';

const YTDLP = process.env.YTDLP_PATH || '/usr/local/bin/yt-dlp';

export interface RunYtdlpJsonOptions {
	/** Netscape cookie file path. Omit for anonymous requests. */
	cookiePath?: string | null;
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
 * Run yt-dlp in flat-JSON mode and resolve its stdout.
 *
 * The `settled` guard matters: without it a process that both times out and
 * later closes would settle the promise twice and leave a dangling timer.
 *
 * Throws {@link RateLimitError} when YouTube responds with HTTP 429.
 */
export function runYtdlpJson(target: string, opts: RunYtdlpJsonOptions = {}): Promise<string> {
	const { cookiePath = null, timeoutMs = 120000, extraArgs = [] } = opts;

	return new Promise((resolve, reject) => {
		const args = [
			'--flat-playlist',
			'--dump-single-json',
			'--no-warnings',
			...(cookiePath ? ['--cookies', cookiePath] : []),
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
			reject(new Error('yt-dlp timed out'));
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
			} else {
				reject(new Error(err || `yt-dlp exit ${code}`));
			}
		});
	});
}
