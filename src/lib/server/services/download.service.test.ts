import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DownloadStatus } from '@prisma/client';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// In-memory stores backing the prisma mock.
const downloads: Record<string, any> = {};
const archiveDb: Record<string, any> = {};
const jobQueueRows: any[] = [];
const enqueueCalls: any[] = [];
const linkDb: Record<string, any> = {};
// DownloadTask rows (per-step progress records) as the prisma mock keeps them.
const taskRows: any[] = [];
let taskSeq = 0;

// Filesystem paths treated as existing on disk — wired into the service via
// the fileExistsOnDisk spy in beforeEach (builtin-import mocking doesn't
// reach source files under vitest).
const existingFiles = new Set<string>();

// Stands in for the cookie resolver so a test can say exactly which session and
// proxy a given user resolves to. The resolver itself (temp-file lifetime,
// precedence, dangling-path handling) is covered by ytdlp-cookies.test.ts; what
// is asserted here is which userId each call site asks for and that the answer
// reaches yt-dlp. `calls` records every resolution.
const cookieStore = {
	links: new Map<
		string,
		{ cookiePath: string; proxyUrl: string | null; extraFlags?: string[]; needsRelink?: boolean }
	>(),
	settingsCookiePath: null as string | null,
	globalProxy: null as string | null,
	// settings.ytdlpExtraFlags, mirrored here because the resolver mock applies
	// the "account flags win when non-empty" rule the real one applies.
	serverFlags: [] as string[],
	calls: [] as { userId: string | null | undefined; source: string; cookiePath: string | null }[],
};

