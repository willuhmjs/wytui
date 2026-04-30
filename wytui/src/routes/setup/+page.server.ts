import { redirect } from '@sveltejs/kit';
import { isOidcConfigured, getOidcDisplayName } from '$lib/server/oidc';
import { hasUsers } from '$lib/server/auth';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const usersExist = await hasUsers();
	if (usersExist) {
		throw redirect(303, '/');
	}

	return {
		oidcConfigured: isOidcConfigured(),
		oidcDisplayName: isOidcConfigured() ? getOidcDisplayName() : null,
	};
};
