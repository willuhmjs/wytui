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
		const index = downloads.findIndex(d => d.id === download.id);
		if (index >= 0) {
			downloads[index] = download;
		} else {
			downloads = [...downloads, download];
		}
	});

	eventSource.addEventListener('download:status', (e) => {
		const data = JSON.parse(e.data);

		const index = downloads.findIndex(d => d.id === data.id);
		if (index >= 0) {
			downloads[index] = { ...downloads[index], ...data };
			downloads = [...downloads]; // Trigger reactivity
		}
	});

	eventSource.addEventListener('download:metadata', (e) => {
		const data = JSON.parse(e.data);

		const index = downloads.findIndex(d => d.id === data.id);
		if (index >= 0) {
			downloads[index] = { ...downloads[index], ...data };
			downloads = [...downloads];
		}
	});

	eventSource.addEventListener('download:progress', (e) => {
		const data = JSON.parse(e.data);

		const index = downloads.findIndex(d => d.id === data.id);
		if (index >= 0) {
			downloads[index] = { ...downloads[index], ...data };
			downloads = [...downloads]; // Trigger reactivity
		}
	});

	eventSource.addEventListener('download:complete', (e) => {
		const data = JSON.parse(e.data);
		const { id, download } = data;

		const index = downloads.findIndex(d => d.id === id);
		if (index >= 0) {
			downloads[index] = download;
			downloads = [...downloads];
		}

		setTimeout(() => {
			downloads = downloads.filter(d => d.id !== id);
		}, 3000);

		dispatchCallbacks('download:complete', data);
	});

	eventSource.addEventListener('download:failed', (e) => {
		const { id, error } = JSON.parse(e.data);

		const index = downloads.findIndex(d => d.id === id);
		if (index >= 0) {
			downloads[index] = { ...downloads[index], status: 'FAILED', error };
			downloads = [...downloads];
		}

		setTimeout(() => {
			downloads = downloads.filter(d => d.id !== id);
		}, 5000);
	});

	eventSource.addEventListener('download:cancelled', (e) => {
		const { id } = JSON.parse(e.data);

		const index = downloads.findIndex(d => d.id === id);
		if (index >= 0) {
			downloads[index] = { ...downloads[index], status: 'CANCELLED' };
			downloads = [...downloads];
		}

		setTimeout(() => {
			downloads = downloads.filter(d => d.id !== id);
		}, 3000);
	});

	eventSource.addEventListener('download:deleted', (e) => {
		const data = JSON.parse(e.data);
		downloads = downloads.filter(d => d.id !== data.id);
		dispatchCallbacks('download:deleted', data);
	});

	eventSource.addEventListener('subscription:checked', (e) => {
		const data = JSON.parse(e.data);
		dispatchCallbacks('subscription:checked', data);
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
