import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type FakeMessageEvent = { data: string };

class FakeEventSource {
	static instances: FakeEventSource[] = [];
	url: string;
	closed = false;
	onerror: (() => void) | null = null;
	private listeners = new Map<string, Set<(event: FakeMessageEvent) => void>>();

	constructor(url: string) {
		this.url = url;
		FakeEventSource.instances.push(this);
	}

	addEventListener(type: string, listener: (event: FakeMessageEvent) => void) {
		if (!this.listeners.has(type)) this.listeners.set(type, new Set());
		this.listeners.get(type)!.add(listener);
	}

	close() {
		this.closed = true;
	}

	emit(type: string, data?: unknown) {
		for (const listener of this.listeners.get(type) ?? []) {
			listener({ data: data === undefined ? '{}' : JSON.stringify(data) });
		}
	}
}

// Module-level $state means store state survives between tests unless the
// module registry is reset — each test re-evaluates the module fresh.
async function freshStore() {
	return await import('./sse.svelte');
}

describe('SSE store', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('EventSource', FakeEventSource);
		FakeEventSource.instances = [];
		vi.resetModules();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('replaces and then removes a download when it completes', async () => {
		const sse = await freshStore();
		sse.connectSSE();
		const es = FakeEventSource.instances[0];
		es.emit('connected');
		expect(sse.getSSEState().connected).toBe(true);

		es.emit('download:created', { id: 'd1', status: 'DOWNLOADING', progress: 10 });
		es.emit('download:progress', { id: 'd1', progress: 47.5 });
		expect(sse.getSSEState().downloads[0].progress).toBe(47.5);

		const seen: any[] = [];
		sse.onSSEEvent('download:complete', (data) => seen.push(data));

		es.emit('download:status', { id: 'd1', status: 'PROCESSING' });
		es.emit('download:complete', {
			id: 'd1',
			download: { id: 'd1', status: 'COMPLETED', filesize: '123' },
		});

		expect(seen).toEqual([
			{ id: 'd1', download: { id: 'd1', status: 'COMPLETED', filesize: '123' } },
		]);
		expect(sse.getSSEState().downloads[0].status).toBe('COMPLETED');

		vi.advanceTimersByTime(3000);
		expect(sse.getSSEState().downloads).toHaveLength(0);
	});

	it('removes a failed download after a delay and lets a retry re-add it', async () => {
		const sse = await freshStore();
		sse.connectSSE();
		const es = FakeEventSource.instances[0];
		es.emit('connected');

		es.emit('download:created', { id: 'd1', status: 'DOWNLOADING' });
		es.emit('download:failed', { id: 'd1', error: 'boom' });
		expect(sse.getSSEState().downloads[0].status).toBe('FAILED');

		vi.advanceTimersByTime(5000);
		expect(sse.getSSEState().downloads).toHaveLength(0);

		// retry: the server re-broadcasts the reset row as download:created
		es.emit('download:created', { id: 'd1', status: 'PENDING', error: null });
		expect(sse.getSSEState().downloads).toHaveLength(1);
		expect(sse.getSSEState().downloads[0].status).toBe('PENDING');
	});

	it('drops stale entries on reconnect — the server replay is the truth', async () => {
		const sse = await freshStore();
		sse.connectSSE();
		const es = FakeEventSource.instances[0];
		es.emit('connected');
		es.emit('download:created', { id: 'd1', status: 'DOWNLOADING', progress: 47 });

		// Connection drops; d1 completes while we are away. Its terminal
		// event is lost in the gap and is never replayed.
		es.onerror!();
		expect(sse.getSSEState().connected).toBe(false);

		vi.advanceTimersByTime(5000);
		const es2 = FakeEventSource.instances[1];
		es2.emit('connected');

		// The on-connect replay only contains still-active downloads — the
		// stale d1 entry must not linger as a zombie card.
		expect(sse.getSSEState().downloads.map((d: any) => d.id)).toEqual([]);

		es2.emit('download:created', { id: 'd2', status: 'PROCESSING' });
		expect(sse.getSSEState().downloads.map((d: any) => d.id)).toEqual(['d2']);
	});

	it('detects a silently dead connection (missed pings) and reconnects', async () => {
		const sse = await freshStore();
		sse.connectSSE();
		const es = FakeEventSource.instances[0];
		es.emit('connected');
		es.emit('download:created', { id: 'd1', status: 'DOWNLOADING', progress: 47 });

		// Zombie connection: no onerror, no events at all. The server pings
		// every 30s, so ~75s of total silence means the pipe is dead even
		// though EventSource never noticed.
		vi.advanceTimersByTime(90_000);
		expect(FakeEventSource.instances.length).toBe(2);
		expect(FakeEventSource.instances[0].closed).toBe(true);

		// The fresh connection replays active state, healing the card list.
		const es2 = FakeEventSource.instances[1];
		es2.emit('connected');
		es2.emit('download:created', { id: 'd1', status: 'PROCESSING' });
		expect(sse.getSSEState().downloads[0].status).toBe('PROCESSING');
	});

	it('keeps the connection alive while pings keep arriving', async () => {
		const sse = await freshStore();
		sse.connectSSE();
		const es = FakeEventSource.instances[0];
		es.emit('connected');

		for (let i = 0; i < 10; i++) {
			vi.advanceTimersByTime(30_000);
			es.emit('ping');
		}
		expect(FakeEventSource.instances.length).toBe(1);
		expect(sse.getSSEState().connected).toBe(true);
	});
});
