import { spawn } from 'child_process';
import { copyFile, unlink, writeFile, access } from 'fs/promises';
import { join, extname } from 'path';
import type { Download } from '@prisma/client';

interface ParsedTitle {
	artist: string;
	track: string;
}

interface MusicBrainzResult {
	recordingId: string;
	title: string;
	artist: string;
	album: string;
	trackNumber: number;
	releaseYear: number;
	releaseId: string;
	coverArtUrl: string;
}

export interface MusicFileInfo {
	artist: string;
	title: string;
	album: string;
	trackNumber?: number;
	year?: number;
	coverArtBuffer: Buffer | null;
}

const SUFFIXES_PATTERN = /\s*[\(\[](official\s*(audio|video|music\s*video|visualizer|lyric\s*video|mv)?|lyrics?|audio|visualizer|music\s*video|mv|hd|hq|4k|remaster(ed)?(\s*\d{4})?|explicit|clean|prod\.?\s+by\s+[^)\]]+|ft\.?\s+[^)\]]+|feat\.?\s+[^)\]]+)[\)\]]\s*/gi;
const LEADING_TAGS_PATTERN = /^\s*\[[^\]]*\]\s*/;

class MusicMetadataService {
	private lastRequestTime = 0;
	private readonly USER_AGENT = 'wytui/1.0.0 (https://github.com/wytui/wytui)';

	parseTitle(title: string, uploader?: string): ParsedTitle {
		let cleaned = title;

		cleaned = cleaned.replace(LEADING_TAGS_PATTERN, '');
		cleaned = cleaned.replace(SUFFIXES_PATTERN, '');
		cleaned = cleaned.trim();

		const separatorIndex = cleaned.indexOf(' - ');
		if (separatorIndex > 0) {
			return {
				artist: cleaned.substring(0, separatorIndex).trim(),
				track: cleaned.substring(separatorIndex + 3).trim(),
			};
		}

		return {
			artist: uploader || 'Unknown Artist',
			track: cleaned || title,
		};
	}

	async lookupTrack(artist: string, track: string): Promise<MusicBrainzResult | null> {
		try {
			const query = `recording:"${this.escapeQuery(track)}" AND artist:"${this.escapeQuery(artist)}"`;
			const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&fmt=json&limit=5`;

			const response = await this.rateLimitedFetch(url);
			if (!response.ok) {
				console.warn(`[MusicMetadata] MusicBrainz returned ${response.status}`);
				return null;
			}

			const data = await response.json();
			const recordings = data.recordings;
			if (!recordings?.length) return null;

			for (const recording of recordings) {
				if (recording.score < 80) continue;

				const release = this.findBestRelease(recording.releases);
				if (!release) continue;

				const artistName = recording['artist-credit']?.[0]?.name || artist;
				const trackNumber = this.extractTrackNumber(release, recording.id);

				return {
					recordingId: recording.id,
					title: recording.title,
					artist: artistName,
					album: release.title,
					trackNumber: trackNumber || 1,
					releaseYear: this.extractYear(release.date),
					releaseId: release.id,
					coverArtUrl: `https://coverartarchive.org/release/${release.id}/front-250`,
				};
			}

