export function formatBytes(bytes: string | number): string {
	const b = Number(bytes);
	if (!Number.isFinite(b) || b <= 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(b) / Math.log(1024));
	return `${(b / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;
	if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	return `${m}:${String(s).padStart(2, '0')}`;
}

/** Compact human duration for totals, e.g. "12h 34m", "5m", "42s". */
export function formatDurationLong(seconds: number): string {
	const s = Math.max(0, Math.floor(seconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
	if (m > 0) return `${m}m`;
	return `${s}s`;
}

export function formatTimestamp(totalSeconds: number): string {
	const h = Math.floor(totalSeconds / 3600);
	const m = Math.floor((totalSeconds % 3600) / 60);
	const s = Math.floor(totalSeconds % 60);
	if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	return `${m}:${String(s).padStart(2, '0')}`;
}

const DOWNLOAD_STATUS_COLORS: Record<string, string> = {
	PENDING: 'var(--color-text-tertiary)',
	FETCHING_INFO: 'var(--color-status-info)',
	DOWNLOADING: 'var(--color-accent-primary)',
	PROCESSING: 'var(--color-status-warning)',
	COMPLETED: 'var(--color-status-success)',
	FAILED: 'var(--color-status-error)',
	CANCELLED: 'var(--color-text-tertiary)',
	DELETED: 'var(--color-text-tertiary)',
};

const DOWNLOAD_STATUS_LABELS: Record<string, string> = {
	PENDING: 'Pending',
	FETCHING_INFO: 'Fetching Info',
	DOWNLOADING: 'Downloading',
	PROCESSING: 'Processing',
	COMPLETED: 'Completed',
	FAILED: 'Failed',
	CANCELLED: 'Cancelled',
	DELETED: 'Deleted',
};

export function getDownloadStatusColor(status: string): string {
	return DOWNLOAD_STATUS_COLORS[status] || 'var(--color-text-secondary)';
}

export function getDownloadStatusLabel(status: string): string {
	return DOWNLOAD_STATUS_LABELS[status] || status;
}

export function formatUptime(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

/** Abbreviate a count the way YouTube does: 2761758 -> "2.8M". */
export function formatCount(n: number): string {
	const units: [number, string][] = [
		[1_000_000_000, 'B'],
		[1_000_000, 'M'],
		[1_000, 'K'],
	];
	for (const [size, suffix] of units) {
		if (n >= size) {
			const scaled = n / size;
			// One decimal below 100, none above — "2.8M" but "999K".
			const text = scaled < 100 ? scaled.toFixed(1) : String(Math.round(scaled));
			return `${text.replace(/\.0$/, '')}${suffix}`;
		}
	}
	return String(n);
}
