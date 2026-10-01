import { prisma } from '../db';
import { encryptSecret, decryptSecret } from '../utils/crypto-box';
import {
	cookiesToNetscape,
	looksLikeYouTubeAuth,
	type BrowserCookie,
} from '../utils/netscape-cookies';
import { validateProxyUrlInput } from '../utils/proxy-url';
import { SECRET_MASK } from './settings-validation';
import { ytdlpService } from './ytdlp.service';

/** Cookie order is unstable, so compare the set of cookie lines rather than the serialized file. */
function sameStoredCookies(userId: string, storedEnc: string, nextNetscape: string): boolean {
	let stored: string;
	try {
		stored = decryptSecret(storedEnc, userId);
	} catch {
		return false;
	}
	const normalize = (s: string) =>
		s
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && !line.startsWith('#'))
			.sort()
			.join('\n');
	return normalize(stored) === normalize(nextNetscape);
}

class YouTubeLinkService {
	async storeCookies(
		userId: string,
		cookies: BrowserCookie[],
		identity?: { channelName?: string; channelHandle?: string; channelId?: string },
	): Promise<{ changed: boolean }> {
		if (!looksLikeYouTubeAuth(cookies)) {
			throw new Error('Not logged in to YouTube. Sign in at youtube.com, then try linking again.');
		}
		const netscape = cookiesToNetscape(cookies);
		const existing = await prisma.youTubeLink.findUnique({
			where: { userId },
			select: { cookiesEnc: true },
		});
		// An unchanged session must not read as new credentials: callers re-arm cookie-blocked downloads on `changed`.
		const changed = !existing || !sameStoredCookies(userId, existing.cookiesEnc, netscape);
		// AAD-bound to the owner, so a blob copied onto another row will not decrypt there.
		const cookiesEnc = encryptSecret(netscape, userId);
		const now = new Date();
		await prisma.youTubeLink.upsert({
			where: { userId },
			create: {
				userId,
				cookiesEnc,
				cookieUpdatedAt: now,
				channelName: identity?.channelName ?? null,
				channelHandle: identity?.channelHandle ?? null,
				channelId: identity?.channelId ?? null,
			},
			update: {
				cookiesEnc,
				cookieUpdatedAt: now,
				lastError: null,
				...(identity?.channelName ? { channelName: identity.channelName } : {}),
				...(identity?.channelHandle ? { channelHandle: identity.channelHandle } : {}),
				...(identity?.channelId ? { channelId: identity.channelId } : {}),
			},
		});
		return { changed };
	}

	async getCookiesTxt(userId: string): Promise<string | null> {
		const link = await prisma.youTubeLink.findUnique({ where: { userId } });
		if (!link) return null;
		try {
			return decryptSecret(link.cookiesEnc, userId);
		} catch {
			return null;
		}
	}

	async getLinkStatus(userId: string) {
		const link = await prisma.youTubeLink.findUnique({ where: { userId } });
		if (!link) return { linked: false };
		return {
			linked: true,
			channelName: link.channelName,
			cookieUpdatedAt: link.cookieUpdatedAt,
			lastHistorySync: link.lastHistorySync,
			lastError: link.lastError,
			toggles: {
				syncWatchedToYouTube: link.syncWatchedToYouTube,
				syncHistoryToWytui: link.syncHistoryToWytui,
				syncWatchLater: link.syncWatchLater,
				useFeedForNewVideos: link.useFeedForNewVideos,
			},
			jellyfinUserId: link.jellyfinUserId ?? null,
			ytdlp: {
				proxyUrl: link.proxyUrl ? SECRET_MASK : null,
				extraFlags: link.extraFlags ?? [],
			},
			notifications: {
				appriseUrl: link.appriseUrl ? SECRET_MASK : null,
				notifyOnComplete: link.notifyOnComplete,
				notifyOnFail: link.notifyOnFail,
			},
		};
	}

