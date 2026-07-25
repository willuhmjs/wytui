export type ThumbEntry = {
	url: string;
	width?: number | null;
	height?: number | null;
	preference?: number | null;
};

export interface ThumbnailInput {
	videoId?: string | null;
	thumbnail?: string | null;
	thumbnails?: ThumbEntry[] | null;
}

/** Default HEAD check: returns true if the URL responds 200. */
async function defaultHeadCheck(url: string): Promise<boolean> {
	try {
		const res = await fetch(url, { method: 'HEAD' });
		return res.ok;
	} catch {
		return false;
	}
}

const YT_CHAIN = ['maxresdefault', 'sddefault', 'hqdefault'];

export async function resolveBestThumbnailUrl(
	input: ThumbnailInput,
	headCheck: (url: string) => Promise<boolean> = defaultHeadCheck,
): Promise<string | null> {
	// YouTube fast path: try highest-res variants in order.
	if (input.videoId) {
		for (const variant of YT_CHAIN) {
			const url = `https://i.ytimg.com/vi/${input.videoId}/${variant}.jpg`;
			if (await headCheck(url)) return url;
		}
	}

	// Generic: pick the largest entry from the thumbnails array.
	if (input.thumbnails && input.thumbnails.length > 0) {
		const best = [...input.thumbnails].sort((a, b) => {
			const areaA = (a.width ?? 0) * (a.height ?? 0);
			const areaB = (b.width ?? 0) * (b.height ?? 0);
			if (areaB !== areaA) return areaB - areaA;
			return (b.preference ?? 0) - (a.preference ?? 0);
		})[0];
		if (best?.url) return best.url;
	}

	return input.thumbnail ?? null;
}
