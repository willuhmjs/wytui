import { redirect } from '@sveltejs/kit';
import * as client from 'openid-client';
import { getOidcConfig, isOidcConfigured } from '$lib/server/oidc';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	if (!isOidcConfigured()) {
		throw redirect(303, '/auth/signin');
	}

	const config = await getOidcConfig();

	const state = client.randomState();
	const nonce = client.randomNonce();
	const codeVerifier = client.randomPKCECodeVerifier();
	const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

	const redirectUri = `${url.origin}/auth/oidc/callback`;

	const authorizationUrl = client.buildAuthorizationUrl(config, {
		redirect_uri: redirectUri,
		scope: 'openid email profile',
		state,
		nonce,
		code_challenge: codeChallenge,
		code_challenge_method: 'S256',
	});

	const cookieOpts = {
		path: '/',
		httpOnly: true,
		sameSite: 'lax' as const,
		secure: process.env.NODE_ENV === 'production',
		maxAge: 600,
	};

	cookies.set('oidc.state', state, cookieOpts);
	cookies.set('oidc.nonce', nonce, cookieOpts);
	cookies.set('oidc.code_verifier', codeVerifier, cookieOpts);

	throw redirect(303, authorizationUrl.href);
};
