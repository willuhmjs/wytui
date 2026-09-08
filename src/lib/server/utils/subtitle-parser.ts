export interface SubtitleEntry {
	startTime: number; // seconds
	endTime: number; // seconds
	text: string;
}

/**
 * Parse a timestamp string into seconds.
 * Supports HH:MM:SS.mmm (VTT) and HH:MM:SS,mmm (SRT) formats.
 */
function parseTimestamp(ts: string): number {
	// Normalize comma to dot for SRT format
	ts = ts.trim().replace(',', '.');

	const parts = ts.split(':');
	if (parts.length === 3) {
		const hours = parseFloat(parts[0]);
		const minutes = parseFloat(parts[1]);
		const seconds = parseFloat(parts[2]);
		return hours * 3600 + minutes * 60 + seconds;
	} else if (parts.length === 2) {
		const minutes = parseFloat(parts[0]);
		const seconds = parseFloat(parts[1]);
		return minutes * 60 + seconds;
	}
	return parseFloat(ts) || 0;
}

/**
 * Strip HTML tags and VTT formatting (e.g. <c>, <b>, position cues) from subtitle text.
 */
function stripFormatting(text: string): string {
	return text
		.replace(/<[^>]+>/g, '') // Remove HTML/VTT tags
		.replace(/\{[^}]+\}/g, '') // Remove SSA/ASS style overrides
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.trim();
}

/**
 * Parse a VTT (WebVTT) subtitle file into entries.
 *
 * Blocks are separated by genuinely empty lines only — YouTube cues may
 * contain whitespace-only lines that are part of the cue text.
 */
export function parseVTT(content: string): SubtitleEntry[] {
	const entries: SubtitleEntry[] = [];
	// Split into blocks separated by blank lines
	const blocks = content.replace(/\r\n/g, '\n').split(/\n{2,}/);

	for (const block of blocks) {
		const lines = block.trim().split('\n');

		// Find the line with the timestamp arrow
		let timestampLineIdx = -1;
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].includes('-->')) {
				timestampLineIdx = i;
				break;
			}
		}

		if (timestampLineIdx === -1) continue;

		const timestampLine = lines[timestampLineIdx];
		const match = timestampLine.match(/([\d:.]+)\s*-->\s*([\d:.]+)/);
		if (!match) continue;

		const startTime = parseTimestamp(match[1]);
		const endTime = parseTimestamp(match[2]);

		// Text is everything after the timestamp line
		const textLines = lines.slice(timestampLineIdx + 1);
		const text = stripFormatting(textLines.join(' '));

		if (text) {
			entries.push({ startTime, endTime, text });
		}
	}

	return entries;
}

/**
 * Parse an SRT subtitle file into entries.
 */
export function parseSRT(content: string): SubtitleEntry[] {
	const entries: SubtitleEntry[] = [];
	// Split into blocks separated by blank lines (genuinely empty lines only)
	const blocks = content.replace(/\r\n/g, '\n').split(/\n{2,}/);

	for (const block of blocks) {
		const lines = block.trim().split('\n');
		if (lines.length < 2) continue;

		// Find the timestamp line (contains -->)
		let timestampLineIdx = -1;
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].includes('-->')) {
				timestampLineIdx = i;
				break;
			}
		}

		if (timestampLineIdx === -1) continue;

		const timestampLine = lines[timestampLineIdx];
		const match = timestampLine.match(/([\d:,.]+)\s*-->\s*([\d:,.]+)/);
		if (!match) continue;

		const startTime = parseTimestamp(match[1]);
		const endTime = parseTimestamp(match[2]);

		// Text is everything after the timestamp line
		const textLines = lines.slice(timestampLineIdx + 1);
		const text = stripFormatting(textLines.join(' '));

		if (text) {
			entries.push({ startTime, endTime, text });
		}
	}

	return entries;
}

/**
 * Parse a subtitle file (auto-detect format from extension).
 */
export function parseSubtitleFile(content: string, filename: string): SubtitleEntry[] {
	const ext = filename.split('.').pop()?.toLowerCase();
	if (ext === 'vtt') {
		return parseVTT(content);
	} else if (ext === 'srt') {
		return parseSRT(content);
	}
	// Try VTT first (more common with yt-dlp), fall back to SRT
	if (content.trimStart().startsWith('WEBVTT')) {
		return parseVTT(content);
	}
	return parseSRT(content);
}
