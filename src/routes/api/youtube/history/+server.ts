import { json } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/guards';
import { prisma } from '$lib/server/db';
import { youtubeService } from '$lib/server/services/youtube.service';
import type { RequestHandler } from './$types';

// Pull recent YT history and mark matching library items watched for this user.
export const POST: RequestHandler = async ({ locals }) => {
	const userId = requireAuth(locals);
	const result = await youtubeService.fetchHistory(userId);
	if ('needsRelink' in result) return json({ needsRelink: true });
	// Batch-load all matching downloads in one query, keyed by videoId (keeping
	// the first match per id to mirror the previous findFirst behavior).
	const videoIds = result.map((e) => e.id);
	const downloads = await prisma.download.findMany({ where: { videoId: { in: videoIds } } });
	const downloadByVideoId = new Map<string, (typeof downloads)[number]>();
	for (const d of downloads) {
		if (d.videoId && !downloadByVideoId.has(d.videoId)) downloadByVideoId.set(d.videoId, d);
	}
	let marked = 0;
	for (const entry of result) {
		const dl = downloadByVideoId.get(entry.id);
		if (!dl) continue;
		await prisma.watchProgress.upsert({
			where: { userId_downloadId: { userId, downloadId: dl.id } },
			create: { userId, downloadId: dl.id, watched: true, watchedAt: new Date() },
			update: { watched: true, watchedAt: new Date() },
		});
		marked++;
	}
	return json({ marked });
};
