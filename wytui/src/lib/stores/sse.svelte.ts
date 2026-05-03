let eventSource = $state<EventSource | null>(null);
let connected = $state(false);
let downloads = $state<any[]>([]);

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
		const { id, download } = JSON.parse(e.data);

		const index = downloads.findIndex(d => d.id === id);
		if (index >= 0) {
			downloads[index] = download;
			downloads = [...downloads];
		}

		setTimeout(() => {
			downloads = downloads.filter(d => d.id !== id);
		}, 3000);
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
		const { id } = JSON.parse(e.data);
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
