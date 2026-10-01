import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DownloadStatus } from '@prisma/client';

// In-memory stores backing the prisma mock.
const downloads: Record<string, any> = {};
const archiveDb: Record<string, any> = {};
const jobQueueRows: any[] = [];
const enqueueCalls: any[] = [];

// Filesystem paths treated as existing on disk — wired into the service via
// the fileExistsOnDisk spy in beforeEach (builtin-import mocking doesn't
// reach source files under vitest).
const existingFiles = new Set<string>();

vi.mock('../db', () => {
	// Shared where-clause matcher for the download-table mocks below. Supports
	// the shapes the service uses: scalar status, status.in, id.not, and
	// equality on profileId/videoId/url plus filepath not-null.
	const matchesWhere = (d: any, where: any = {}) => {
		if (where.id?.not !== undefined && d.id === where.id.not) return false;
		if (where.status !== undefined) {
			if (where.status?.in) {
				if (!where.status.in.includes(d.status)) return false;
			} else if (d.status !== where.status) {
				return false;
			}
		}
		if (where.profileId !== undefined && d.profileId !== where.profileId) return false;
		if (where.videoId !== undefined && d.videoId !== where.videoId) return false;
		if (where.url !== undefined && d.url !== where.url) return false;
		if (where.subscriptionId !== undefined && d.subscriptionId !== where.subscriptionId) {
			return false;
		}
		if (where.storagePool !== undefined) {
			if (where.storagePool?.in) {
				if (!where.storagePool.in.includes(d.storagePool)) return false;
			} else if (d.storagePool !== where.storagePool) {
				return false;
			}
		}
		if (where.filepath?.not === null && d.filepath == null) return false;
		return true;
	};

	return {
		prisma: {
			download: {
				findUnique: vi.fn(async ({ where }: any) => {
					const d = downloads[where.id];
					return d ? { ...d, profile: {} } : null;
				}),
				update: vi.fn(async ({ where, data }: any) => {
					downloads[where.id] = { ...downloads[where.id], ...data };
					return { ...downloads[where.id], profile: {} };
				}),
				delete: vi.fn(async ({ where }: any) => {
					delete downloads[where.id];
				}),
				deleteMany: vi.fn(async ({ where }: any) => {
					let count = 0;
					for (const id of Object.keys(downloads)) {
						if (matchesWhere(downloads[id], where)) {
							delete downloads[id];
							count++;
						}
					}
					return { count };
				}),
				findMany: vi.fn(async ({ where }: any) => {
					const rows = Object.values(downloads)
						.filter((d: any) => matchesWhere(d, where))
						.sort(
							(a: any, b: any) =>
								new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime(),
						);
					return rows.map((d: any) => ({ ...d }));
				}),
				findFirst: vi.fn(async () => null),
			},
			archive: {
				upsert: vi.fn(async ({ where, update, create }: any) => {
					archiveDb[where.videoId] = archiveDb[where.videoId]
						? { ...archiveDb[where.videoId], ...update }
						: { ...create };
					return archiveDb[where.videoId];
				}),
				deleteMany: vi.fn(async ({ where }: any) => {
					let count = 0;
					for (const k of Object.keys(archiveDb)) {
						if (k === where.videoId) {
							delete archiveDb[k];
							count++;
						}
					}
					return { count };
				}),
			},
			jobQueue: {
				findMany: vi.fn(async () =>
					jobQueueRows.filter((j) => j.status === 'PENDING' || j.status === 'RUNNING'),
				),
			},
			eventLog: {
				create: vi.fn(async () => ({})),
				deleteMany: vi.fn(async () => ({ count: 0 })),
			},
			settings: {
				findUnique: vi.fn(async () => ({})),
			},
			subscription: {
				findUnique: vi.fn(async () => null),
			},
		},
	};
});

vi.mock('../sse/emitter', () => ({
	sseEmitter: {
		broadcast: vi.fn(),
		broadcastToUser: vi.fn(),
		setInitialStateCallback: vi.fn(),
	},
}));

