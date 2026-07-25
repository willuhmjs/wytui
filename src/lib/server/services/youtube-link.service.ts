import { prisma } from '../db';
import { encryptSecret, decryptSecret } from '../utils/crypto-box';
import {
	cookiesToNetscape,
	looksLikeYouTubeAuth,
	type BrowserCookie,
} from '../utils/netscape-cookies';

class YouTubeLinkService {
	async storeCookies(
		userId: string,
		cookies: BrowserCookie[],
		identity?: { channelName?: string; channelHandle?: string; channelId?: string },
	): Promise<void> {
		if (!looksLikeYouTubeAuth(cookies)) {
			throw new Error('Not logged in to YouTube. Sign in at youtube.com, then try linking again.');
		}
		const cookiesEnc = encryptSecret(cookiesToNetscape(cookies));
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
	}

	async getCookiesTxt(userId: string): Promise<string | null> {
		const link = await prisma.youTubeLink.findUnique({ where: { userId } });
		if (!link) return null;
		try {
			return decryptSecret(link.cookiesEnc);
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
			lastError: link.lastError,
			toggles: {
				syncWatchedToYouTube: link.syncWatchedToYouTube,
				syncHistoryToWytui: link.syncHistoryToWytui,
				syncWatchLater: link.syncWatchLater,
				useFeedForNewVideos: link.useFeedForNewVideos,
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

	async unlink(userId: string): Promise<void> {
		await prisma.youTubeLink.delete({ where: { userId } }).catch(() => {});
	}
}

export const youtubeLinkService = new YouTubeLinkService();
