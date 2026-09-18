import { AsyncLocalStorage } from 'node:async_hooks';

type ActingUser = {
	id: string;
	name?: string;
	email?: string;
	isAdmin?: boolean;
};

type RequestContext = {
	actingUser?: ActingUser;
};

// Request-scoped storage for the authenticated user. Services that need to
// know "who is acting" (event-log attribution) read it from here instead of
// every route threading `locals.session` down through the service stack.
const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(fn: () => T): T {
	return storage.run({}, fn);
}

/**
 * Record the authenticated user for the remainder of the current request.
 * No-op outside runWithRequestContext (e.g. if called from background work).
 */
export function setActingUser(user: ActingUser): void {
	const store = storage.getStore();
	if (store) store.actingUser = user;
}

/**
 * The user performing the current request, if any. Background work (queue
 * jobs, schedulers, cache eviction) runs outside any request context and
 * gets undefined — callers fall back to their own subject attribution.
 */
export function getActingUserId(): string | undefined {
	return storage.getStore()?.actingUser?.id;
}
