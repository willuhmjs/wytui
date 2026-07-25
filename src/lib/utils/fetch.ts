import { page } from '$app/stores';
import { get } from 'svelte/store';

export type FetchErrorType = 'network' | 'timeout' | 'server' | 'client' | 'parse' | 'unknown';

export interface FetchError {
	type: FetchErrorType;
	message: string;
	canRetry: boolean;
	status?: number;
	originalError?: unknown;
}

export interface RequestOptions extends RequestInit {
	timeout?: number;
	retries?: number;
	retryDelay?: number;
}

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 500;

function classifyError(err: unknown, status?: number): FetchError {
	if (status !== undefined) {
		if (status >= 500) {
			return {
				type: 'server',
				message: 'Server error occurred. Please try again in a moment.',
				canRetry: true,
				status,
				originalError: err,
			};
		}
		if (status >= 400) {
			let message = `Request failed (${status}).`;
			if (status === 401) message = 'You need to sign in to do that.';
			else if (status === 403) message = "You don't have permission to do that.";
			else if (status === 404) message = 'The requested resource was not found.';
			else if (status === 409)
				message = 'Conflict with the current state. Please refresh and try again.';
			else if (status === 422) message = 'The submitted data is invalid.';
			else if (status === 429) message = 'Too many requests. Please slow down and try again.';
			return {
				type: 'client',
				message,
				canRetry: false,
				status,
				originalError: err,
			};
		}
	}

	if (err instanceof DOMException && err.name === 'AbortError') {
		return {
			type: 'timeout',
			message: 'Request timed out. Please try again.',
			canRetry: true,
			originalError: err,
		};
	}

	if (err instanceof TypeError) {
		return {
			type: 'network',
			message: 'Connection failed. Check your network and try again.',
			canRetry: true,
			originalError: err,
		};
	}

	return {
		type: 'unknown',
		message: 'Something went wrong. Please try again.',
		canRetry: true,
		originalError: err,
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Return a new options object with the CSRF header applied when appropriate.
 * Reads the current csrfToken from page data and skips safe methods
 * (GET/HEAD/OPTIONS). Does not mutate the caller's options object.
 */
function applyCsrf<T extends RequestInit>(options?: T): T {
	const merged = { ...(options ?? ({} as T)) };
	const csrfToken = get(page).data?.csrfToken;

	if (csrfToken && merged.method && !['GET', 'HEAD', 'OPTIONS'].includes(merged.method)) {
		merged.headers = {
			...merged.headers,
			'x-csrf-token': csrfToken,
		};
	}

	return merged;
}

/**
 * Wrapper around fetch that automatically includes CSRF token
 */
export async function csrfFetch(url: RequestInfo | URL, options?: RequestInit): Promise<Response> {
	return fetch(url, applyCsrf(options));
}

/**
 * Resilient fetch with timeout, retry (exponential backoff), and CSRF.
 * Throws a structured FetchError on failure.
 */
export async function safeFetch(
	url: RequestInfo | URL,
	options: RequestOptions = {},
): Promise<Response> {
	const {
		timeout = DEFAULT_TIMEOUT,
		retries = DEFAULT_RETRIES,
		retryDelay = DEFAULT_RETRY_DELAY,
		...rest
	} = options;

	const fetchOptions = applyCsrf(rest);

	let lastError: FetchError | null = null;

	for (let attempt = 0; attempt <= retries; attempt++) {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeout);

		try {
			const response = await fetch(url, {
				...fetchOptions,
				signal: fetchOptions.signal ?? controller.signal,
			});
			clearTimeout(timeoutId);

			if (!response.ok) {
				const error = classifyError(undefined, response.status);
				if (!error.canRetry || attempt === retries) {
					throw error;
				}
				lastError = error;
				await sleep(retryDelay * Math.pow(2, attempt));
				continue;
			}

			return response;
		} catch (err) {
			clearTimeout(timeoutId);

			if (err && typeof err === 'object' && 'type' in err && 'canRetry' in err) {
				throw err;
			}

			const error = classifyError(err);
			if (!error.canRetry || attempt === retries) {
				throw error;
			}
			lastError = error;
			await sleep(retryDelay * Math.pow(2, attempt));
		}
	}

	throw lastError ?? classifyError(new Error('Request failed'));
}

/**
 * Convenience helper: safeFetch + JSON parse with the same structured errors.
 */
export async function safeFetchJson<T = unknown>(
	url: RequestInfo | URL,
	options: RequestOptions = {},
): Promise<T> {
	const response = await safeFetch(url, options);
	try {
		return (await response.json()) as T;
	} catch (err) {
		throw {
			type: 'parse',
			message: 'Received an invalid response from the server.',
			canRetry: true,
			originalError: err,
		} satisfies FetchError;
	}
}

export function isFetchError(err: unknown): err is FetchError {
	return (
		typeof err === 'object' &&
		err !== null &&
		'type' in err &&
		'message' in err &&
		'canRetry' in err
	);
}