			return null;
		} catch (error) {
			console.error('[MusicMetadata] MusicBrainz lookup failed:', error);
			return null;
		}
	}

	async fetchCoverArt(url: string): Promise<Buffer | null> {
		try {
			const response = await fetch(url, {
				headers: { 'User-Agent': this.USER_AGENT },
				redirect: 'follow',
			});
			if (!response.ok) return null;
			return Buffer.from(await response.arrayBuffer());
		} catch {
			return null;
		}
	}

	async embedMetadata(
		filepath: string,
		metadata: { artist: string; title: string; album: string; trackNumber?: number; year?: number },
		coverArtPath?: string
	): Promise<void> {
		const ext = extname(filepath);
		const tempPath = filepath + '.tagged' + ext;

		const args: string[] = ['-y', '-i', filepath];

		if (coverArtPath) {
			args.push('-i', coverArtPath);
			args.push('-map', '0:a', '-map', '1:0');
			args.push('-c', 'copy');
			args.push('-metadata:s:v', 'title=Album cover');
			args.push('-metadata:s:v', 'comment=Cover (front)');
			args.push('-disposition:v', 'attached_pic');
		} else {
			args.push('-c', 'copy');
		}

		args.push('-metadata', `artist=${metadata.artist}`);
		args.push('-metadata', `title=${metadata.title}`);
		args.push('-metadata', `album=${metadata.album}`);
		if (metadata.trackNumber) {
			args.push('-metadata', `track=${metadata.trackNumber}`);
		}
		if (metadata.year) {
			args.push('-metadata', `date=${metadata.year}`);
		}

		args.push(tempPath);

		await this.runFfmpeg(args);

		await unlink(filepath);
		await copyFile(tempPath, filepath);
		await unlink(tempPath);
	}

	async resolveAndTag(download: Download): Promise<MusicFileInfo> {
		let artist = download.artist;
		let track = download.title;
		let album = download.album;

		if (!artist || !track) {
			const parsed = this.parseTitle(download.title || '', download.uploader || undefined);
			artist = artist || parsed.artist;
			track = track || parsed.track;
		}

		let mbResult: MusicBrainzResult | null = null;
		try {
			mbResult = await this.lookupTrack(artist, track!);
		} catch (error) {
			console.warn('[MusicMetadata] MusicBrainz lookup error:', error);
		}

		let coverArtBuffer: Buffer | null = null;

		if (mbResult) {
			artist = mbResult.artist;
			track = mbResult.title;
			album = album || mbResult.album;

			coverArtBuffer = await this.fetchCoverArt(mbResult.coverArtUrl);

			if (download.filepath) {
				try {
					let coverTempPath: string | undefined;
					if (coverArtBuffer) {
						coverTempPath = download.filepath + '.cover.jpg';
						await writeFile(coverTempPath, coverArtBuffer);
					}

					await this.embedMetadata(
						download.filepath,
						{
							artist: mbResult.artist,
							title: mbResult.title,
							album: album || mbResult.album,
							trackNumber: mbResult.trackNumber,
							year: mbResult.releaseYear,
						},
						coverTempPath
					);

					if (coverTempPath) {
						try { await unlink(coverTempPath); } catch {}
					}
				} catch (error) {
					console.warn('[MusicMetadata] Metadata embedding failed:', error);
				}
			}

			return {
				artist: mbResult.artist,
				title: mbResult.title,
				album: album || mbResult.album,
				trackNumber: mbResult.trackNumber,
				year: mbResult.releaseYear,
				coverArtBuffer,
			};
		}

		if (download.filepath) {
			try {
				await this.embedMetadata(download.filepath, {
					artist: artist!,
					title: track!,
					album: album || 'Singles',
				});
			} catch (error) {
				console.warn('[MusicMetadata] Fallback metadata embedding failed:', error);
			}
		}

		return {
			artist: artist!,
			title: track!,
			album: album || 'Singles',
			trackNumber: undefined,
			year: download.releaseYear || undefined,
			coverArtBuffer: null,
		};
	}

	private escapeQuery(str: string): string {
		return str.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&');
	}

	private findBestRelease(releases?: any[]): any | null {
		if (!releases?.length) return null;

		const albums = releases.filter(
			(r) => r['release-group']?.['primary-type'] === 'Album' && r.date
		);
		if (albums.length) return albums[0];

		const withDate = releases.filter((r) => r.date);
		if (withDate.length) return withDate[0];

		return releases[0];
	}

	private extractTrackNumber(release: any, recordingId: string): number | null {
		for (const media of release.media || []) {
			for (const track of media.track || []) {
				if (track.id === recordingId || track.title) {
					const num = parseInt(track.number, 10);
					if (!isNaN(num)) return num;
				}
			}
		}
		return null;
	}

	private extractYear(dateStr?: string): number {
		if (!dateStr) return new Date().getFullYear();
		const year = parseInt(dateStr.substring(0, 4), 10);
		return isNaN(year) ? new Date().getFullYear() : year;
	}

	private async rateLimitedFetch(url: string): Promise<Response> {
		const now = Date.now();
		const elapsed = now - this.lastRequestTime;
		if (elapsed < 1100) {
			await new Promise((r) => setTimeout(r, 1100 - elapsed));
		}
		this.lastRequestTime = Date.now();
		return fetch(url, {
			headers: { 'User-Agent': this.USER_AGENT },
		});
	}

	private runFfmpeg(args: string[]): Promise<void> {
		return new Promise((resolve, reject) => {
			const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
			let stderr = '';

			proc.stderr?.on('data', (chunk) => {
				stderr += chunk.toString();
			});

			proc.on('close', (code) => {
				if (code === 0) {
					resolve();
				} else {
					reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
				}
			});

			proc.on('error', reject);
		});
	}
}

export const musicMetadataService = new MusicMetadataService();
