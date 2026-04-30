import { redirect } from '@sveltejs/kit';
import * as client from 'openid-client';
import { getOidcConfig, isOidcConfigured } from '$lib/server/oidc';
import { issueSessionCookie } from '$lib/server/auth';
import { prisma } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	if (!isOidcConfigured()) {
		throw redirect(303, '/auth/signin');
	}

	const state = cookies.get('oidc.state');
	const nonce = cookies.get('oidc.nonce');
	const codeVerifier = cookies.get('oidc.code_verifier');

	cookies.delete('oidc.state', { path: '/' });
	cookies.delete('oidc.nonce', { path: '/' });
	cookies.delete('oidc.code_verifier', { path: '/' });

	if (!state || !nonce || !codeVerifier) {
		throw redirect(303, '/auth/signin?error=invalid_state');
	}

	const config = await getOidcConfig();
	const redirectUri = `${url.origin}/auth/oidc/callback`;

	let tokenResponse: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers;
	try {
		tokenResponse = await client.authorizationCodeGrant(config, url, {
			expectedNonce: nonce,
			expectedState: state,
			pkceCodeVerifier: codeVerifier,
			idTokenExpected: true,
		});
	} catch (e) {
		console.error('OIDC token exchange failed:', e);
		throw redirect(303, '/auth/signin?error=oidc_failed');
	}

	const claims = tokenResponse.claims();
	if (!claims) {
		console.error('OIDC: no ID token claims returned');
		throw redirect(303, '/auth/signin?error=oidc_failed');
	}

	let email = claims.email as string | undefined;
	let name = (claims.name as string | undefined) ||
		(claims.preferred_username as string | undefined);

	if (!email && tokenResponse.access_token) {
		try {
			const userInfo = await client.fetchUserInfo(
				config,
				tokenResponse.access_token,
				claims.sub,
			);
			email = userInfo.email as string | undefined;
			name = name || (userInfo.name as string | undefined);
		} catch {
			// userinfo endpoint may not be available
		}
	}

	if (!email) {
		console.error('OIDC: no email in claims or userinfo');
		throw redirect(303, '/auth/signin?error=no_email');
	}

	let user = await prisma.user.findUnique({ where: { email } });

	const isFirstUser = (await prisma.user.count()) === 0;

	if (!user) {
		user = await prisma.user.create({
			data: {
				email,
				name: name || email.split('@')[0],
				password: null,
				isAdmin: isFirstUser,
				emailVerified: new Date(),
			},
		});
	}

	await prisma.account.upsert({
		where: {
			provider_providerAccountId: {
				provider: 'oidc',
				providerAccountId: claims.sub,
			},
		},
		update: {
			access_token: tokenResponse.access_token,
			refresh_token: tokenResponse.refresh_token as string | undefined,
			id_token: tokenResponse.id_token,
			expires_at: claims.exp as number | undefined,
			token_type: tokenResponse.token_type,
			scope: typeof claims.scope === 'string' ? claims.scope : undefined,
		},
		create: {
			userId: user.id,
			type: 'oidc',
			provider: 'oidc',
			providerAccountId: claims.sub,
			access_token: tokenResponse.access_token,
			refresh_token: tokenResponse.refresh_token as string | undefined,
			id_token: tokenResponse.id_token,
			expires_at: claims.exp as number | undefined,
			token_type: tokenResponse.token_type,
			scope: typeof claims.scope === 'string' ? claims.scope : undefined,
		},
	});

	issueSessionCookie(cookies, {
		id: user.id,
		email: user.email,
		isAdmin: user.isAdmin,
	});

	throw redirect(303, '/');
};
