/** ffmpeg time= → percent of total duration, clamped 0-100. null if duration unknown. */
export function ffmpegPercent(
	timeSeconds: number,
	durationSeconds: number | undefined,
): number | null {
	if (!durationSeconds || durationSeconds <= 0) return null;
	return Math.min(100, Math.round((timeSeconds / durationSeconds) * 100));
}
