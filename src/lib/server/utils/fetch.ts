import { Agent } from 'undici';

const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

/**
 * fetch() variant for internal/homelab services that may use self-signed or
 * private-CA certificates not trusted by Node's default CA bundle.
 */
export function internalFetch(url: string | URL, init?: RequestInit): Promise<Response> {
	return fetch(url, { ...init, dispatcher: insecureAgent } as RequestInit & {
		dispatcher: unknown;
	});
}
