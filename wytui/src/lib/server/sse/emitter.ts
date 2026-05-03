type SSEClient = {
	id: string;
	controller: ReadableStreamDefaultController;
	userId?: string;
	heartbeat: ReturnType<typeof setInterval>;
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
				const heartbeat = setInterval(() => {
					try {
						controller.enqueue('event: ping\ndata: {}\n\n');
					} catch {
						clearInterval(heartbeat);
					}
				}, 30000);

				this.clients.set(clientId, { id: clientId, controller, userId, heartbeat });
				console.log(`[SSE] Client connected: ${clientId} (user: ${userId || 'anonymous'}, total: ${this.clients.size})`);

				this.sendToClient(clientId, 'connected', { clientId, timestamp: new Date() });

				if (this.initialStateCallback) {
					try {
						const downloads = await this.initialStateCallback(userId);
						downloads.forEach((download) => {
							this.sendToClient(clientId, 'download:created', download);
						});
					} catch (error) {
						console.error('Failed to fetch initial state:', error);
					}
				}
			},
			cancel: () => {
				const client = this.clients.get(clientId);
				if (client) {
					clearInterval(client.heartbeat);
					this.clients.delete(clientId);
				}
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
	 * Broadcast event only to clients belonging to a specific user
	 */
	broadcastToUser(event: string, data: any, userId: string): void {
		const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

		for (const [clientId, client] of this.clients.entries()) {
			if (client.userId !== userId) continue;
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
		const client = this.clients.get(clientId);
		if (client) {
			clearInterval(client.heartbeat);
			this.clients.delete(clientId);
		}
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
			clearInterval(client.heartbeat);
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
