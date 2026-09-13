import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.session?.user?.isAdmin) {
		throw redirect(302, '/settings/account');
	}
};
