let eventSource = $state<EventSource | null>(null);
let connected = $state(false);
let downloads = $state<any[]>([]);

// The server pings every 30s. EventSource fires no error when the peer
// vanishes without a FIN (laptop sleep, NAT timeout, proxy drop) — the
// connection just goes silent while the server keeps it "alive" forever.
// If nothing arrives for 2.5 ping intervals, the pipe is dead: tear it
// down and reconnect.
const PING_TIMEOUT_MS = 75_000;
const WATCHDOG_INTERVAL_MS = 15_000;
let lastMessageAt = Date.now();
let watchdogTimer: ReturnType<typeof setInterval> | null = null;

type EventCallback = (data: any) => void;
const eventCallbacks = new Map<string, Set<EventCallback>>();

export function connectSSE() {
	if (eventSource) return;

	console.log('[SSE Client] Connecting to /api/sse...');
	eventSource = new EventSource('/api/sse');
	lastMessageAt = Date.now();

	// All listeners go through listen() so any message counts as proof of
	// life for the watchdog below.
	function listen(event: string, handler: (e: MessageEvent) => void) {
		eventSource!.addEventListener(event, (e) => {
			lastMessageAt = Date.now();
			handler(e as MessageEvent);
		});
	}

	listen('connected', () => {
		connected = true;
		// The server replays the active downloads right after this event.
		// Anything still held locally ended while we were disconnected —
		// its terminal event was lost in the gap and will never arrive, so
		// drop it instead of leaving a zombie card until a manual refresh.
		downloads = [];
	});

	listen('download:created', (e) => {
		const download = JSON.parse(e.data);

		// Check if already exists
		const index = downloads.findIndex((d) => d.id === download.id);
		if (index >= 0) {
			downloads[index] = download;
		} else {
			downloads = [...downloads, download];
		}
	});

	listen('download:status', (e) => {
		const data = JSON.parse(e.data);

		const index = downloads.findIndex((d) => d.id === data.id);
		if (index >= 0) {
			downloads[index] = { ...downloads[index], ...data };
			downloads = [...downloads]; // Trigger reactivity
		}

		dispatchCallbacks('download:status', data);
	});

	listen('download:metadata', (e) => {
		const data = JSON.parse(e.data);

		const index = downloads.findIndex((d) => d.id === data.id);
		if (index >= 0) {
			downloads[index] = { ...downloads[index], ...data };
			downloads = [...downloads];
		}

		dispatchCallbacks('download:metadata', data);
	});

	listen('download:progress', (e) => {
		const data = JSON.parse(e.data);

		const index = downloads.findIndex((d) => d.id === data.id);
		if (index >= 0) {
			downloads[index] = { ...downloads[index], ...data };
			downloads = [...downloads]; // Trigger reactivity
		}

		dispatchCallbacks('download:progress', data);
	});

	listen('download:complete', (e) => {
		const data = JSON.parse(e.data);
		const { id, download } = data;

		const index = downloads.findIndex((d) => d.id === id);
		if (index >= 0) {
			downloads[index] = download;
			downloads = [...downloads];
		}

		setTimeout(() => {
			downloads = downloads.filter((d) => d.id !== id);
		}, 3000);

		dispatchCallbacks('download:complete', data);
	});

	listen('download:failed', (e) => {
		const { id, error } = JSON.parse(e.data);

		const index = downloads.findIndex((d) => d.id === id);
		if (index >= 0) {
			downloads[index] = { ...downloads[index], status: 'FAILED', error };
			downloads = [...downloads];
		}

		setTimeout(() => {
			downloads = downloads.filter((d) => d.id !== id);
		}, 5000);

		dispatchCallbacks('download:failed', { id, error });
	});

	listen('download:cancelled', (e) => {
		const { id } = JSON.parse(e.data);

		const index = downloads.findIndex((d) => d.id === id);
		if (index >= 0) {
			downloads[index] = { ...downloads[index], status: 'CANCELLED' };
			downloads = [...downloads];
		}

		setTimeout(() => {
			downloads = downloads.filter((d) => d.id !== id);
		}, 3000);

		dispatchCallbacks('download:cancelled', { id });
	});

	listen('download:deleted', (e) => {
		const data = JSON.parse(e.data);
		downloads = downloads.filter((d) => d.id !== data.id);
		dispatchCallbacks('download:deleted', data);
	});

	listen('download:skipped', (e) => {
		const data = JSON.parse(e.data);
		downloads = downloads.filter((d) => d.id !== data.id);
		dispatchCallbacks('download:skipped', data);
	});

	listen('download:tasks', (e) => {
		const data = JSON.parse(e.data);
		dispatchCallbacks('download:tasks', data);
	});

	listen('download:task', (e) => {
		const data = JSON.parse(e.data);
		dispatchCallbacks('download:task', data);
	});

	listen('subscription:checked', (e) => {
		const data = JSON.parse(e.data);
		dispatchCallbacks('subscription:checked', data);
	});

	listen('subscription:check:error', (e) => {
		const data = JSON.parse(e.data);
		dispatchCallbacks('subscription:check:error', data);
	});

	listen('playlist:sync:progress', (e) => {
		const data = JSON.parse(e.data);
		dispatchCallbacks('playlist:sync:progress', data);
	});

	listen('playlist:sync:complete', (e) => {
		const data = JSON.parse(e.data);
		dispatchCallbacks('playlist:sync:complete', data);
	});

	listen('monitor:live', (e) => {
		const data = JSON.parse(e.data);
		dispatchCallbacks('monitor:live', data);
	});

	listen('monitor:update', (e) => {
		const data = JSON.parse(e.data);
		dispatchCallbacks('monitor:update', data);
	});

	listen('ping', () => {
		// Heartbeat, do nothing
	});

	watchdogTimer = setInterval(() => {
		if (!eventSource) return;
		if (Date.now() - lastMessageAt > PING_TIMEOUT_MS) {
			console.warn('[SSE Client] Connection silent for >75s — reconnecting');
			teardown();
			connectSSE();
		}
	}, WATCHDOG_INTERVAL_MS);

	eventSource.onerror = () => {
		console.error('[SSE Client] Connection error, will retry...');
		teardown();

		// Reconnect after 5 seconds
		setTimeout(connectSSE, 5000);
	};
}

function teardown() {
	if (watchdogTimer) {
		clearInterval(watchdogTimer);
		watchdogTimer = null;
	}
	eventSource?.close();
	eventSource = null;
	connected = false;
}

function dispatchCallbacks(event: string, data: any): void {
	const callbacks = eventCallbacks.get(event);
	if (callbacks) {
		for (const cb of callbacks) cb(data);
	}
}

export function onSSEEvent(event: string, callback: EventCallback): () => void {
	if (!eventCallbacks.has(event)) {
		eventCallbacks.set(event, new Set());
	}
	eventCallbacks.get(event)!.add(callback);
	return () => {
		eventCallbacks.get(event)?.delete(callback);
	};
}

export function disconnectSSE() {
	teardown();
}

export function getSSEState() {
	return {
		get connected() {
			return connected;
		},
		get downloads() {
			return downloads;
		},
	};
}
