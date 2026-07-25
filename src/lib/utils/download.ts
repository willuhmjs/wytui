import { addToast, addStickyToast, removeToast } from '$lib/stores/toast.svelte';

export function isMobileDevice(): boolean {
	return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// MIME type → file extension. iOS decides whether to offer "Save Video"/"Save to
// Photos" in the share sheet based on the filename's extension, so a File without
// a recognised media extension shows up as a generic document (Files/Mail only).
const MIME_EXT: Record<string, string> = {
	'video/mp4': 'mp4',
	'video/webm': 'webm',
	'video/x-matroska': 'mkv',
	'video/quicktime': 'mov',
	'audio/mpeg': 'mp3',
	'audio/mp4': 'm4a',
	'audio/aac': 'aac',
	'audio/flac': 'flac',
	'audio/opus': 'opus',
};

function canShareFiles(): boolean {
	if (!isMobileDevice() || typeof navigator.canShare !== 'function') return false;
	try {
		return navigator.canShare({ files: [new File([], 'test')] });
	} catch {
		return false;
	}
}

function filenameFor(response: Response, fallback: string, mime: string): string {
	// Prefer the server's Content-Disposition filename — it already carries the
	// correct extension derived from the file on disk.
	const cd = response.headers.get('content-disposition') || '';
	const match = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
	let name = fallback;
	if (match) {
		try {
			name = decodeURIComponent(match[1]);
		} catch {
			name = match[1];
		}
	}
	// Guarantee the extension so iOS recognises it as savable media.
	const ext = MIME_EXT[mime];
	if (ext && !new RegExp(`\\.${ext}$`, 'i').test(name)) {
		name = `${name.replace(/\.[^.]+$/, '')}.${ext}`;
	}
	return name || 'download';
}

// Cache the most recently downloaded file. On a slow connection iOS can drop the
// transient user activation before the download finishes, making navigator.share()
// reject with NotAllowedError; caching lets a follow-up tap share instantly. On a
// fast (LAN) connection the first tap shares directly and this never kicks in.
let cached: { fileId: string; file: File } | null = null;
// Guards against repeated taps each starting their own full download.
let preparing = false;

/**
 * Download or share a file, using the Web Share API on mobile devices when available.
 * Falls back to a traditional download on desktop or when sharing isn't supported.
 *
 * IMPORTANT: on mobile this must be called directly from the tap handler with no
 * preceding `await` — iOS only allows navigator.share() while the user-activation
 * from the tap is still live, and an earlier awaited fetch (e.g. a version list)
 * consumes it, silently blocking the share sheet.
 */
export async function downloadOrShare(fileId: string, filename?: string): Promise<void> {
	const fileUrl = `/api/files/${fileId}`;

	// Desktop or no file-sharing support → plain download.
	if (!canShareFiles()) {
		window.open(fileUrl, '_blank');
		return;
	}

	// Already downloaded on a previous tap → share now, inside this fresh
	// activation, without re-downloading.
	if (cached && cached.fileId === fileId) {
		try {
			await navigator.share({ files: [cached.file] });
			cached = null;
		} catch (error: any) {
			if (error?.name !== 'AbortError') addToast('info', 'Tap download again to save the video');
		}
		return;
	}

	if (preparing) {
		addToast('info', 'Still preparing the video…');
		return;
	}

	preparing = true;
	// Immediate feedback — the download isn't always instant, and adding a toast is
	// a synchronous state update so it doesn't disturb the iOS share activation.
	const progressId = addStickyToast('info', 'Preparing video…');
	try {
		const response = await fetch(fileUrl);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);

		const blob = await response.blob();
		const name = filenameFor(response, filename || 'download', blob.type);
		const file = new File([blob], name, { type: blob.type });
		cached = { fileId, file };

		removeToast(progressId); // clear it just before the native sheet opens
		await navigator.share({ files: [file] });
		cached = null; // shared successfully → free the memory
	} catch (error: any) {
		removeToast(progressId);

		// User dismissed the share sheet.
		if (error?.name === 'AbortError') {
			cached = null;
			return;
		}

		// Slow download → iOS revoked the activation before share() could run. The
		// blob is cached, so a second tap shares it instantly. (Rare on a LAN.)
		if (error?.name === 'NotAllowedError' && cached?.fileId === fileId) {
			addToast('info', 'Video ready — tap download again to save it');
			return;
		}

		// Genuine failure → surface it and fall back to a plain download.
		addToast('error', `Download failed: ${error?.message || 'Unknown error'}`);
		cached = null;
		window.open(fileUrl, '_blank');
	} finally {
		preparing = false;
	}
}
