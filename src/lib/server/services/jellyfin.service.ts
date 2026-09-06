import { prisma } from '../db';
import { internalFetch } from '../utils/fetch';
import { resolve, relative, isAbsolute } from 'path';

export interface JellyfinLibraryResult {
	action: 'created' | 'converted' | 'already-configured';
	name: string;
	collectionType: string;
	warnings: string[];
}

/** True when a is strictly inside b (or vice versa), i.e. they overlap without being equal. */
export function pathOverlaps(a: string, b: string): boolean {
	if (resolve(a) === resolve(b)) return false;
	const ab = relative(resolve(b), resolve(a));
	const ba = relative(resolve(a), resolve(b));
	const insideAb = !!ab && !ab.startsWith('..') && !isAbsolute(ab);
	const insideBa = !!ba && !ba.startsWith('..') && !isAbsolute(ba);
	return insideAb || insideBa;
}

/**
 * Translate a wytui-container path into Jellyfin-container path space. wytui
 * and Jellyfin often mount the same volume at different mount points (wytui
 * may see /media while Jellyfin sees /media/youtube on the same claim), so
 * library paths must be mapped before being compared against or created in
 * Jellyfin. Paths outside the local prefix pass through unchanged.
 */
export function mapToJellyfinPath(
	path: string,
	localPath?: string | null,
	remotePath?: string | null,
): string {
	const resolved = resolve(path);
	if (!localPath || !remotePath) return resolved;
	const local = resolve(localPath);
	if (resolved !== local && !resolved.startsWith(local + '/')) return resolved;
	const suffix = resolved === local ? '' : resolved.slice(local.length);
	return resolve(remotePath + suffix);
}

/**
 * YouTube channel folders only match online providers (TheTVDB etc.) by
 * accident, so the automated setup pins both libraries to local metadata:
 * NFO files for TV shows, embedded tags / filenames for music.
 */
const TV_LIBRARY_OPTIONS = {
	EnableInternetProviders: false,
	EnableAutomaticSeriesGrouping: false,
	SaveLocalMetadata: false,
	LocalMetadataReaderOrder: ['Nfo'],
	TypeOptions: [
		{
			Type: 'Series',
			MetadataFetchers: ['Nfo'],
			MetadataFetcherOrder: ['Nfo'],
			ImageFetchers: [],
			ImageFetcherOrder: [],
		},
		{
			Type: 'Season',
			MetadataFetchers: ['Nfo'],
			MetadataFetcherOrder: ['Nfo'],
			ImageFetchers: [],
			ImageFetcherOrder: [],
		},
		{
			Type: 'Episode',
			MetadataFetchers: ['Nfo'],
			MetadataFetcherOrder: ['Nfo'],
			ImageFetchers: [],
			ImageFetcherOrder: [],
		},
	],
};

const MUSIC_LIBRARY_OPTIONS = {
	EnableInternetProviders: false,
	SaveLocalMetadata: false,
	TypeOptions: [
		{
			Type: 'MusicArtist',
			MetadataFetchers: [],
			MetadataFetcherOrder: [],
			ImageFetchers: [],
			ImageFetcherOrder: [],
		},
		{
			Type: 'MusicAlbum',
			MetadataFetchers: [],
			MetadataFetcherOrder: [],
			ImageFetchers: [],
			ImageFetcherOrder: [],
		},
		{
			Type: 'Audio',
			MetadataFetchers: [],
			MetadataFetcherOrder: [],
			ImageFetchers: [],
			ImageFetcherOrder: [],
		},
	],
};

type SetupResult = { video: JellyfinLibraryResult; music: JellyfinLibraryResult | null };

class JellyfinService {
	/**
	 * Serialize setup runs: two concurrent requests (double click, two tabs)
	 * must not both pass the "no library yet" check and create duplicates.
	 * Concurrent callers share the in-flight result.
	 */
	private setupInFlight: Promise<SetupResult> | null = null;

	private async configured(): Promise<{ baseUrl: string; apiKey: string }> {
		const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
		if (!settings?.jellyfinUrl || !settings.jellyfinApiKey) {
			throw new Error('Jellyfin is not configured — set the server URL and API key first');
		}
		return { baseUrl: settings.jellyfinUrl.replace(/\/$/, ''), apiKey: settings.jellyfinApiKey };
	}

	private async listVirtualFolders(baseUrl: string, apiKey: string): Promise<any[]> {
		const res = await internalFetch(`${baseUrl}/Library/VirtualFolders`, {
			headers: { 'X-Emby-Token': apiKey },
			signal: AbortSignal.timeout(10000),
		});
		if (!res.ok) throw new Error(`Jellyfin returned ${res.status} while listing libraries`);
		return res.json();
	}

	/**
	 * Create (or fix) the Jellyfin libraries for the configured wytui paths.
	 * The video library uses the TV Shows collection type — channels become
	 * shows and videos become episodes, ordered chronologically via NFO
	 * metadata (season = upload year, episode = index within the year).
	 * Safe to call repeatedly: an existing library on the path is reused, and
	 * overlapping libraries are refused instead of duplicated.
	 */
	async setupLibrary(): Promise<SetupResult> {
		if (this.setupInFlight) return this.setupInFlight;
		this.setupInFlight = this.doSetupLibrary().finally(() => {
			this.setupInFlight = null;
		});
		return this.setupInFlight;
	}