vi.mock('./queue.service', () => ({
	queueService: {
		registerHandler: vi.fn(),
		enqueue: vi.fn(async (type: string, payload: any, options?: any) => {
			enqueueCalls.push({ type, payload, options });
			return { id: `job-${enqueueCalls.length}`, type, payload, status: 'PENDING' };
		}),
	},
}));

vi.mock('./notification.service', () => ({
	notificationService: {
		notifyFail: vi.fn(async () => {}),
		notifyComplete: vi.fn(async () => {}),
	},
}));

import { downloadService } from './download.service';
import { queueService } from './queue.service';
import { sseEmitter } from '../sse/emitter';
import { prisma } from '../db';
import { ytdlpService } from './ytdlp.service';
import { libraryService } from './library.service';
import { runWithRequestContext, setActingUser } from '../request-context';
import { isRateLimitCooldownActive, resetRateLimitCooldown } from '../utils/rate-limit-cooldown';

const ID = 'dl-retry-1';

function seedDownload(extra: Record<string, any> = {}) {
	downloads[ID] = {
		id: ID,
		url: 'https://www.youtube.com/watch?v=vid1',
		title: 'Some Video',
		status: DownloadStatus.DOWNLOADING,
		retryCount: 0,
		filepath: null,
		userId: null,
		...extra,
	};
}

beforeEach(() => {
	for (const k of Object.keys(downloads)) delete downloads[k];
	for (const k of Object.keys(archiveDb)) delete archiveDb[k];
	jobQueueRows.length = 0;
	enqueueCalls.length = 0;
	existingFiles.clear();
	(downloadService as any).cancelledDownloads.clear();
	(downloadService as any).handlingError.clear();
	(downloadService as any).retryTimeouts.clear();
	(downloadService as any).downloadOwners.clear();
	vi.restoreAllMocks();
	// Established after restoreAllMocks so it survives to every test: the
	// "file exists on disk" check consults existingFiles.
	vi.spyOn(downloadService as any, 'fileExistsOnDisk').mockImplementation(async (path: any) =>
		existingFiles.has(path),
	);
});