vi.mock('../db', () => {
	const toTime = (v: any): number | null => {
		// Normalise Date / ISO string / epoch to milliseconds, null stays null.
		if (v == null) return null;
		const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
		return Number.isNaN(t) ? null : t;
	};

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
		// Owner equality, null included: arming a re-link's rows must not pick up
		// the rows with no owner, which run on the server-wide credential.
		if (where.userId !== undefined && d.userId !== where.userId) return false;
		if (where.storagePool !== undefined) {
			if (where.storagePool?.in) {
				if (!where.storagePool.in.includes(d.storagePool)) return false;
			} else if (d.storagePool !== where.storagePool) {
				return false;
			}
		}
		if (where.filepath?.not === null && d.filepath == null) return false;
		// Auto-heal selection: nextHealAt { not: null, lte } and healAttempts { lt }.
		if (where.nextHealAt !== undefined) {
			const at = toTime(d.nextHealAt);
			if (where.nextHealAt.not === null && at === null) return false;
			if (where.nextHealAt.lte !== undefined) {
				if (at === null || at > toTime(where.nextHealAt.lte)!) return false;
			}
		}
		if (where.healAttempts?.lt !== undefined && !(d.healAttempts < where.healAttempts.lt)) {
			return false;
		}
		return true;
	};

	return {
		prisma: {
			download: {
				findUnique: vi.fn(async ({ where }: any) => {
					const d = downloads[where.id];
					return d ? { ...d, profile: { customFlags: [], ...d.profile } } : null;
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
				findMany: vi.fn(async ({ where, orderBy, take, skip }: any) => {
					const rows = Object.values(downloads).filter((d: any) => matchesWhere(d, where));
					// Single-key orderBy only (all callers use one); createdAt is the
					// default, matching Prisma's insertion-order fallback closely enough.
					const order = Array.isArray(orderBy) ? orderBy[0] : orderBy;
					const key = order ? Object.keys(order)[0] : 'createdAt';
					const dir = order?.[key] === 'desc' ? -1 : 1;
					rows.sort((a: any, b: any) => {
						const av = toTime(a[key]);
						const bv = toTime(b[key]);
						if (av === null && bv === null) return 0;
						if (av === null) return -1; // nulls first on asc, last on desc
						if (bv === null) return 1;
						return dir * (av - bv);
					});
					const paged = skip ? rows.slice(skip) : rows;
					const limited = take != null ? paged.slice(0, take) : paged;
					return limited.map((d: any) => ({ ...d }));
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
			// Per-step task rows. `create` hands back a fresh id each time so the
			// service's task map can key on it, and `update` just echoes the row.
			downloadTask: {
				create: vi.fn(async ({ data }: any) => {
					const row = { id: `task-${++taskSeq}`, ...data };
					taskRows.push(row);
					return { ...row };
				}),
				update: vi.fn(async ({ where, data }: any) => {
					const row = taskRows.find((t) => t.id === where.id) ?? { id: where.id };
					Object.assign(row, data);
					return { ...row };
				}),
				updateMany: vi.fn(async ({ where, data }: any) => {
					let count = 0;
					for (const t of taskRows) {
						if (t.downloadId !== where.downloadId) continue;
						if (where.type !== undefined && t.type !== where.type) continue;
						// Status filter, scalar or { in: [...] }: completeDownload's
						// sweeps key on it, and ignoring it here would let the
						// pending→skipped sweep clobber a row another status wrote.
						if (where.status !== undefined) {
							if (where.status?.in) {
								if (!where.status.in.includes(t.status)) continue;
							} else if (t.status !== where.status) continue;
						}
						Object.assign(t, data);
						count++;
					}
					return { count };
				}),
				findMany: vi.fn(async ({ where }: any) =>
					taskRows.filter((t) => t.downloadId === where?.downloadId).map((t) => ({ ...t })),
				),
			},
			eventLog: {
				create: vi.fn(async () => ({})),
				deleteMany: vi.fn(async () => ({ count: 0 })),
			},
			settings: {
				findUnique: vi.fn(async () => ({})),
			},
			youTubeLink: {
				findUnique: vi.fn(async ({ where }: any) => linkDb[where.userId] ?? null),
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

vi.mock('../utils/ytdlp-cookies', () => ({
	withYouTubeCookies: vi.fn(async (userId: string | null | undefined, fn: any) => {
		const link = userId ? cookieStore.links.get(userId) : undefined;
		// A dead session falls back to the admin file exactly as the real resolver
		// does, so a test can put the download path in that state.
		const deadSession = link?.needsRelink === true;
		const cookiePath = link && !deadSession ? link.cookiePath : cookieStore.settingsCookiePath;
		const source = link && !deadSession ? 'link' : cookiePath ? 'settings' : 'none';
		const extraFlags = link?.extraFlags ?? [];
		cookieStore.calls.push({ userId, source, cookiePath });
		return fn({
			cookiePath,
			proxyUrl: link?.proxyUrl ?? cookieStore.globalProxy,
			source,
			needsRelink: deadSession,
			extraFlags,
			defaultExtraFlags: extraFlags.length > 0 ? extraFlags : cookieStore.serverFlags,
		});
	}),
}));

import { downloadService } from './download.service';
import { queueService } from './queue.service';
import { sseEmitter } from '../sse/emitter';
import { prisma } from '../db';
import { ytdlpService } from './ytdlp.service';
import { libraryService } from './library.service';
import { runWithRequestContext, setActingUser } from '../request-context';
import {
	armRateLimitCooldown,
	isRateLimitCooldownActive,
	resetRateLimitCooldown,
} from '../utils/rate-limit-cooldown';

const ID = 'dl-retry-1';

function seedDownload(extra: Record<string, any> = {}) {
	downloads[ID] = {
		id: ID,
		url: 'https://www.youtube.com/watch?v=vid1',
		title: 'Some Video',
		status: DownloadStatus.DOWNLOADING,
		retryCount: 0,
		healAttempts: 0,
		nextHealAt: null,
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
	taskRows.length = 0;
	existingFiles.clear();
	for (const k of Object.keys(linkDb)) delete linkDb[k];
	cookieStore.links.clear();
	cookieStore.settingsCookiePath = null;
	cookieStore.globalProxy = null;
	cookieStore.serverFlags = [];
	cookieStore.calls.length = 0;
	(downloadService as any).cancelledDownloads.clear();
	(downloadService as any).handlingError.clear();
	(downloadService as any).retryTimeouts.clear();
	(downloadService as any).downloadOwners.clear();
	(downloadService as any).lastCookieSource.clear();
	(downloadService as any).lastErrorLine.clear();
	(downloadService as any).downloadTaskIds.clear();
	(downloadService as any).processingSteps.clear();
	// Per-user link-expiry notices are throttled; a leftover timestamp would
	// silently swallow the broadcast the next test asserts on.
	(downloadService as any).lastLinkExpiryNoticeAt.clear();
	// vi.fn()s from the module factories keep their call history otherwise, so a
	// test that counts broadcasts would count its neighbours' too.
	(sseEmitter.broadcast as any).mockClear();
	(sseEmitter.broadcastToUser as any).mockClear();
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

	it('runs a metadata-phase bot check through the same retry gate as a download failure', async () => {
		// The 30 production bot-check rows all carried retryCount = 3, which is
		// what an ungated 1s/2s/4s cycle leaves behind. The gate lives in
		// handleDownloadError, which BOTH queue handlers route into — this test
		// pins that routing for the metadata phase, i.e. a future handler that
		// re-enqueues on its own (bypassing handleDownloadError) reddens this.
		const registered = new Map<string, any>();
		(queueService.registerHandler as any).mockImplementation((type: string, handler: any) =>
			registered.set(type, handler),
		);
		downloadService.registerJobHandlers();

		const BOT_CHECK =
			'Metadata fetch failed: RateLimitError: [youtube] vid1: Sign in to confirm you\u2019re not a bot. Use --cookies for the authentication.';
		seedDownload({ retryCount: 0 });
		vi.spyOn(downloadService as any, 'fetchMetadata').mockRejectedValue(new Error(BOT_CHECK));
		resetRateLimitCooldown();

		await registered.get('metadata')({ payload: { downloadId: ID } });

		// Terminal on the first attempt: no quick retry, no second metadata job.
		expect((downloadService as any).retryTimeouts.has(ID)).toBe(false);
		expect(downloads[ID].retryCount).toBe(0);
		expect(downloads[ID].status).toBe(DownloadStatus.FAILED);
		expect(downloads[ID].error).toContain('not a bot');
		expect(enqueueCalls).toHaveLength(0);
		expect(isRateLimitCooldownActive()).toBe(true);
		resetRateLimitCooldown();
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

describe('subtitle fetch failure is not fatal', () => {
	// Verbatim from six production rows: the video was fine, only the timedtext
	// request was refused, and yt-dlp's non-zero exit threw the whole download
	// away — which the RSS window then forgot about.
	const SUBTITLE_429 =
		"ERROR: Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests";
	const MEDIA_403 = 'ERROR: Unable to download video data: HTTP Error 403: Forbidden';

	let dir: string;
	let mediaPath: string;

	beforeEach(() => {
		// A real temp file, because the service's own `stat` (a builtin import
		// vitest cannot mock here) is what proves the media really landed.
		dir = mkdtempSync(join(tmpdir(), 'wytui-sub-'));
		mediaPath = join(dir, 'Some Video.mp4');
		writeFileSync(mediaPath, Buffer.alloc(2048, 1));
		existingFiles.add(mediaPath);
		// Completing a download kicks off cache-quota enforcement, which needs a
		// prisma aggregate this file's mock does not implement. Out of scope here —
		// stub it so the completion under test is the only thing that runs.
		vi.spyOn(libraryService, 'enforceCacheQuota').mockResolvedValue(undefined as any);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	/**
	 * Drive the real spawn/close path of runYtdlpDownload with a fake process
	 * that reports `exitCode`, and whose stderr "ERROR" line is `errorLine`.
	 */
	async function runSpawn(opts: { exitCode: number; errorLine: string | null; filepath: string }) {
		seedDownload({
			status: DownloadStatus.DOWNLOADING,
			profileId: 'p1',
			videoId: 'vid1',
			storagePool: 'cache',
			customFlags: ['--write-subs', '--embed-subs', '--sub-langs', 'en'],
			filepath: opts.filepath,
		});
		const download = { ...downloads[ID], profile: { customFlags: [] } };
		const proc = new EventEmitter() as any;
		vi.spyOn(ytdlpService, 'spawnDownload').mockImplementation((() => {
			// The service clears the previous attempt's error line immediately
			// before spawning, so this is where a real stderr line would land.
			if (opts.errorLine) (downloadService as any).lastErrorLine.set(ID, opts.errorLine);
			return proc;
		}) as any);
		vi.spyOn(ytdlpService, 'buildArgs').mockReturnValue(['--dummy']);

		const settings = {
			downloadPath: dir,
			useAria2c: false,
			downloadStallTimeoutSeconds: 0,
		} as any;
		const ctx = {
			cookiePath: null,
			proxyUrl: null,
			source: 'none',
			needsRelink: false,
			extraFlags: [],
			defaultExtraFlags: [],
		} as any;

		// Both mocks are module-level and accumulate for the whole file, so the
		// assertions in these tests are scoped to what this spawn writes.
		(prisma.download.update as any).mockClear();
		(prisma.eventLog.create as any).mockClear();

		const done = (downloadService as any).runYtdlpDownload(download, settings, ctx);
		// runYtdlpDownload attaches the close listener only after its setup
		// awaits (task rows, flag resolution), so the exit has to arrive on a
		// later macrotask or the event is emitted into an empty listener list.
		setTimeout(() => proc.emit('close', opts.exitCode), 0);
		return done;
	}

	it('lands COMPLETED when the video is on disk and only captions were lost', async () => {
		await runSpawn({ exitCode: 1, errorLine: SUBTITLE_429, filepath: mediaPath });

		expect(downloads[ID].status).toBe(DownloadStatus.COMPLETED);
		expect(downloads[ID].error).toBeNull();
		expect(downloads[ID].progress).toBe(100);
		// No quick-retry cycle was scheduled — nothing failed from the app's view.
		expect((downloadService as any).retryTimeouts.has(ID)).toBe(false);

		// The loss is visible on the per-step task list, and survives
		// completeDownload's "mark the rest completed" sweep.
		const subTask = taskRows.find((t) => t.downloadId === ID && t.type === 'subtitle');
		expect(subTask).toBeDefined();
		expect(subTask.status).toBe('failed');
		expect(subTask.message).toContain('429');

		// …and in the admin event log as a warning, not a failure.
		const warning = (prisma.eventLog.create as any).mock.calls
			.map((c: any[]) => c[0]?.data)
			.find((d: any) => d?.type === 'download.warning');
		expect(warning).toBeDefined();
		expect(warning.message).toContain('without subtitles');
		expect(warning.message).toContain('Some Video');
		expect(
			(prisma.eventLog.create as any).mock.calls
				.map((c: any[]) => c[0]?.data)
				.some((d: any) => d?.type === 'download.failed'),
		).toBe(false);
	});

	it('still fails when the media never landed', async () => {
		existingFiles.delete(mediaPath);

		await expect(
			runSpawn({ exitCode: 1, errorLine: SUBTITLE_429, filepath: mediaPath }),
		).rejects.toThrow('Too Many Requests');

		// Row untouched: the queue handler hands it to handleDownloadError, which
		// owns the retry/FAILED decision. Nothing was marked complete.
		expect(downloads[ID].status).toBe(DownloadStatus.DOWNLOADING);
	});

	it('still fails on a non-subtitle error even when the media is on disk', async () => {
		await expect(
			runSpawn({ exitCode: 1, errorLine: MEDIA_403, filepath: mediaPath }),
		).rejects.toThrow('HTTP Error 403');

		expect(downloads[ID].status).toBe(DownloadStatus.DOWNLOADING);
	});

	it('arms the auto-heal timer for a subtitle failure that could not be tolerated', async () => {
		// The video was never fetched, so this one really is a failure — and it is
		// classified transient, i.e. it comes back on the heal ladder instead of
		// ageing out of the RSS window as a permanent verdict.
		seedDownload({ retryCount: 3, videoId: 'vid1', profileId: 'p1' });

		await (downloadService as any).handleDownloadError(ID, SUBTITLE_429);

		expect(downloads[ID].status).toBe(DownloadStatus.FAILED);
		expect(downloads[ID].nextHealAt).toBeInstanceOf(Date);
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

		it('broadcasts an empty event when no requester is known', async () => {
			seedOwned('c1', 'cache');

			await downloadService.purgeDownloadItems([{ id: 'c1', pool: 'cache' }]);

			// The event still arrives (a waiting UI can settle), but how much of
			// someone else's library just vanished is not for bystanders to see.
			expect(sseEmitter.broadcast).toHaveBeenCalledWith('subscription:purge:progress', {});
			expect(sseEmitter.broadcast).toHaveBeenCalledWith('subscription:purge:complete', {});
			expect(sseEmitter.broadcastToUser).not.toHaveBeenCalled();
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
			expect(sseEmitter.broadcast).toHaveBeenCalledWith('subscription:purge:complete', {});
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

describe('getActiveDownloads scoping', () => {
	beforeEach(() => {
		downloads['a1'] = {
			id: 'a1',
			url: 'https://www.youtube.com/watch?v=a1',
			status: DownloadStatus.DOWNLOADING,
			userId: 'user-1',
		};
		downloads['a2'] = {
			id: 'a2',
			url: 'https://www.youtube.com/watch?v=a2',
			status: DownloadStatus.PENDING,
			userId: 'user-2',
		};
	});

	it('returns only the given user rows', async () => {
		const rows = await downloadService.getActiveDownloads('user-1');
		expect(rows.map((r: any) => r.id)).toEqual(['a1']);
	});

	it('returns nothing at all when there is no user, without querying', async () => {
		// Prisma reads `{ userId: undefined }` as "no filter", so the old guard
		// handed an anonymous SSE connection every user's active downloads.
		const findMany = prisma.download.findMany as unknown as { mock: { calls: unknown[] } };

		for (const userId of [undefined, null]) {
			const before = findMany.mock.calls.length;
			expect(await downloadService.getActiveDownloads(userId as any)).toEqual([]);
			expect(findMany.mock.calls.length).toBe(before);
		}
	});
});

describe('SSE ownership filtering (emitToOwner)', () => {
	// Shaped like a real download:failed payload — raw yt-dlp output plus the
	// server-side path the file landed in.
	const payload = {
		status: DownloadStatus.FAILED,
		error: 'ERROR: unable to download video data: HTTP Error 403: Forbidden',
		filepath: '/data/downloads/someone-elses/Video.mp4',
	};

	it('sends the full payload to the owning user and to nobody else', () => {
		(downloadService as any).downloadOwners.set('own-1', 'user-1');

		(downloadService as any).emitToOwner('download:failed', payload, 'own-1');

		expect(sseEmitter.broadcastToUser).toHaveBeenCalledWith('download:failed', payload, 'user-1');
		expect(sseEmitter.broadcast).not.toHaveBeenCalled();
	});

	it('still announces an ownerless download, but never its payload', () => {
		// No downloadOwners entry: the state a monitor-originated download — or
		// every in-flight row after a server restart — is in.
		(downloadService as any).emitToOwner('download:failed', payload, 'own-2');

		// The event arrives so an open card can settle...
		expect(sseEmitter.broadcast).toHaveBeenCalledWith('download:failed', { id: 'own-2' });
		// ...and what arrives carries the row id and nothing else.
		const [, sent] = (sseEmitter.broadcast as any).mock.calls[0];
		expect(Object.keys(sent)).toEqual(['id']);
		expect(sseEmitter.broadcastToUser).not.toHaveBeenCalled();
	});
});

describe('auto-heal pacing', () => {
	const MIN = 60_000;
	const HOUR = 60 * MIN;
	const STALL = 'Download stalled (no progress for 600s)';
	const BOT_CHECK =
		'Metadata fetch failed: RateLimitError: [youtube] vid1: Sign in to confirm you’re not a bot. Use --cookies for the authentication.';
	const UNAVAILABLE = 'Metadata fetch failed: Error: [youtube] vid1: Video unavailable';

	/** A terminally FAILED row as the heal pass sees it. */
	function seedFailed(id: string, extra: Record<string, any> = {}) {
		downloads[id] = {
			id,
			url: `https://www.youtube.com/watch?v=${id}`,
			videoId: id,
			title: `Video ${id}`,
			status: DownloadStatus.FAILED,
			error: STALL,
			profileId: 'p1',
			retryCount: 3,
			healAttempts: 0,
			nextHealAt: null,
			filepath: null,
			userId: null,
			...extra,
		};
	}

	// A cookie-class terminal failure arms the shared cooldown as a side effect,
	// and the pass stands down while it is active — start every test clean.
	beforeEach(() => {
		resetRateLimitCooldown();
	});

	describe('arming on terminal failure', () => {
		it('arms a transient failure 30 minutes out without spending an attempt', async () => {
			seedDownload({ retryCount: 3, videoId: 'vid1', profileId: 'p1' });
			const before = Date.now();

			await (downloadService as any).handleDownloadError(ID, STALL);

			expect(downloads[ID].status).toBe(DownloadStatus.FAILED);
			expect(downloads[ID].healAttempts).toBe(0);
			const armedAt = new Date(downloads[ID].nextHealAt).getTime();
			expect(armedAt).toBeGreaterThanOrEqual(before + 30 * MIN - 1000);
			expect(armedAt).toBeLessThanOrEqual(Date.now() + 30 * MIN);
		});

		it('does not arm a cookie-gated failure — it waits for new cookies', async () => {
			seedDownload({ retryCount: 3, videoId: 'vid1', profileId: 'p1' });

			await (downloadService as any).handleDownloadError(ID, BOT_CHECK);

			expect(downloads[ID].status).toBe(DownloadStatus.FAILED);
			expect(downloads[ID].nextHealAt).toBeNull();
			expect(downloads[ID].healAttempts).toBe(0);
		});

		it('does not arm a permanent failure', async () => {
			seedDownload({ retryCount: 3, videoId: 'vid1', profileId: 'p1' });

			await (downloadService as any).handleDownloadError(ID, UNAVAILABLE);

			expect(downloads[ID].status).toBe(DownloadStatus.FAILED);
			expect(downloads[ID].nextHealAt).toBeNull();
			expect(downloads[ID].healAttempts).toBe(0);
		});

		it('does not re-arm a row that already spent auto-attempts', async () => {
			// The infinite-loop guard: a failed auto-attempt comes back through the
			// terminal path, and re-arming it here would pin the row at +30 min
			// forever instead of advancing the backoff ladder.
			seedDownload({
				retryCount: 3,
				videoId: 'vid1',
				profileId: 'p1',
				healAttempts: 2,
				nextHealAt: null,
			});

			await (downloadService as any).handleDownloadError(ID, STALL);

			expect(downloads[ID].status).toBe(DownloadStatus.FAILED);
			expect(downloads[ID].nextHealAt).toBeNull();
			expect(downloads[ID].healAttempts).toBe(2);
		});

		it('leaves an already-scheduled heal slot alone when the retry fails again', async () => {
			const slot = new Date(Date.now() - MIN);
			seedDownload({
				retryCount: 3,
				videoId: 'vid1',
				profileId: 'p1',
				healAttempts: 1,
				nextHealAt: slot,
			});

			await (downloadService as any).handleDownloadError(ID, STALL);

			// Only the heal pass moves the slot, so the ladder keeps advancing.
			expect(new Date(downloads[ID].nextHealAt).getTime()).toBe(slot.getTime());
			expect(downloads[ID].healAttempts).toBe(1);
		});
	});

	describe('the pass', () => {
		it('refuses to run while the autoHealEnabled toggle is off', async () => {
			// Belt and braces behind the scheduler's job unregistration: a pass
			// already in flight, or one triggered by hand from the scheduler page,
			// must respect the toggle too.
			seedFailed('due', { nextHealAt: new Date(Date.now() - MIN) });
			vi.spyOn(prisma.settings, 'findUnique').mockResolvedValue({ autoHealEnabled: false } as any);

			expect(await downloadService.healFailedDownloads()).toEqual({
				scanned: 0,
				retried: 0,
				exhausted: 0,
				skipped: 0,
			});
			expect(downloads['due'].healAttempts).toBe(0);
			expect(enqueueCalls).toHaveLength(0);

			// A settings row predating the migration (column absent) means the
			// default — on — so the pass must not silently stop healing.
			(prisma.settings.findUnique as any).mockResolvedValue({} as any);
			expect((await downloadService.healFailedDownloads()).retried).toBe(1);
		});

		it('takes at most 5 due rows, oldest slot first, and schedules the ladder', async () => {
			// Seeded out of due order so the ordering is what is being tested.
			seedFailed('due-3', { nextHealAt: new Date(Date.now() - 3 * MIN) });
			seedFailed('due-1', { nextHealAt: new Date(Date.now() - 1 * MIN) });
			seedFailed('due-5', { nextHealAt: new Date(Date.now() - 5 * MIN) });
			seedFailed('due-2', { nextHealAt: new Date(Date.now() - 2 * MIN) });
			seedFailed('due-4', { nextHealAt: new Date(Date.now() - 4 * MIN) });
			seedFailed('due-6', { nextHealAt: new Date(Date.now() - 6 * MIN) });
			seedFailed('future', { nextHealAt: new Date(Date.now() + HOUR) });
			seedFailed('unarmed');

			const before = Date.now();
			const summary = await downloadService.healFailedDownloads();

			expect(summary).toEqual({ scanned: 5, retried: 5, exhausted: 0, skipped: 0 });
			// The five oldest slots were taken; due-1 waits for the next pass.
			for (const id of ['due-2', 'due-3', 'due-4', 'due-5', 'due-6']) {
				expect(downloads[id].healAttempts).toBe(1);
				const next = new Date(downloads[id].nextHealAt).getTime();
				expect(next).toBeGreaterThanOrEqual(before + 2 * HOUR - 1000);
				expect(next).toBeLessThanOrEqual(Date.now() + 2 * HOUR);
			}
			expect(downloads['due-1'].healAttempts).toBe(0);
			expect(downloads['due-1'].nextHealAt).not.toBeNull();
			expect(downloads['future'].healAttempts).toBe(0);
			expect(downloads['unarmed'].healAttempts).toBe(0);
			// Re-queued through the normal pipeline, 5 metadata jobs.
			expect(enqueueCalls).toHaveLength(5);
			expect(enqueueCalls.every((c) => c.type === 'metadata')).toBe(true);
		});

		it('marks the row as given up on attempt 4 and never selects it again', async () => {
			seedFailed('last', { healAttempts: 3, nextHealAt: new Date(Date.now() - MIN) });

			const summary = await downloadService.healFailedDownloads();

			expect(summary).toEqual({ scanned: 1, retried: 1, exhausted: 1, skipped: 0 });
			expect(downloads['last'].healAttempts).toBe(4);
			expect(downloads['last'].nextHealAt).toBeNull();

			// It failed again, so the row is FAILED with a slot that would be due —
			// the exhausted attempt counter is the only thing keeping it out.
			downloads['last'].status = DownloadStatus.FAILED;
			downloads['last'].nextHealAt = new Date(Date.now() - MIN);
			expect(await downloadService.healFailedDownloads()).toEqual({
				scanned: 0,
				retried: 0,
				exhausted: 0,
				skipped: 0,
			});
			expect(downloads['last'].healAttempts).toBe(4);
		});

		it('stands down entirely while the rate-limit cooldown is active', async () => {
			seedFailed('due', { nextHealAt: new Date(Date.now() - MIN) });
			armRateLimitCooldown();
			(prisma.download.findMany as any).mockClear();

			const summary = await downloadService.healFailedDownloads();

			// A 429 is IP-wide: retrying through the cooldown re-triggers the block.
			expect(summary).toEqual({ scanned: 0, retried: 0, exhausted: 0, skipped: 0 });
			expect(prisma.download.findMany).not.toHaveBeenCalled();
			expect(downloads['due'].healAttempts).toBe(0);
			expect(enqueueCalls).toHaveLength(0);

			resetRateLimitCooldown();
			expect((await downloadService.healFailedDownloads()).retried).toBe(1);
		});

		it('keeps going when one row cannot be retried', async () => {
			seedFailed('boom', { nextHealAt: new Date(Date.now() - 2 * MIN) });
			seedFailed('fine', { nextHealAt: new Date(Date.now() - 1 * MIN) });
			const original = downloadService.retryDownload.bind(downloadService);
			const spy = vi
				.spyOn(downloadService, 'retryDownload')
				.mockImplementation(async (id: string, resetHealState?: boolean) => {
					if (id === 'boom') throw new Error('Download not found');
					return original(id, resetHealState);
				});

			const summary = await downloadService.healFailedDownloads();

			expect(summary).toEqual({ scanned: 2, retried: 1, exhausted: 0, skipped: 1 });
			// The healthy row went through the normal re-queue path…
			expect(downloads['fine'].status).toBe(DownloadStatus.PENDING);
			// …and both rows kept the schedule written before the retry, so the
			// failed one is not due again immediately.
			expect(downloads['boom'].healAttempts).toBe(1);
			expect(downloads['boom'].nextHealAt).not.toBeNull();
			// The heal pass must not hand out a fresh attempt budget by resetting.
			expect(spy).toHaveBeenCalledWith('fine', false);
		});

		it('counts a row discarded as an already-downloaded duplicate as skipped', async () => {
			seedFailed('stale', { nextHealAt: new Date(Date.now() - MIN) });
			downloads['twin'] = {
				id: 'twin',
				url: 'https://www.youtube.com/watch?v=stale',
				videoId: 'stale',
				status: DownloadStatus.COMPLETED,
				profileId: 'p1',
				filepath: '/media/library/stale.mp4',
				userId: null,
			};
			existingFiles.add('/media/library/stale.mp4');

			const summary = await downloadService.healFailedDownloads();

			expect(summary).toEqual({ scanned: 1, retried: 0, exhausted: 0, skipped: 1 });
			expect(downloads['stale']).toBeUndefined();
			expect(enqueueCalls).toHaveLength(0);
		});
	});

	describe('budget reset paths', () => {
		it('a manual retry starts a fresh auto-heal budget', async () => {
			const slot = new Date(Date.now() + HOUR);
			seedDownload({
				status: DownloadStatus.FAILED,
				healAttempts: 3,
				nextHealAt: slot,
			});

			const updated = await downloadService.retryDownload(ID);

			expect(updated.healAttempts).toBe(0);
			expect(updated.nextHealAt).toBeNull();
		});

		it('the heal pass keeps the schedule it just wrote', async () => {
			const slot = new Date(Date.now() + HOUR);
			seedDownload({
				status: DownloadStatus.FAILED,
				healAttempts: 2,
				nextHealAt: slot,
			});

			const updated = await downloadService.retryDownload(ID, false);

			expect(updated.healAttempts).toBe(2);
			expect(new Date(updated.nextHealAt).getTime()).toBe(slot.getTime());
		});

		it('arming after a cookie upload touches only cookie-classified failures', async () => {
			seedFailed('bot', {
				error: BOT_CHECK,
				healAttempts: 4,
				nextHealAt: null,
			});
			seedFailed('members', {
				error:
					'Metadata fetch failed: Error: [youtube] vid2: Join this channel to get access to members-only content.',
				healAttempts: 4,
				nextHealAt: null,
			});
			seedFailed('permanent', { error: UNAVAILABLE });
			seedFailed('transient', { error: STALL });
			seedFailed('already-done', { status: DownloadStatus.COMPLETED, error: BOT_CHECK });

			const before = Date.now();
			const armed = await downloadService.armCookieGatedFailures();

			// New credentials invalidate the old auth failures, so the exhausted
			// budget restarts — but only for the cookie class.
			expect(armed).toBe(2);
			for (const id of ['bot', 'members']) {
				expect(downloads[id].healAttempts).toBe(0);
				expect(new Date(downloads[id].nextHealAt).getTime()).toBeGreaterThanOrEqual(before);
			}
			expect(downloads['permanent'].nextHealAt).toBeNull();
			expect(downloads['transient'].nextHealAt).toBeNull();
			expect(downloads['already-done'].nextHealAt).toBeNull();
		});

		it('a re-link arms its own rows only, the admin upload arms them all', async () => {
			const cookieErr =
				'Metadata fetch failed: Error: [youtube] vid2: Join this channel to get access to members-only content.';
			seedFailed('mine', { error: cookieErr, healAttempts: 4, nextHealAt: null, userId: 'me' });
			seedFailed('other', { error: cookieErr, healAttempts: 4, nextHealAt: null, userId: 'other' });
			// Monitor-originated / ownerless-subscription rows: they never ran on any
			// account's session, so only the server-wide credential can fix them.
			seedFailed('orphan', { error: cookieErr, healAttempts: 4, nextHealAt: null, userId: null });

			expect(await downloadService.armCookieGatedFailures('me')).toBe(1);
			expect(downloads['mine'].healAttempts).toBe(0);
			expect(downloads['other'].healAttempts).toBe(4);
			expect(downloads['orphan'].healAttempts).toBe(4);

			// No userId is the admin upload path: the file is the fallback for every
			// account and the only credential for the ownerless rows.
			expect(await downloadService.armCookieGatedFailures()).toBe(3);
			expect(downloads['other'].healAttempts).toBe(0);
			expect(downloads['orphan'].healAttempts).toBe(0);
		});
	});
});

describe('per-owner cookie resolution', () => {
	const METADATA_SETTINGS = {
		downloadPath: '/downloads',
		cookiePath: null as string | null,
		ytdlpProxyUrl: null as string | null,
		ytdlpExtraFlags: [] as string[],
		maxDurationSeconds: null,
		rydEnabled: false,
		useAria2c: false,
	};

	function stubSettings(overrides: Record<string, any> = {}) {
		vi.spyOn(prisma.settings, 'findUnique').mockResolvedValue({
			...METADATA_SETTINGS,
			...overrides,
		} as any);
	}

	const cookieEventsRecorded = () =>
		(prisma.eventLog.create as any).mock.calls.some(
			(call: any[]) => call[0]?.data?.type === 'cookies.invalidated',
		);

	it('runs the metadata phase with the owner’s linked session', async () => {
		seedDownload({
			status: DownloadStatus.PENDING,
			userId: 'owner-1',
			url: 'https://www.youtube.com/watch?v=vid1',
		});
		stubSettings();
		cookieStore.links.set('owner-1', {
			cookiePath: '/tmp/wytui-yt-owner1.txt',
			proxyUrl: 'socks5h://owner1:1080',
		});
		const fetchSpy = vi.spyOn(ytdlpService, 'fetchMetadata').mockResolvedValue({
			title: 'T',
			videoId: 'vid1',
			liveStatus: null,
		} as any);

		await (downloadService as any).fetchMetadata(ID);

		// Asked for the row's owner, and what it answered is what yt-dlp is handed.
		expect(cookieStore.calls).toEqual([
			{ userId: 'owner-1', source: 'link', cookiePath: '/tmp/wytui-yt-owner1.txt' },
		]);
		expect(fetchSpy.mock.calls[0][1]).toMatchObject({
			cookiePath: '/tmp/wytui-yt-owner1.txt',
			proxyUrl: 'socks5h://owner1:1080',
		});
	});

	it('falls back to the uploaded cookie file when the owner has no link', async () => {
		seedDownload({
			status: DownloadStatus.PENDING,
			userId: 'owner-nolink',
			url: 'https://www.youtube.com/watch?v=vid1',
		});
		stubSettings({ cookiePath: '/data/cookies.txt', ytdlpProxyUrl: 'socks5h://global:1080' });
		cookieStore.settingsCookiePath = '/data/cookies.txt';
		cookieStore.globalProxy = 'socks5h://global:1080';
		const fetchSpy = vi.spyOn(ytdlpService, 'fetchMetadata').mockResolvedValue({
			title: 'T',
			videoId: 'vid1',
			liveStatus: null,
		} as any);

		await (downloadService as any).fetchMetadata(ID);

		expect(cookieStore.calls[0].source).toBe('settings');
		expect(fetchSpy.mock.calls[0][1]).toMatchObject({
			cookiePath: '/data/cookies.txt',
			proxyUrl: 'socks5h://global:1080',
		});
	});

	it('spawns the download with the row owner’s session and its paired proxy', async () => {
		seedDownload({
			status: DownloadStatus.DOWNLOADING,
			userId: 'owner-2',
			customFlags: [],
			profileId: 'p1',
		});
		stubSettings({
			cookiePath: '/data/cookies.txt',
			ytdlpProxyUrl: 'socks5h://global:1080',
			ytdlpExtraFlags: ['--retries', '5'],
		});
		cookieStore.settingsCookiePath = '/data/cookies.txt';
		cookieStore.globalProxy = 'socks5h://global:1080';
		cookieStore.links.set('owner-2', {
			cookiePath: '/tmp/wytui-yt-owner2.txt',
			proxyUrl: 'http://owner2:8080',
			extraFlags: ['--limit-rate', '1M'],
		});
		cookieStore.serverFlags = ['--retries', '5'];

		vi.spyOn(libraryService, 'ensureFreeDiskSpace').mockResolvedValue({ sufficient: true } as any);
		let spawnOptions: any;
		let spawnFlags: string[] = [];
		vi.spyOn(ytdlpService, 'buildArgs').mockImplementation((_url, _out, flags, options: any) => {
			spawnOptions = options;
			spawnFlags = flags as string[];
			// Everything after this point is process handling; the argv is what
			// this test is about.
			throw new Error('args-captured');
		});

		await expect((downloadService as any).executeDownload(ID)).rejects.toThrow('args-captured');

		expect(cookieStore.calls.at(-1)).toEqual({
			userId: 'owner-2',
			source: 'link',
			cookiePath: '/tmp/wytui-yt-owner2.txt',
		});
		expect(spawnOptions.cookiePath).toBe('/tmp/wytui-yt-owner2.txt');
		// The link proxy wins over the global one, and it is the same ctx value
		// that decided the cookie file.
		expect(spawnOptions.proxyUrl).toBe('http://owner2:8080');
		// Same for the flags: the account's own override beats the server-wide
		// default, and it came from the resolver rather than a second link read.
		expect(spawnFlags).toEqual(['--limit-rate', '1M']);
	});

	it('uses the global proxy on the spawn path when the owner has no link', async () => {
		seedDownload({ status: DownloadStatus.DOWNLOADING, userId: null, customFlags: [] });
		stubSettings({ ytdlpProxyUrl: 'socks5h://global:1080' });
		cookieStore.globalProxy = 'socks5h://global:1080';
		vi.spyOn(libraryService, 'ensureFreeDiskSpace').mockResolvedValue({ sufficient: true } as any);
		let spawnOptions: any;
		vi.spyOn(ytdlpService, 'buildArgs').mockImplementation((_url, _out, _flags, options: any) => {
			spawnOptions = options;
			throw new Error('args-captured');
		});

		await expect((downloadService as any).executeDownload(ID)).rejects.toThrow('args-captured');

		expect(cookieStore.calls.at(-1)!.userId).toBeNull();
		expect(spawnOptions.proxyUrl).toBe('socks5h://global:1080');
	});

	it('records cookies.invalidated on a link-only deployment', async () => {
		seedDownload({ retryCount: 3, videoId: 'vid1', userId: 'owner-3' });
		stubSettings({ cookiePath: null });
		cookieStore.links.set('owner-3', { cookiePath: '/tmp/wytui-yt-owner3.txt', proxyUrl: null });
		(downloadService as any).lastCookieInvalidationAt = 0;
		(prisma.eventLog.create as any).mockClear();

		await (downloadService as any).handleDownloadError(
			ID,
			'Metadata fetch failed: Error: [youtube] vid1: Join this channel to get access to members-only content and other perks.',
		);

		// There is no settings.cookiePath here at all — the linked session is the
		// only credential in play, and its failure is still an admin-visible signal.
		await vi.waitFor(() => expect(cookieEventsRecorded()).toBe(true));
	});

	it('keeps the hourly cookie-invalidation throttle', async () => {
		seedDownload({ retryCount: 3, videoId: 'vid1', userId: 'owner-4' });
		stubSettings({ cookiePath: null });
		(downloadService as any).lastCookieInvalidationAt = Date.now();
		(prisma.eventLog.create as any).mockClear();

		await (downloadService as any).handleDownloadError(
			ID,
			'Metadata fetch failed: Error: [youtube] vid1: Join this channel to get access to members-only content and other perks.',
		);
		await new Promise((r) => setTimeout(r, 0));

		expect(cookieEventsRecorded()).toBe(false);
	});

	const linkExpiredCalls = () =>
		(sseEmitter.broadcastToUser as any).mock.calls.filter(
			(c: any[]) => c[0] === 'youtube:link:expired',
		);
	const MEMBER_ONLY =
		'Metadata fetch failed: Error: [youtube] vid1: Join this channel to get access to members-only content and other perks.';

	it('pushes youtube:link:expired to the owner when YouTube rejects the linked session', async () => {
		seedDownload({
			status: DownloadStatus.DOWNLOADING,
			userId: 'owner-live',
			customFlags: [],
			retryCount: 3,
			videoId: 'vid1',
		});
		stubSettings();
		cookieStore.links.set('owner-live', {
			cookiePath: '/tmp/wytui-yt-owner-live.txt',
			proxyUrl: null,
		});
		vi.spyOn(libraryService, 'ensureFreeDiskSpace').mockResolvedValue({ sufficient: true } as any);
		// Stop at the argv: the point is that the spawn recorded which credential
		// it was about to use, and the auth failure that follows is attributed to it.
		vi.spyOn(ytdlpService, 'buildArgs').mockImplementation(() => {
			throw new Error('args-captured');
		});
		await expect((downloadService as any).executeDownload(ID)).rejects.toThrow('args-captured');

		await (downloadService as any).handleDownloadError(ID, MEMBER_ONLY);

		expect(linkExpiredCalls()).toHaveLength(1);
		expect(linkExpiredCalls()[0][1]).toMatchObject({ reason: 'auth-failure' });
		expect(linkExpiredCalls()[0][2]).toBe('owner-live');
	});

	it('attributes the same failure to the admin, not the owner, when the file was the credential', async () => {
		seedDownload({ status: DownloadStatus.DOWNLOADING, userId: null, customFlags: [] });
		stubSettings({ cookiePath: '/data/cookies.txt' });
		cookieStore.settingsCookiePath = '/data/cookies.txt';
		vi.spyOn(libraryService, 'ensureFreeDiskSpace').mockResolvedValue({ sufficient: true } as any);
		vi.spyOn(ytdlpService, 'buildArgs').mockImplementation(() => {
			throw new Error('args-captured');
		});
		await expect((downloadService as any).executeDownload(ID)).rejects.toThrow('args-captured');

		(downloadService as any).lastCookieInvalidationAt = Date.now();
		await (downloadService as any).handleDownloadError(ID, MEMBER_ONLY);

		// A members-only failure with the uploaded file in play is the admin's to
		// fix — pushing "re-link your account" at the downloader is a false alarm.
		expect(linkExpiredCalls()).toHaveLength(0);
	});

	it('pushes youtube:link:expired as soon as the stored session will not decrypt', async () => {
		seedDownload({
			status: DownloadStatus.PENDING,
			userId: 'owner-dead',
			url: 'https://www.youtube.com/watch?v=vid1',
		});
		stubSettings({ cookiePath: '/data/cookies.txt' });
		cookieStore.settingsCookiePath = '/data/cookies.txt';
		cookieStore.links.set('owner-dead', {
			cookiePath: '/tmp/wytui-yt-owner-dead.txt',
			proxyUrl: null,
			needsRelink: true,
		});
		vi.spyOn(ytdlpService, 'fetchMetadata').mockResolvedValue({
			title: 'T',
			videoId: 'vid1',
			liveStatus: null,
		} as any);

		await (downloadService as any).fetchMetadata(ID);

		expect(linkExpiredCalls()).toHaveLength(1);
		expect(linkExpiredCalls()[0][1]).toMatchObject({ reason: 'needs-relink' });
		expect(linkExpiredCalls()[0][2]).toBe('owner-dead');
	});

	it('throttles the link-expiry push per user', async () => {
		seedDownload({
			status: DownloadStatus.PENDING,
			userId: 'owner-batch',
			url: 'https://www.youtube.com/watch?v=vid1',
		});
		stubSettings({ cookiePath: '/data/cookies.txt' });
		cookieStore.settingsCookiePath = '/data/cookies.txt';
		cookieStore.links.set('owner-batch', {
			cookiePath: '/tmp/wytui-yt-owner-batch.txt',
			proxyUrl: null,
			needsRelink: true,
		});
		vi.spyOn(ytdlpService, 'fetchMetadata').mockResolvedValue({
			title: 'T',
			videoId: 'vid1',
			liveStatus: null,
		} as any);

		// A queued batch hits the same dead session on every attempt and every
		// retry — the owner gets told once, not once per video.
		await (downloadService as any).fetchMetadata(ID);
		await (downloadService as any).fetchMetadata(ID);

		expect(linkExpiredCalls()).toHaveLength(1);
	});
});