	private async doSetupLibrary(): Promise<SetupResult> {
		const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
		if (!settings?.libraryPath) throw new Error('Library path not configured');

		const { baseUrl, apiKey } = await this.configured();
		const folders = await this.listVirtualFolders(baseUrl, apiKey);
		const map = (p: string) =>
			mapToJellyfinPath(p, settings.jellyfinLocalPath, settings.jellyfinRemotePath);
		const videoPath = map(settings.libraryPath);
		// Without a mapping the paths compared below live in different
		// containers' mount namespaces, which can fake an overlap.
		const overlapHint =
			!settings.jellyfinLocalPath || !settings.jellyfinRemotePath
				? 'If Jellyfin sees this media under a different path than wytui does, configure the path mapping in Settings → Jellyfin first.'
				: '';

		const video = await this.ensureLibrary({
			baseUrl,
			apiKey,
			folders,
			collectionType: 'tvshows',
			path: videoPath,
			fallbackName: 'YouTube',
			overlapHint,
		});

		let music: JellyfinLibraryResult | null = null;
		if (settings.musicLibraryPath) {
			music = await this.ensureLibrary({
				baseUrl,
				apiKey,
				folders,
				collectionType: 'music',
				path: map(settings.musicLibraryPath),
				fallbackName: 'YouTube Music',
				// The video library is managed by this same run; a nested music
				// path is reported as a warning instead of refused.
				managedPaths: [videoPath],
				overlapHint,
			});
		}
		return { video, music };
	}

	private async ensureLibrary(opts: {
		baseUrl: string;
		apiKey: string;
		folders: any[];
		collectionType: 'tvshows' | 'music';
		path: string;
		fallbackName: string;
		/** Paths managed by wytui in this same run: overlapping them warns instead of erroring. */
		managedPaths?: string[];
		/** Appended to the overlap error when the local->remote path mapping may be missing. */
		overlapHint?: string;
	}): Promise<JellyfinLibraryResult> {
		const {
			baseUrl,
			apiKey,
			folders,
			collectionType,
			path,
			fallbackName,
			managedPaths = [],
			overlapHint = '',
		} = opts;
		const existing = folders.find((vf) =>
			(vf.Locations ?? []).some((loc: string) => resolve(loc) === path),
		);
		const name = existing?.Name ?? fallbackName;
		const warnings: string[] = [];

		if (existing && (existing.CollectionType ?? '').toLowerCase() === collectionType) {
			return { action: 'already-configured', name, collectionType, warnings };
		}

		const kind = collectionType === 'tvshows' ? 'TV Shows' : 'Music';
		const overlapWarning = (other: string) =>
			`The ${kind} path ${path} is nested inside ${other} — Jellyfin will scan those files in both libraries. Prefer sibling library roots.`;

		// Overlap guard: creating a second library over files another library
		// already scans would duplicate every item in Jellyfin. Only paths this
		// same run manages are tolerated (with a warning).
		for (const vf of folders) {
			if (vf === existing) continue;
			for (const loc of vf.Locations ?? []) {
				if (!pathOverlaps(path, loc)) continue;
				if (managedPaths.includes(resolve(loc))) {
					warnings.push(overlapWarning(resolve(loc)));
					continue;
				}
				throw new Error(
					`The path ${path} overlaps with the existing "${vf.Name}" library (${resolve(loc)}). ` +
						`Remove that library in Jellyfin or use a dedicated path — creating another one would scan the same files twice.` +
						(overlapHint ? ` ${overlapHint}` : ''),
				);
			}
		}
		for (const managed of managedPaths) {
			if (managed !== path && pathOverlaps(path, managed)) warnings.push(overlapWarning(managed));
		}

		if (existing) {
			// Jellyfin cannot change a library's collection type in place, so the
			// virtual folder is removed and re-created with the same name and path.
			// Media files are untouched, but Jellyfin rebuilds its item database
			// for the library — watch state and resume points reset.
			const res = await internalFetch(
				`${baseUrl}/Library/VirtualFolders?name=${encodeURIComponent(name)}&refreshLibrary=false`,
				{
					method: 'DELETE',
					headers: { 'X-Emby-Token': apiKey },
					signal: AbortSignal.timeout(30000),
				},
			);
			if (!res.ok) {
				throw new Error(`Failed to remove the existing "${name}" library (HTTP ${res.status})`);
			}
			warnings.push(
				`The "${name}" library was rebuilt as ${kind} — Jellyfin watch history and resume points for it were reset.`,
			);
		}

		const libraryOptions =
			collectionType === 'tvshows' ? TV_LIBRARY_OPTIONS : MUSIC_LIBRARY_OPTIONS;
		const res = await internalFetch(
			`${baseUrl}/Library/VirtualFolders` +
				`?name=${encodeURIComponent(name)}` +
				`&collectionType=${collectionType}` +
				`&paths=${encodeURIComponent(path)}` +
				`&refreshCollection=true`,
			{
				method: 'POST',
				headers: { 'X-Emby-Token': apiKey, 'Content-Type': 'application/json' },
				body: JSON.stringify({ LibraryOptions: libraryOptions }),
				signal: AbortSignal.timeout(30000),
			},
		);
		if (!res.ok) {
			throw new Error(`Failed to create the "${name}" library (HTTP ${res.status})`);
		}
		return { action: existing ? 'converted' : 'created', name, collectionType, warnings };
	}
}

export const jellyfinService = new JellyfinService();
