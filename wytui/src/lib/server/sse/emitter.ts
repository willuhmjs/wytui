type SSEClient = {
	id: string;
	controller: ReadableStreamDefaultController;
	userId?: string;
};

type InitialStateCallback = (userId?: string) => Promise<any[]>;

class SSEEmitter {
	private clients: Map<string, SSEClient> = new Map();
	private initialStateCallback?: InitialStateCallback;

	/**
	 * Set callback to fetch initial state when clients connect
	 */
	setInitialStateCallback(callback: InitialStateCallback): void {
		this.initialStateCallback = callback;
	}

	/**
	 * Register a new SSE client
	 */
	registerClient(clientId: string, userId?: string): ReadableStream {
		const stream = new ReadableStream({
			start: async (controller) => {
				this.clients.set(clientId, { id: clientId, controller, userId });
				console.log(`[SSE] Client connected:`, clientId, `(user: ${userId || 'anonymous'})`);
				console.log(`[SSE] Total clients: ${this.clients.size}`);

				// Send initial connection message
				this.sendToClient(clientId, 'connected', { clientId, timestamp: new Date() });

				// Send initial state (active downloads)
				if (this.initialStateCallback) {
					try {
						const downloads = await this.initialStateCallback(userId);
						console.log(`[SSE] Sending ${downloads.length} initial downloads to client ${clientId}`);
						downloads.forEach((download) => {
							this.sendToClient(clientId, 'download:created', download);
						});
					} catch (error) {
						console.error('Failed to fetch initial state:', error);
					}
				}

				// Heartbeat every 30 seconds
				const heartbeat = setInterval(() => {
					try {
						controller.enqueue('event: ping\ndata: {}\n\n');
					} catch {
						clearInterval(heartbeat);
					}
				}, 30000);
			},
			cancel: () => {
				this.clients.delete(clientId);
			},
		});

		return stream;
	}

	/**
	 * Send event to specific client
	 */
	sendToClient(clientId: string, event: string, data: any): void {
		const client = this.clients.get(clientId);
		if (!client) return;

		try {
			const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
			client.controller.enqueue(message);
		} catch (e) {
			console.error(`Failed to send to client ${clientId}:`, e);
			this.clients.delete(clientId);
		}
	}

	/**
	 * Broadcast event to all connected clients
	 */
	broadcast(event: string, data: any): void {
		const clientCount = this.clients.size;
		console.log(`[SSE] Broadcasting ${event} to ${clientCount} clients`);

		const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

		for (const [clientId, client] of this.clients.entries()) {
			try {
				client.controller.enqueue(message);
			} catch (e) {
				console.error(`Failed to send to client ${clientId}:`, e);
				this.clients.delete(clientId);
			}
		}
	}

	/**
	 * Remove a client
	 */
	removeClient(clientId: string): void {
		this.clients.delete(clientId);
	}

	/**
	 * Get number of connected clients
	 */
	getClientCount(): number {
		return this.clients.size;
	}

	/**
	 * Close all clients
	 */
	closeAll(): void {
		for (const [clientId, client] of this.clients.entries()) {
			try {
				client.controller.close();
			} catch (e) {
				console.error(`Failed to close client ${clientId}:`, e);
			}
		}
		this.clients.clear();
	}
}

// Singleton instance
export const sseEmitter = new SSEEmitter();
