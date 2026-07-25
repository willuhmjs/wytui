import { error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { libraryAccessStatus } from '$lib/server/permissions';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	if (!locals.session?.user?.id) {
		throw error(401, 'Authentication required');
	}

	const download = await prisma.download.findUnique({
		where: { id: params.id },
		include: {
			profile: true,
			watchProgress: {
				where: { userId: locals.session.user.id },
				take: 1,
			},
		},
	});

	if (!download) {
		throw error(404, 'Download not found');
	}

	if (download.userId !== locals.session.user.id && !locals.session.user.isAdmin) {
		throw error(403, 'Access denied');
	}

	const settings = await prisma.settings.findUnique({
		where: { id: 'singleton' },
	});

	// Load download tasks for in-progress or recently completed downloads
	const downloadTasks = await prisma.downloadTask.findMany({
		where: { downloadId: params.id },
		orderBy: { createdAt: 'asc' },
	});

	// Resolve the library action available for this download (based on its owner's
	// effective access) so the UI can show Save / Request / nothing.
	const ownerId = download.userId ?? locals.session.user.id;
	const owner = await prisma.user.findUnique({
		where: { id: ownerId },
		select: { libraryAccess: true, isAdmin: true },
	});
	const access = libraryAccessStatus(owner, settings ?? { libraryAccessMode: 'free' });
	const libraryConfigured = !!settings?.libraryPath;
	let libraryAction: 'save' | 'request' | 'none' =
		access === 'allowed' && libraryConfigured
			? 'save'
			: access === 'request' && libraryConfigured
				? 'request'
				: 'none';
	const existingRequest = await prisma.libraryRequest.findUnique({
		where: { downloadId: params.id },
		select: { status: true },
	});
	const libraryRequestStatus = existingRequest?.status ?? null;

	const serialized = {
		...download,
		filesize: download.filesize?.toString() ?? null,
		downloadedBytes: download.downloadedBytes?.toString() ?? null,
		totalBytes: download.totalBytes?.toString() ?? null,
		watchProgress: download.watchProgress[0] ?? null,
	};

	// Playlist navigation context
	let playlistContext: {
		playlistId: string;
		playlistName: string;
		prevDownloadId: string | null;
		nextDownloadId: string | null;
		currentPosition: number;
		totalItems: number;
	} | null = null;

	const playlistId = url.searchParams.get('playlist');
	if (playlistId) {
		const playlist = await prisma.playlist.findUnique({
			where: { id: playlistId },
			include: { items: { orderBy: { position: 'asc' }, select: { id: true, downloadId: true } } },
		});
		if (playlist && playlist.userId === locals.session.user.id) {
			const idx = playlist.items.findIndex((item) => item.downloadId === params.id);
			if (idx !== -1) {
				playlistContext = {
					playlistId,
					playlistName: playlist.name,
					prevDownloadId: idx > 0 ? playlist.items[idx - 1].downloadId : null,
					nextDownloadId:
						idx < playlist.items.length - 1 ? playlist.items[idx + 1].downloadId : null,
					currentPosition: idx + 1,
					totalItems: playlist.items.length,
				};
			}
		}
	}

	// Similar videos — same uploader, exclude current, max 6
	let similar: {
		id: string;
		title: string | null;
		thumbnail: string | null;
		uploader: string | null;
		duration: number | null;
	}[] = [];
	if (download.uploader) {
		const rows = await prisma.download.findMany({
			where: {
				userId: locals.session.user.id,
				uploader: download.uploader,
				status: 'COMPLETED',
				id: { not: params.id },
			},
			select: { id: true, title: true, thumbnail: true, uploader: true, duration: true },
			orderBy: { completedAt: 'desc' },
			take: 6,
		});
		similar = rows;
	}

	// Timestamp deep link: ?t=123 jumps to that second
	const tParam = url.searchParams.get('t');
	const startTimeParam = tParam !== null ? parseFloat(tParam) : null;

	return {
		download: serialized,
		downloadTasks,
		jellyfinUrl: settings?.jellyfinExternalUrl || settings?.jellyfinUrl || '',
		libraryAction,
		libraryRequestStatus,
		playlistContext,
		similar,
		startTimeParam:
			startTimeParam !== null && isFinite(startTimeParam) && startTimeParam > 0
				? startTimeParam
				: null,
	};
};
