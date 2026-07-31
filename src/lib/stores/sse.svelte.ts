let eventSource = $state<EventSource | null>(null);
let connected = $state(false);
let downloads = $state<any[]>([]);

type EventCallback = (data: any) => void;
const eventCallbacks = new Map<string, Set<EventCallback>>();

export function connectSSE() {
	if (eventSource) return;

	console.log('[SSE Client] Connecting to /api/sse...');
	eventSource = new EventSource('/api/sse');

	eventSource.addEventListener('connected', () => {
		connected = true;
	});

	eventSource.addEventListener('download:created', (e) => {
		const download = JSON.parse(e.data);

		// Check if already exists
		const index = downloads.findIndex((d) => d.id === download.id);
		if (index >= 0) {
			downloads[index] = download;
		} else {
			downloads = [...downloads, download];
		}
	});

	eventSource.addEventListener('download:status', (e) => {
		const data = JSON.parse(e.data);

		const index = downloads.findIndex((d) => d.id === data.id);
		if (index >= 0) {
			downloads[index] = { ...downloads[index], ...data };
			downloads = [...downloads]; // Trigger reactivity
		}

		dispatchCallbacks('download:status', data);
	});

	eventSource.addEventListener('download:metadata', (e) => {
		const data = JSON.parse(e.data);

		const index = downloads.findIndex((d) => d.id === data.id);
		if (index >= 0) {
			downloads[index] = { ...downloads[index], ...data };
			downloads = [...downloads];
		}

		dispatchCallbacks('download:metadata', data);
	});

	eventSource.addEventListener('download:progress', (e) => {
		const data = JSON.parse(e.data);

		const index = downloads.findIndex((d) => d.id === data.id);
		if (index >= 0) {
			downloads[index] = { ...downloads[index], ...data };
			downloads = [...downloads]; // Trigger reactivity
		}

		dispatchCallbacks('download:progress', data);
	});

	eventSource.addEventListener('download:complete', (e) => {
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

	eventSource.addEventListener('download:failed', (e) => {
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

	eventSource.addEventListener('download:cancelled', (e) => {
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

	eventSource.addEventListener('download:deleted', (e) => {
		const data = JSON.parse(e.data);
		downloads = downloads.filter((d) => d.id !== data.id);
		dispatchCallbacks('download:deleted', data);
	});

	eventSource.addEventListener('download:tasks', (e) => {
		const data = JSON.parse(e.data);
		dispatchCallbacks('download:tasks', data);
	});

	eventSource.addEventListener('download:task', (e) => {
		const data = JSON.parse(e.data);
		dispatchCallbacks('download:task', data);
	});

	eventSource.addEventListener('subscription:checked', (e) => {
		const data = JSON.parse(e.data);
		dispatchCallbacks('subscription:checked', data);
	});

	eventSource.addEventListener('subscription:check:error', (e) => {
		const data = JSON.parse(e.data);
		dispatchCallbacks('subscription:check:error', data);
	});

	eventSource.addEventListener('playlist:sync:progress', (e) => {
		const data = JSON.parse(e.data);
		dispatchCallbacks('playlist:sync:progress', data);
	});

	eventSource.addEventListener('playlist:sync:complete', (e) => {
		const data = JSON.parse(e.data);
		dispatchCallbacks('playlist:sync:complete', data);
	});

	eventSource.addEventListener('monitor:live', (e) => {
		const data = JSON.parse(e.data);
		dispatchCallbacks('monitor:live', data);
	});

	eventSource.addEventListener('monitor:update', (e) => {
		const data = JSON.parse(e.data);
		dispatchCallbacks('monitor:update', data);
	});

	eventSource.addEventListener('ping', () => {
		// Heartbeat, do nothing
	});

	eventSource.onerror = () => {
		console.error('[SSE Client] Connection error, will retry...');
		connected = false;
		eventSource?.close();
		eventSource = null;

		// Reconnect after 5 seconds
		setTimeout(connectSSE, 5000);
	};
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
	eventSource?.close();
	eventSource = null;
	connected = false;
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