describe('handleDownloadError terminal path', () => {
	it('marks the download FAILED (keeping the row) once the retry cycle is exhausted', async () => {
		seedDownload({ retryCount: 3 });

		await (downloadService as any).handleDownloadError(ID, 'yt-dlp exited with code 1');

		// Row is kept as FAILED with the error message — visible in the failed
		// section with a retry button, not silently deleted.
		expect(downloads[ID]).toBeDefined();
		expect(downloads[ID].status).toBe(DownloadStatus.FAILED);
		expect(downloads[ID].error).toBe('yt-dlp exited with code 1');
		// Failure is archived so subscription sync backs off before re-queueing.
		expect(archiveDb['vid1']?.reason).toBe('failed');
		// No further automatic retry is scheduled.
		expect((downloadService as any).retryTimeouts.has(ID)).toBe(false);
	});

	it('schedules a bounded retry while retryCount < 3', async () => {
		seedDownload({ retryCount: 0 });

		await (downloadService as any).handleDownloadError(ID, 'transient');

		expect(downloads[ID].status).toBe(DownloadStatus.DOWNLOADING);
		expect(downloads[ID].retryCount).toBe(1);
		expect(downloads[ID].error).toBe('transient');
		expect((downloadService as any).retryTimeouts.has(ID)).toBe(true);
	});

	it('goes terminal immediately on a rate limit and arms the shared cooldown', async () => {
		seedDownload({ retryCount: 0 });
		resetRateLimitCooldown();

		await (downloadService as any).handleDownloadError(ID, 'HTTP Error 429: Too Many Requests');

		// No quick retry scheduled — hammering a blocked IP only makes it worse.
		expect((downloadService as any).retryTimeouts.has(ID)).toBe(false);
		expect(downloads[ID].status).toBe(DownloadStatus.FAILED);
		expect(downloads[ID].error).toContain('429');
		expect(isRateLimitCooldownActive()).toBe(true);
		resetRateLimitCooldown();
	});

	it('goes terminal on age-restricted videos without arming the cooldown', async () => {
		seedDownload({ retryCount: 0 });
		resetRateLimitCooldown();

		await (downloadService as any).handleDownloadError(
			ID,
			'Metadata fetch failed: AgeRestrictedError: [youtube] vid1: Sign in to confirm your age. This video may be inappropriate for some users.',
		);

		// Deterministic per-video failure: no quick retries…
		expect((downloadService as any).retryTimeouts.has(ID)).toBe(false);
		expect(downloads[ID].status).toBe(DownloadStatus.FAILED);
		expect(downloads[ID].retryCount).toBe(0);
		expect(downloads[ID].error).toContain('confirm your age');
		// …and no cooldown: an age gate is not IP-wide, so subscription checks
		// must keep running (this was the "phantom rate limit" failure mode).
		expect(isRateLimitCooldownActive()).toBe(false);
		// Still archived so subscription sync backs off before re-queueing.
		expect(archiveDb['vid1']?.reason).toBe('failed');
	});

	it('goes terminal on forbidden-flag config errors without burning the retry cycle', async () => {
		seedDownload({ retryCount: 0 });
		resetRateLimitCooldown();

		await (downloadService as any).handleDownloadError(ID, 'Forbidden flag: --postprocessor-args');

		// An invalid profile flag fails identically on every attempt — retrying
		// just spawns three more doomed processes.
		expect((downloadService as any).retryTimeouts.has(ID)).toBe(false);
		expect(downloads[ID].status).toBe(DownloadStatus.FAILED);
		expect(downloads[ID].retryCount).toBe(0);
		expect(isRateLimitCooldownActive()).toBe(false);
	});

	it('dedupes older FAILED rows for the same video when marking a terminal failure', async () => {
		// The checker re-queues after each cooldown lapse, so the same video
		// stacks FAILED rows — only the newest (this one) should survive.
		seedDownload({ retryCount: 3, videoId: 'vid1', profileId: 'p1' });
		downloads['older-dupe'] = {
			id: 'older-dupe',
			url: 'https://www.youtube.com/watch?v=vid1',
			status: DownloadStatus.FAILED,
			videoId: 'vid1',
			profileId: 'p1',
			userId: null,
		};
		downloads['other-video'] = {
			id: 'other-video',
			url: 'https://www.youtube.com/watch?v=vid9',
			status: DownloadStatus.FAILED,
			videoId: 'vid9',
			profileId: 'p1',
			userId: null,
		};

		await (downloadService as any).handleDownloadError(ID, 'yt-dlp exited with code 1');

		expect(downloads[ID].status).toBe(DownloadStatus.FAILED);
		expect(downloads['older-dupe']).toBeUndefined();
		// Different video, same profile — untouched.
		expect(downloads['other-video']).toBeDefined();
	});
});