	async updateToggles(
		userId: string,
		toggles: Partial<
			Record<
				'syncWatchedToYouTube' | 'syncHistoryToWytui' | 'syncWatchLater' | 'useFeedForNewVideos',
				boolean
			>
		>,
	): Promise<void> {
		const allowed = [
			'syncWatchedToYouTube',
			'syncHistoryToWytui',
			'syncWatchLater',
			'useFeedForNewVideos',
		] as const;
		const data: Record<string, boolean> = {};
		for (const key of allowed) {
			if (typeof toggles?.[key] === 'boolean') data[key] = toggles[key] as boolean;
		}
		if (Object.keys(data).length === 0) return;
		// updateMany so a missing row is a no-op (0 rows) instead of a P2025 throw.
		await prisma.youTubeLink.updateMany({ where: { userId }, data });
	}

	/**
	 * Per-account overrides for the server-wide Settings: yt-dlp proxy/flags and
	 * automation notifications. An empty extraFlags array means "inherit the
	 * default"; notifications only replace the global ones once the account has
	 * its own appriseUrl.
	 *
	 * Optional fields are detected with `!== undefined`, not `in`: the API route
	 * forwards every account field, so unsubmitted ones arrive as explicit
	 * `undefined` values. `null` still means "clear the setting".
	 */
	async updateAccountSettings(
		userId: string,
		updates: {
			proxyUrl?: string | null;
			extraFlags?: string[];
			appriseUrl?: string | null;
			notifyOnComplete?: boolean;
			notifyOnFail?: boolean;
			jellyfinUserId?: string | null;
		},
	): Promise<void> {
		const link = await prisma.youTubeLink.findUnique({ where: { userId } });
		if (!link) throw new Error('No linked YouTube account');

		const data: Record<string, string | null | boolean | string[]> = {};
		if (updates.jellyfinUserId !== undefined) {
			const value = updates.jellyfinUserId;
			if (value === null || value === '') {
				data.jellyfinUserId = null;
			} else if (typeof value === 'string') {
				data.jellyfinUserId = value.trim();
			} else {
				throw new Error('jellyfinUserId must be a string or null');
			}
		}
		// A value that is exactly the mask means the form echoed back what the masked status showed — "unchanged", not a new proxy.
		if (updates.proxyUrl !== undefined && updates.proxyUrl !== SECRET_MASK) {
			const check = validateProxyUrlInput(updates.proxyUrl);
			if (!check.ok) throw new Error(`Proxy URL ${check.error}`);
			data.proxyUrl = check.value;
		}
		if (updates.extraFlags !== undefined) {
			const flags = updates.extraFlags;
			if (!Array.isArray(flags) || !flags.every((f) => typeof f === 'string')) {
				throw new Error('extraFlags must be an array of strings');
			}
			const badFlag = ytdlpService.findDangerousFlag(flags);
			if (badFlag) {
				throw new Error(`Forbidden flag: ${badFlag}`);
			}

			data.extraFlags = flags.map((f) => f.trim()).filter(Boolean);
		}
		if (updates.appriseUrl !== undefined && updates.appriseUrl !== SECRET_MASK) {
			if (updates.appriseUrl === null || updates.appriseUrl === '') {
				data.appriseUrl = null;
			} else if (typeof updates.appriseUrl === 'string') {
				data.appriseUrl = updates.appriseUrl.trim();
			} else {
				throw new Error('appriseUrl must be a string or null');
			}
		}
		for (const key of ['notifyOnComplete', 'notifyOnFail'] as const) {
			if (updates[key] === undefined) continue;
			if (typeof updates[key] !== 'boolean') {
				throw new Error(`${key} must be a boolean`);
			}
			data[key] = updates[key];
		}
		if (Object.keys(data).length === 0) return;
		await prisma.youTubeLink.update({ where: { userId }, data });
	}

	async getSessionHealth(userId: string): Promise<{
		linked: boolean;
		usable: boolean;
		cookieUpdatedAt: Date | null;
	}> {
		const link = await prisma.youTubeLink.findUnique({
			where: { userId },
			select: { cookiesEnc: true, cookieUpdatedAt: true },
		});
		if (!link) return { linked: false, usable: false, cookieUpdatedAt: null };
		let usable = true;
		try {
			decryptSecret(link.cookiesEnc, userId);
		} catch {
			usable = false;
		}
		return { linked: true, usable, cookieUpdatedAt: link.cookieUpdatedAt };
	}

	async unlink(userId: string): Promise<void> {
		await prisma.youTubeLink.delete({ where: { userId } }).catch(() => {});
	}
}

export const youtubeLinkService = new YouTubeLinkService();
