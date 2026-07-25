import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DownloadStatus } from '@prisma/client';

// In-memory download store backing the prisma mock.
const downloads: Record<string, any> = {};

vi.mock('../db', () => ({
	prisma: {
		download: {
			findUnique: vi.fn(async ({ where }) => downloads[where.id] ?? null),
			update: vi.fn(async ({ where, data }) => {
				downloads[where.id] = { ...downloads[where.id], ...data };
				return { ...downloads[where.id], profile: {} };
			}),
			delete: vi.fn(async ({ where }) => {
				delete downloads[where.id];
			}),
			findFirst: vi.fn(async () => null),
		},
		archive: {
			deleteMany: vi.fn(async () => ({ count: 0 })),
		},
	},
}));

// Keep SSE + notifications inert.
vi.mock('../sse/emitter', () => ({
	sseEmitter: {
		broadcast: vi.fn(),
		broadcastToUser: vi.fn(),
		setInitialStateCallback: vi.fn(),
	},
}));

import { downloadService } from './download.service';
import { ytdlpService } from './ytdlp.service';

const ID = 'dl-cancel-race';

describe('cancelDownload race with the process close handler', () => {
	beforeEach(() => {
		for (const k of Object.keys(downloads)) delete downloads[k];
		downloads[ID] = {
			id: ID,
			url: 'https://youtube.com/watch?v=x',
			title: 'x',
			status: DownloadStatus.DOWNLOADING,
			retryCount: 0,
			filepath: null,
		};
		// Reset internal maps between tests.
		(downloadService as any).activeProcesses.clear();
		(downloadService as any).retryTimeouts.clear();
		(downloadService as any).cancelledDownloads?.clear();
	});

	it('does not schedule a retry when an error arrives mid-cancel', async () => {
		// Simulate a live process. killProcess is intentionally slow (mirrors the
		// real SIGTERM → wait → SIGKILL flow) so the close-handler error can race
		// against the cancel.
		const fakeProc = { pid: 4321, killed: false } as any;
		(downloadService as any).activeProcesses.set(ID, fakeProc);
		const killSpy = vi
			.spyOn(ytdlpService, 'killProcess')
			.mockImplementation(() => new Promise((r) => setTimeout(r, 50)));

		// Start cancelling but don't await — kill is still in flight.
		const cancelling = downloadService.cancelDownload(ID);

		// The dying process reports `code === null`, which surfaces as an error and
		// reaches handleDownloadError while the cancel is mid-flight.
		await (downloadService as any).handleDownloadError(ID, 'yt-dlp exited with code null');

		await cancelling;

		// A cancelled download must NOT be retried.
		expect((downloadService as any).retryTimeouts.has(ID)).toBe(false);
		expect(downloads[ID].retryCount).toBe(0);
		expect(downloads[ID].status).toBe(DownloadStatus.CANCELLED);

		killSpy.mockRestore();
	});

	it('still retries a genuine (non-cancelled) error', async () => {
		vi.useFakeTimers();
		try {
			await (downloadService as any).handleDownloadError(ID, 'network blip');
			expect((downloadService as any).retryTimeouts.has(ID)).toBe(true);
			expect(downloads[ID].retryCount).toBe(1);
		} finally {
			const t = (downloadService as any).retryTimeouts.get(ID);
			if (t) clearTimeout(t);
			(downloadService as any).retryTimeouts.delete(ID);
			vi.useRealTimers();
		}
	});
});