describe('retryDownload', () => {
	it('resets a FAILED download and re-queues the pipeline', async () => {
		seedDownload({ status: DownloadStatus.FAILED, retryCount: 3, error: 'boom' });
		archiveDb['vid1'] = { videoId: 'vid1', reason: 'failed', failedAt: new Date() };

		const updated = await downloadService.retryDownload(ID);

		expect(updated.status).toBe(DownloadStatus.PENDING);
		expect(updated.retryCount).toBe(0);
		expect(updated.error).toBeNull();
		// The failed-archive marker is dropped so sync doesn't treat the video
		// as known-bad while the retry is in flight.
		expect(archiveDb['vid1']).toBeUndefined();
		expect(enqueueCalls).toHaveLength(1);
		expect(enqueueCalls[0].type).toBe('metadata');
		expect(enqueueCalls[0].payload).toEqual({ downloadId: ID });
	});

	it('resets a CANCELLED download too', async () => {
		seedDownload({ status: DownloadStatus.CANCELLED });

		const updated = await downloadService.retryDownload(ID);

		expect(updated.status).toBe(DownloadStatus.PENDING);
		expect(enqueueCalls).toHaveLength(1);
	});

	it('broadcasts download:created so the retry shows up in Active without a refresh', async () => {
		// userId set → the retry must broadcast to the owning user.
		seedDownload({ status: DownloadStatus.FAILED, userId: 'user-1' });

		await downloadService.retryDownload(ID);

		// The client drops failed rows from its live list and ignores
		// download:status for unknown ids — only download:created re-adds it.
		const calls = (sseEmitter.broadcastToUser as any).mock.calls.filter(
			(c: any[]) => c[0] === 'download:created',
		);
		expect(calls).toHaveLength(1);
		expect(calls[0][1]).toMatchObject({ id: ID, status: DownloadStatus.PENDING });
		expect(calls[0][2]).toBe('user-1');
	});

	it('refuses to retry a download that is not failed or cancelled', async () => {
		seedDownload({ status: DownloadStatus.COMPLETED });

		await expect(downloadService.retryDownload(ID)).rejects.toThrow(
			'Only failed or cancelled downloads can be retried',
		);
		expect(enqueueCalls).toHaveLength(0);
	});

	it('discards the row instead of re-downloading when the video already completed under the same profile', async () => {
		seedDownload({ status: DownloadStatus.FAILED, videoId: 'vid1', profileId: 'p1' });
		downloads['twin-1'] = {
			id: 'twin-1',
			url: 'https://www.youtube.com/watch?v=vid1',
			status: DownloadStatus.COMPLETED,
			videoId: 'vid1',
			profileId: 'p1',
			filepath: '/media/library/vid1.mp4',
			userId: null,
		};
		existingFiles.add('/media/library/vid1.mp4');

		const result = await downloadService.retryDownload(ID);

		// Stale row removed, nothing enqueued, response names the completed twin.
		expect(downloads[ID]).toBeUndefined();
		expect(enqueueCalls).toHaveLength(0);
		expect(result.duplicateOf).toBe('twin-1');
		// The client needs download:deleted to drop the row live.
		const deleted = (sseEmitter.broadcast as any).mock.calls.filter(
			(c: any[]) => c[0] === 'download:deleted',
		);
		expect(deleted).toHaveLength(1);
		expect(deleted[0][1]).toEqual({ id: ID });
	});

	it('re-downloads when the completed twin used a different profile (template changed)', async () => {
		seedDownload({ status: DownloadStatus.FAILED, videoId: 'vid1', profileId: 'p1' });
		downloads['twin-1'] = {
			id: 'twin-1',
			url: 'https://www.youtube.com/watch?v=vid1',
			status: DownloadStatus.COMPLETED,
			videoId: 'vid1',
			profileId: 'p2',
			filepath: '/media/library/vid1.mp4',
			userId: null,
		};
		existingFiles.add('/media/library/vid1.mp4');

		const updated = await downloadService.retryDownload(ID);

		expect(updated.status).toBe(DownloadStatus.PENDING);
		expect(enqueueCalls).toHaveLength(1);
		expect(downloads[ID]).toBeDefined();
	});

	it('re-downloads when the completed twin no longer exists on disk', async () => {
		seedDownload({ status: DownloadStatus.FAILED, videoId: 'vid1', profileId: 'p1' });
		downloads['twin-1'] = {
			id: 'twin-1',
			url: 'https://www.youtube.com/watch?v=vid1',
			status: DownloadStatus.COMPLETED,
			videoId: 'vid1',
			profileId: 'p1',
			filepath: '/media/library/vid1.mp4',
			userId: null,
		};
		// Not added to existingFiles — access() throws ENOENT.

		const updated = await downloadService.retryDownload(ID);

		expect(updated.status).toBe(DownloadStatus.PENDING);
		expect(enqueueCalls).toHaveLength(1);
		expect(downloads[ID]).toBeDefined();
	});
});

