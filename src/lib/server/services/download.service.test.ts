import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DownloadStatus } from '@prisma/client';

// In-memory stores backing the prisma mock.
const downloads: Record<string, any> = {};
const archiveDb: Record<string, any> = {};
const jobQueueRows: any[] = [];
const enqueueCalls: any[] = [];

vi.mock('../db', () => ({
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
}));

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
	(downloadService as any).cancelledDownloads.clear();
	(downloadService as any).handlingError.clear();
	(downloadService as any).retryTimeouts.clear();
	vi.restoreAllMocks();
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
