import { execSync } from 'child_process';
import { prisma } from './db';

const DEFAULT_PROFILES = [
	// Video Quality Presets (using H.264 for compatibility)
	{
		name: '4K (Best Quality)',
		description: '2160p H.264 video with AAC audio',
		isSystem: true,
		isDefault: false,
		quality: '2160',
		format: 'mp4',
		customFlags: [
			'-f',
			'bestvideo[vcodec^=avc][height<=2160]+bestaudio/best',
			'--merge-output-format',
			'mp4',
			'--postprocessor-args',
			'ffmpeg:-c:a aac -b:a 192k',
		],
	},
	{
		name: '1080p',
		description: 'Full HD H.264 video with AAC audio',
		isSystem: true,
		isDefault: true,
		quality: '1080',
		format: 'mp4',
		customFlags: [
			'-f',
			'bestvideo[vcodec^=avc]+bestaudio/best',
			'--merge-output-format',
			'mp4',
			'--postprocessor-args',
			'ffmpeg:-c:a aac -b:a 192k',
		],
	},
	{
		name: '720p',
		description: 'HD H.264 video with AAC audio',
		isSystem: true,
		isDefault: false,
		quality: '720',
		format: 'mp4',
		customFlags: [
			'-f',
			'bestvideo[vcodec^=avc][height<=720]+bestaudio/best',
			'--merge-output-format',
			'mp4',
			'--postprocessor-args',
			'ffmpeg:-c:a aac -b:a 192k',
		],
	},
	{
		name: '480p (Mobile)',
		description: 'SD H.264 video optimized for mobile',
		isSystem: true,
		isDefault: false,
		quality: '480',
		format: 'mp4',
		customFlags: [
			'-f',
			'bestvideo[vcodec^=avc][height<=480]+bestaudio/best',
			'--merge-output-format',
			'mp4',
			'--postprocessor-args',
			'ffmpeg:-c:a aac -b:a 192k',
		],
	},

	// Audio Extraction
	{
		name: 'MP3 (320kbps)',
		description: 'High quality MP3 audio',
		isSystem: true,
		isDefault: false,
		audioOnly: true,
		audioFormat: 'mp3',
		audioBitrate: '320k',
		customFlags: ['-x', '--audio-format', 'mp3', '--audio-quality', '0'],
	},
	{
		name: 'AAC (High Quality)',
		description: 'High quality AAC audio',
		isSystem: true,
		isDefault: false,
		audioOnly: true,
		audioFormat: 'aac',
		audioBitrate: '256k',
		customFlags: ['-x', '--audio-format', 'aac', '--audio-quality', '0'],
	},
	{
		name: 'FLAC (Lossless)',
		description: 'Lossless FLAC audio',
		isSystem: true,
		isDefault: false,
		audioOnly: true,
		audioFormat: 'flac',
		customFlags: ['-x', '--audio-format', 'flac'],
	},

	// Smart Defaults
	{
		name: 'Best (Auto)',
		description: 'Best H.264 video with AAC audio',
		isSystem: true,
		isDefault: false,
		customFlags: [
			'-f',
			'bestvideo[vcodec^=avc]+bestaudio/best',
			'--merge-output-format',
			'mp4',
			'--postprocessor-args',
			'ffmpeg:-c:a aac -b:a 192k',
		],
	},
	{
		name: 'Smallest Size',
		description: 'Lowest quality for minimal file size',
		isSystem: true,
		isDefault: false,
		customFlags: ['-f', 'worstvideo+worstaudio/worst'],
	},
];

/**
 * Ensures the settings singleton and all default system profiles exist in the
 * database. This is idempotent — safe to call on every server start — so the
 * app works correctly even when the manual `db:seed` step has been skipped.
 */
export async function ensureDefaults(): Promise<void> {
	// Detect yt-dlp version (best-effort)
	let ytdlpVersion: string | null = null;
	try {
		ytdlpVersion = execSync('yt-dlp --version', { timeout: 5000 }).toString().trim();
	} catch {
		// yt-dlp not available in this environment — that's fine
	}

	// Ensure the settings singleton exists
	await prisma.settings.upsert({
		where: { id: 'singleton' },
		update: {},
		create: {
			id: 'singleton',
			maxConcurrentDownloads: 3,
			downloadPath: '/downloads',
			ytdlpPath: '/usr/local/bin/yt-dlp',
			ytdlpVersion,
			autoUpdateYtdlp: true,
			updateCheckInterval: 86400,
			enableArchive: true,
		},
	});

	// Ensure every default system profile exists
	for (const profile of DEFAULT_PROFILES) {
		const existing = await prisma.downloadProfile.findFirst({
			where: { name: profile.name, userId: null },
		});

		if (!existing) {
			await prisma.downloadProfile.create({ data: profile });
		}
	}
}