describe('processDownload duplicate guard', () => {
	it('does not enqueue a second pipeline when one is already queued', async () => {
		seedDownload({ status: DownloadStatus.PENDING });
		jobQueueRows.push({
			id: 'job-x',
			type: 'metadata',
			status: 'PENDING',
			payload: { downloadId: ID },
		});

		await (downloadService as any).processDownload(ID);

		expect(enqueueCalls).toHaveLength(0);
	});

	it('enqueues when no pipeline exists for the download', async () => {
		seedDownload({ status: DownloadStatus.PENDING });
		jobQueueRows.push({
			id: 'job-other',
			type: 'metadata',
			status: 'PENDING',
			payload: { downloadId: 'someone-else' },
		});

		await (downloadService as any).processDownload(ID);

		expect(enqueueCalls).toHaveLength(1);
	});
});

describe('queue handler error wiring', () => {
	it('routes download-handler failures into handleDownloadError instead of the job row', async () => {
		const registered = new Map<string, any>();
		(queueService.registerHandler as any).mockImplementation((type: string, handler: any) =>
			registered.set(type, handler),
		);
		downloadService.registerJobHandlers();

		const executeSpy = vi
			.spyOn(downloadService as any, 'executeDownload')
			.mockRejectedValue(new Error('network down'));
		const handleErrorSpy = vi
			.spyOn(downloadService as any, 'handleDownloadError')
			.mockResolvedValue(undefined);

		await registered.get('download')({ payload: { downloadId: ID } });

		expect(executeSpy).toHaveBeenCalledWith(ID);
		expect(handleErrorSpy).toHaveBeenCalledWith(ID, 'network down');
	});

	it('routes metadata-handler failures into handleDownloadError', async () => {
		const registered = new Map<string, any>();
		(queueService.registerHandler as any).mockImplementation((type: string, handler: any) =>
			registered.set(type, handler),
		);
		downloadService.registerJobHandlers();

		const fetchSpy = vi
			.spyOn(downloadService as any, 'fetchMetadata')
			.mockRejectedValue(new Error('yt-dlp timeout'));
		const handleErrorSpy = vi
			.spyOn(downloadService as any, 'handleDownloadError')
			.mockResolvedValue(undefined);

		await registered.get('metadata')({ payload: { downloadId: ID } });

		expect(fetchSpy).toHaveBeenCalledWith(ID);
		expect(handleErrorSpy).toHaveBeenCalledWith(ID, 'yt-dlp timeout');
		// The download phase is never enqueued when metadata fails.
		expect(enqueueCalls).toHaveLength(0);
	});

	it('lets a real skip flow through the metadata handler without touching the failure pipeline', async () => {
		// Drive a genuine DownloadSkippedError: fetchMetadata must throw it as
		// itself, and the registered handler's instanceof branch must swallow
		// it — no handleDownloadError (no retry, no FAILED row, no
		// notification) and no download-phase enqueue.
		const registered = new Map<string, any>();
		(queueService.registerHandler as any).mockImplementation((type: string, handler: any) =>
			registered.set(type, handler),
		);
		downloadService.registerJobHandlers();

		seedDownload({ status: DownloadStatus.PENDING, url: 'https://www.youtube.com/watch?v=qskip1' });
		vi.spyOn(prisma.settings, 'findUnique').mockResolvedValue({
			cookiePath: null,
			maxDurationSeconds: 7200,
			rydEnabled: false,
		} as any);
		vi.spyOn(ytdlpService, 'fetchMetadata').mockResolvedValue({
			title: 'Too long',
			videoId: 'qskip1',
			videoType: 'regular',
			liveStatus: null,
			duration: 3 * 3600,
		} as any);
		const handleErrorSpy = vi
			.spyOn(downloadService as any, 'handleDownloadError')
			.mockResolvedValue(undefined);

		await registered.get('metadata')({ payload: { downloadId: ID } });

		expect(handleErrorSpy).not.toHaveBeenCalled();
		expect(enqueueCalls).toHaveLength(0);
		// The skipped record is discarded, not left as FAILED.
		expect(downloads[ID]).toBeUndefined();
	});
});

