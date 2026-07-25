class PlexService {
	/**
	 * Trigger a Plex library scan so newly downloaded content appears immediately.
	 */
	async notifyLibraryScan(plexUrl: string, plexToken: string): Promise<void> {
		try {
			const baseUrl = plexUrl.replace(/\/$/, '');
			const res = await fetch(
				`${baseUrl}/library/sections/all/refresh?X-Plex-Token=${encodeURIComponent(plexToken)}`,
				{
					method: 'POST',
					signal: AbortSignal.timeout(10000),
				},
			);

			if (!res.ok) {
				console.error(`[PlexService] Library scan returned ${res.status}`);
			}
		} catch (error) {
			console.error('[PlexService] Library scan failed:', error);
		}
	}

	/**
	 * Test connection by fetching Plex server identity info.
	 */
	async testConnection(
		plexUrl: string,
		plexToken: string,
	): Promise<{ success: boolean; serverName?: string; error?: string }> {
		try {
			const baseUrl = plexUrl.replace(/\/$/, '');
			const res = await fetch(`${baseUrl}/identity`, {
				headers: {
					'X-Plex-Token': plexToken,
					Accept: 'application/json',
				},
				signal: AbortSignal.timeout(10000),
			});

			if (!res.ok) {
				return { success: false, error: `Server returned ${res.status}` };
			}

			const info = await res.json();
			const serverName = info?.MediaContainer?.machineIdentifier
				? `Plex (${info.MediaContainer.machineIdentifier})`
				: 'Plex';
			return { success: true, serverName };
		} catch (e: any) {
			const message =
				e.name === 'TimeoutError' ? 'Connection timed out' : e.message || 'Connection failed';
			return { success: false, error: message };
		}
	}
}

export const plexService = new PlexService();
