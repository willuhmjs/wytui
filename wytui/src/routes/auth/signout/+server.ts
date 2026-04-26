import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
	// Clear session cookie
	cookies.delete('wytui.session-token', { path: '/' });

	// Redirect to signin
	throw redirect(303, '/auth/signin');
};

export const GET: RequestHandler = async ({ cookies }) => {
	// Clear session cookie
	cookies.delete('wytui.session-token', { path: '/' });

	// Redirect to signin
	throw redirect(303, '/auth/signin');
};