describe('event log actor attribution', () => {
	it('records the acting admin, not the download owner, on admin deletion', async () => {
		seedDownload({ userId: 'user-x' });

		// The route-level acting user now arrives via the request context
		// (hooks.server.ts), not an actorId parameter.
		await runWithRequestContext(async () => {
			setActingUser({ id: 'admin-1' });
			await downloadService.deleteDownload(ID);
		});

		expect(prisma.eventLog.create).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ userId: 'admin-1' }) }),
		);
	});

	it('falls back to the download owner when no actor is known', async () => {
		seedDownload({ userId: 'user-x' });

		// No request context — background callers (queue jobs, eviction).
		await downloadService.deleteDownload(ID);

		expect(prisma.eventLog.create).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ userId: 'user-x' }) }),
		);
	});
});

describe('sweepSupersededRows (completion sweep)', () => {
	it('removes FAILED and PENDING siblings of the completed row under the same profile', async () => {
		downloads['done'] = {
			id: 'done',
			url: 'https://www.youtube.com/watch?v=vidS',
			videoId: 'vidS',
			profileId: 'p1',
			status: DownloadStatus.COMPLETED,
			filepath: '/media/library/vidS.mp4',
			userId: null,
		};
		downloads['stale-failed'] = {
			id: 'stale-failed',
			url: 'https://www.youtube.com/watch?v=vidS',
			videoId: 'vidS',
			profileId: 'p1',
			status: DownloadStatus.FAILED,
			userId: null,
		};
		downloads['stale-pending'] = {
			id: 'stale-pending',
			url: 'https://www.youtube.com/watch?v=vidS',
			videoId: 'vidS',
			profileId: 'p1',
			status: DownloadStatus.PENDING,
			userId: null,
		};
		downloads['other-profile'] = {
			id: 'other-profile',
			url: 'https://www.youtube.com/watch?v=vidS',
			videoId: 'vidS',
			profileId: 'p2',
			status: DownloadStatus.FAILED,
			userId: null,
		};
		downloads['other-video'] = {
			id: 'other-video',
			url: 'https://www.youtube.com/watch?v=vidZ',
			videoId: 'vidZ',
			profileId: 'p1',
			status: DownloadStatus.FAILED,
			userId: null,
		};

		await (downloadService as any).sweepSupersededRows(downloads['done']);

		expect(downloads['stale-failed']).toBeUndefined();
		expect(downloads['stale-pending']).toBeUndefined();
		// A different profile is a deliberate template change — keep it.
		expect(downloads['other-profile']).toBeDefined();
		expect(downloads['other-video']).toBeDefined();
	});
});

