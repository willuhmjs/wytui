let eventSource = $state<EventSource | null>(null);
let connected = $state(false);
let downloads = $state<any[]>([]);

export function connectSSE() {
	if (eventSource) return;

	console.log('[SSE Client] Connecting to /api/sse...');
	eventSource = new EventSource('/api/sse');

	eventSource.addEventListener('connected', (e) => {
		console.log('[SSE Client] Connected:', JSON.parse(e.data));
		connected = true;
	});

	eventSource.addEventListener('download:created', (e) => {
		const download = JSON.parse(e.data);
		console.log('[SSE Client] Received download:created:', download.id);

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
		console.log('[SSE Client] Received download:status:', data.id, '→', data.status);

		const index = downloads.findIndex(d => d.id === data.id);
		if (index >= 0) {
			downloads[index] = { ...downloads[index], ...data };
			downloads = [...downloads]; // Trigger reactivity
		}
	});

	eventSource.addEventListener('download:metadata', (e) => {
		const data = JSON.parse(e.data);
		console.log('[SSE Client] Received download:metadata:', data.id, data.title);

		const index = downloads.findIndex(d => d.id === data.id);
		if (index >= 0) {
			downloads[index] = { ...downloads[index], ...data };
			downloads = [...downloads];
		}
	});

	eventSource.addEventListener('download:progress', (e) => {
		const data = JSON.parse(e.data);
		console.log('[SSE Client] Received download:progress:', data.id, data.progress + '%');

		const index = downloads.findIndex(d => d.id === data.id);
		if (index >= 0) {
			downloads[index] = { ...downloads[index], ...data };
			downloads = [...downloads]; // Trigger reactivity
		}
	});

	eventSource.addEventListener('download:complete', (e) => {
		const { id, download } = JSON.parse(e.data);
		console.log('[SSE Client] Received download:complete:', id);

		// Update download to completed status (keep it visible on page)
		const index = downloads.findIndex(d => d.id === id);
		if (index >= 0) {
			downloads[index] = download;
			downloads = [...downloads];
		} else {
			// Add if not found (shouldn't happen, but just in case)
			downloads = [...downloads, download];
		}
	});

	eventSource.addEventListener('download:failed', (e) => {
		const { id, error } = JSON.parse(e.data);
		console.log('[SSE Client] Received download:failed:', id, error);

		const index = downloads.findIndex(d => d.id === id);
		if (index >= 0) {
			downloads[index] = { ...downloads[index], status: 'FAILED', error };
			downloads = [...downloads];
		}
	});

	eventSource.addEventListener('download:cancelled', (e) => {
		const { id } = JSON.parse(e.data);
		console.log('[SSE Client] Received download:cancelled:', id);

		const index = downloads.findIndex(d => d.id === id);
		if (index >= 0) {
			downloads[index] = { ...downloads[index], status: 'CANCELLED' };
			downloads = [...downloads];
		}
	});

	eventSource.addEventListener('download:deleted', (e) => {
		const { id } = JSON.parse(e.data);
		console.log('[SSE Client] Received download:deleted:', id);
		downloads = downloads.filter(d => d.id !== id);
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
