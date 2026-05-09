export function formatBytes(bytes: string | number): string {
	const b = Number(bytes);
	if (b === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(b) / Math.log(1024));
	return `${(b / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
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