describe('sweepStaleDuplicateRows (boot sweep)', () => {
	it('removes FAILED and PENDING rows whose video already completed under the same profile', async () => {
		downloads['done'] = {
			id: 'done',
			url: 'https://www.youtube.com/watch?v=vidC',
			videoId: 'vidC',
			profileId: 'p1',
			status: DownloadStatus.COMPLETED,
			filepath: '/media/library/vidC.mp4',
			userId: null,
		};
		existingFiles.add('/media/library/vidC.mp4');
		downloads['stale-failed'] = {
			id: 'stale-failed',
			url: 'https://www.youtube.com/watch?v=vidC',
			videoId: 'vidC',
			profileId: 'p1',
			status: DownloadStatus.FAILED,
			createdAt: new Date('2026-09-01'),
			userId: null,
		};
		downloads['stale-pending'] = {
			id: 'stale-pending',
			url: 'https://www.youtube.com/watch?v=vidC',
			videoId: 'vidC',
			profileId: 'p1',
			status: DownloadStatus.PENDING,
			createdAt: new Date('2026-09-02'),
			userId: null,
		};

		const removed = await downloadService.sweepStaleDuplicateRows();

		expect(removed).toBe(2);
		expect(downloads['stale-failed']).toBeUndefined();
		expect(downloads['stale-pending']).toBeUndefined();
		expect(downloads['done']).toBeDefined();
	});

	it('keeps a failed row whose completed twin lost its file on disk', async () => {
		downloads['done'] = {
			id: 'done',
			url: 'https://www.youtube.com/watch?v=vidC',
			videoId: 'vidC',
			profileId: 'p1',
			status: DownloadStatus.COMPLETED,
			filepath: '/media/library/vidC.mp4',
			userId: null,
		};
		downloads['stale-failed'] = {
			id: 'stale-failed',
			url: 'https://www.youtube.com/watch?v=vidC',
			videoId: 'vidC',
			profileId: 'p1',
			status: DownloadStatus.FAILED,
			createdAt: new Date('2026-09-01'),
			userId: null,
		};
		// File gone — the video is no longer "already downloaded".

		const removed = await downloadService.sweepStaleDuplicateRows();

		expect(removed).toBe(0);
		expect(downloads['stale-failed']).toBeDefined();
	});

	it('keeps only the newest FAILED row per video and profile', async () => {
		downloads['old-dupe'] = {
			id: 'old-dupe',
			url: 'https://www.youtube.com/watch?v=vidD',
			videoId: 'vidD',
			profileId: 'p1',
			status: DownloadStatus.FAILED,
			createdAt: new Date('2026-09-01'),
			userId: null,
		};
		downloads['new-dupe'] = {
			id: 'new-dupe',
			url: 'https://www.youtube.com/watch?v=vidD',
			videoId: 'vidD',
			profileId: 'p1',
			status: DownloadStatus.FAILED,
			createdAt: new Date('2026-09-10'),
			userId: null,
		};

		const removed = await downloadService.sweepStaleDuplicateRows();

		expect(removed).toBe(1);
		expect(downloads['old-dupe']).toBeUndefined();
		expect(downloads['new-dupe']).toBeDefined();
	});
});

