import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { prisma } from '../db';
import { youtubeLinkService } from '../services/youtube-link.service';
import { decryptSecret } from './crypto-box';

export type CookieSource = 'link' | 'settings' | 'none';

export interface YtdlpAccountCtx {
	/**
	 * Path to hand yt-dlp via --cookies. Always a 0600 temp file owned by the
	 * current withYouTubeCookies() call and unlinked when it returns; never
	 * retain it past fn().
	 */
	cookiePath: string | null;
	/** Always resolved from the same record as cookiePath, so a session and the
	 *  IP it was issued from can't diverge and trip a bot check. */
	proxyUrl: string | null;
	source: CookieSource;
	/** A link row exists but its stored session could not be decrypted — the
	 *  account needs re-linking, as opposed to this user never having linked. */
	needsRelink: boolean;
	/**
	 * The linked account's own extra default flags, empty when it inherits. Raw
	 * on purpose: a listing path must not hand these to yt-dlp — selection flags
	 * (--dateafter, --match-filters, …) silently drop entries from a flat
	 * listing — so listing callers read it to inspect, never to spawn with.
	 */
	extraFlags: string[];
	/** {@link extraFlags} when the account sets any, else `settings.ytdlpExtraFlags`.
	 *  The "account overrides the server default" rule every spawn applies. */
	defaultExtraFlags: string[];
}

/**
 * yt-dlp only takes --cookies as a path, so every credential — the linked
 * account's session and the uploaded cookies.txt alike — is materialized here.
 * 0600, and unlinked as this call settles: nothing may hold the path past fn().
 */
async function withCookieFile<T>(cookies: string, fn: (path: string) => Promise<T>): Promise<T> {
	const path = join(tmpdir(), `wytui-yt-${Date.now()}-${Math.round(Math.random() * 1e9)}.txt`);
	await writeFile(path, cookies, { mode: 0o600 });
	try {
		return await fn(path);
	} finally {
		await unlink(path).catch(() => {});
	}
}

/** The uploaded cookies.txt, decrypted. A blob that will not decrypt (a rotated
 *  AUTH_SECRET) means no credential, not a failed request. */
function uploadedCookies(cookiesTxtEnc: string | null | undefined): string | null {
	if (!cookiesTxtEnc) return null;
	try {
		return decryptSecret(cookiesTxtEnc);
	} catch {
		return null;
	}
}

/**
 * Resolve the account context every yt-dlp call should use: the linked YouTube
 * account's own session first, the uploaded cookies.txt as fallback.
 *
 * The proxy travels with the cookie source on purpose. A Google session used
 * from a different egress than the one it was issued from is a classic
 * "confirm you're not a bot" trigger, so callers must not pair ctx.proxyUrl
 * with a cookie file from elsewhere.
 *
 * The extra default flags ride along because they live on the same row: a caller
 * that needed them was reading that row twice per yt-dlp spawn.
 */
export async function withYouTubeCookies<T>(
	userId: string | null | undefined,
	fn: (ctx: YtdlpAccountCtx) => Promise<T>,
): Promise<T> {
	const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
	const globalProxy = settings?.ytdlpProxyUrl || null;

	const link = userId
		? await prisma.youTubeLink.findUnique({
				where: { userId },
				select: { proxyUrl: true, cookiesEnc: true, extraFlags: true },
			})
		: null;

	const linkProxy = link?.proxyUrl || globalProxy;
	const cookieTxt = link ? await youtubeLinkService.getCookiesTxt(userId!) : null;

	const linkFlags = link?.extraFlags ?? [];
	const serverFlags = settings?.ytdlpExtraFlags ?? [];
	const defaultExtraFlags = linkFlags.length > 0 ? linkFlags : serverFlags;
	const uploaded = uploadedCookies(settings?.cookiesTxtEnc);

	const ctx = (over: Partial<YtdlpAccountCtx>): YtdlpAccountCtx => ({
		cookiePath: null,
		proxyUrl: globalProxy,
		source: 'none',
		needsRelink: false,
		extraFlags: linkFlags,
		defaultExtraFlags,
		...over,
	});

	// A link row whose blob will not decrypt is a dead session, not an
	// unlinked account — callers need those to mean different things.
	if (link && !cookieTxt) {
		return uploaded
			? withCookieFile(uploaded, (path) =>
					fn(ctx({ cookiePath: path, proxyUrl: linkProxy, source: 'settings', needsRelink: true })),
				)
			: fn(ctx({ proxyUrl: linkProxy, needsRelink: true }));
	}

	if (cookieTxt) {
		return withCookieFile(cookieTxt, (path) =>
			fn(ctx({ cookiePath: path, proxyUrl: linkProxy, source: 'link' })),
		);
	}

	return uploaded
		? withCookieFile(uploaded, (path) => fn(ctx({ cookiePath: path, source: 'settings' })))
		: fn(ctx({}));
}