describe('subscription purge (queued, reports over SSE)', () => {
	function seedOwned(id: string, storagePool: string, extra: Record<string, any> = {}) {
		downloads[id] = {
			id,
			url: `https://www.youtube.com/watch?v=${id}`,
			videoId: id,
			title: `Video ${id}`,
			status: DownloadStatus.COMPLETED,
			storagePool,
			subscriptionId: 'sub-1',
			filepath: null,
			userId: null,
			...extra,
		};
	}

	describe('capture (queueSubscriptionPurge)', () => {
		it('snapshots the selected pools and hands them to the queue without deleting yet', async () => {
			seedOwned('c1', 'cache');
			seedOwned('c2', 'cache');
			seedOwned('l1', 'library');
			seedOwned('other-sub', 'cache', { subscriptionId: 'sub-2' });

			const summary = await downloadService.queueSubscriptionPurge('sub-1', ['cache'], 'user-9');

			expect(summary).toEqual({ queued: 2, cache: 2, library: 0, skippedProtected: 0 });
			// The request only captures the list — the queue worker does the deleting,
			// which is what keeps a large library off the HTTP timeout.
			expect(downloads['c1']).toBeDefined();
			expect(downloads['c2']).toBeDefined();

			expect(enqueueCalls).toHaveLength(1);
			expect(enqueueCalls[0].type).toBe('purge');
			expect(enqueueCalls[0].payload.userId).toBe('user-9');
			expect(enqueueCalls[0].payload.items.map((i: any) => i.id).sort()).toEqual(['c1', 'c2']);
			// The library twin and another subscription's row are both out of scope.
			expect(enqueueCalls[0].payload.items.some((i: any) => i.id === 'l1')).toBe(false);
			expect(enqueueCalls[0].payload.items.some((i: any) => i.id === 'other-sub')).toBe(false);
		});

		it('excludes pinned rows in either pool and reports how many were kept', async () => {
			seedOwned('c1', 'cache');
			seedOwned('pinned-cache', 'cache', { protected: true });
			seedOwned('pinned-library', 'library', { protected: true });

			const summary = await downloadService.queueSubscriptionPurge(
				'sub-1',
				['cache', 'library'],
				'user-9',
			);

			expect(summary).toEqual({ queued: 1, cache: 1, library: 0, skippedProtected: 2 });
			expect(enqueueCalls[0].payload.items).toEqual([{ id: 'c1', pool: 'cache' }]);
		});

		it('queues nothing when neither checkbox is selected', async () => {
			seedOwned('c1', 'cache');
			seedOwned('l1', 'library');

			const summary = await downloadService.queueSubscriptionPurge('sub-1', [], 'user-9');

			expect(summary).toEqual({ queued: 0, cache: 0, library: 0, skippedProtected: 0 });
			expect(enqueueCalls).toHaveLength(0);
			expect(downloads['c1']).toBeDefined();
			expect(downloads['l1']).toBeDefined();
		});
	});

	describe('execution (purgeDownloadItems)', () => {
		it('deletes the captured rows and streams progress then completion to the requester', async () => {
			seedOwned('c1', 'cache');
			seedOwned('l1', 'library');
			archiveDb['c1'] = { videoId: 'c1', url: 'https://www.youtube.com/watch?v=c1', title: 'c1' };

			const result = await downloadService.purgeDownloadItems(
				[
					{ id: 'c1', pool: 'cache' },
					{ id: 'l1', pool: 'library' },
				],
				'user-9',
			);

			expect(result).toEqual({ deleted: 2, failed: 0, libraryDeleted: 1 });
			expect(downloads['c1']).toBeUndefined();
			expect(downloads['l1']).toBeUndefined();
			// Archive entry goes too, so re-adding the subscription re-downloads.
			expect(archiveDb['c1']).toBeUndefined();

			expect(sseEmitter.broadcastToUser).toHaveBeenCalledWith(
				'subscription:purge:progress',
				{ done: 1, total: 2, id: 'c1' },
				'user-9',
			);
			expect(sseEmitter.broadcastToUser).toHaveBeenCalledWith(
				'subscription:purge:progress',
				{ done: 2, total: 2, id: 'l1' },
				'user-9',
			);
			expect(sseEmitter.broadcastToUser).toHaveBeenCalledWith(
				'subscription:purge:complete',
				{ total: 2, deleted: 2, failed: 0 },
				'user-9',
			);
		});

		it('broadcasts to everyone when no requester is known', async () => {
			seedOwned('c1', 'cache');

			await downloadService.purgeDownloadItems([{ id: 'c1', pool: 'cache' }]);

			expect(sseEmitter.broadcast).toHaveBeenCalledWith('subscription:purge:complete', {
				total: 1,
				deleted: 1,
				failed: 0,
			});
		});

		it('keeps going past a failing delete and reports it in the completion', async () => {
			seedOwned('c1', 'cache');
			seedOwned('c2', 'cache');
			const deleteSpy = vi
				.spyOn(downloadService, 'deleteDownload')
				.mockImplementation(async (id: string) => {
					if (id === 'c1') throw new Error('EBUSY');
					delete downloads[id];
				});

			const result = await downloadService.purgeDownloadItems(
				[
					{ id: 'c1', pool: 'cache' },
					{ id: 'c2', pool: 'cache' },
				],
				null,
			);

			expect(result).toEqual({ deleted: 1, failed: 1, libraryDeleted: 0 });
			expect(deleteSpy).toHaveBeenCalledTimes(2);
			expect(sseEmitter.broadcast).toHaveBeenCalledWith('subscription:purge:complete', {
				total: 2,
				deleted: 1,
				failed: 1,
			});
			deleteSpy.mockRestore();
		});

		it('asks Jellyfin to rescan only when library media was removed', async () => {
			const scanSpy = vi.spyOn(libraryService, 'triggerLibraryScan').mockResolvedValue(undefined);

			seedOwned('c1', 'cache');
			await downloadService.purgeDownloadItems([{ id: 'c1', pool: 'cache' }]);
			expect(scanSpy).not.toHaveBeenCalled();

			seedOwned('l1', 'library');
			await downloadService.purgeDownloadItems([{ id: 'l1', pool: 'library' }]);
			expect(scanSpy).toHaveBeenCalledTimes(1);
		});
	});
});
