import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadOrShare } from './download';
import * as toastStore from '$lib/stores/toast.svelte';

// Mock the toast store
vi.mock('$lib/stores/toast.svelte', () => ({
	addToast: vi.fn(),
	addStickyToast: vi.fn(() => 'sticky-id'),
	removeToast: vi.fn(),
	resolveToast: vi.fn(),
}));

// Build a mock fetch Response. `disposition` lets a test exercise the
// Content-Disposition filename parsing.
function mockResponse(blob: Blob, disposition?: string) {
	return {
		ok: true,
		status: 200,
		blob: () => Promise.resolve(blob),
		headers: {
			get: (h: string) =>
				h.toLowerCase() === 'content-disposition' ? (disposition ?? null) : null,
		},
	};
}

// Each test uses a unique file id so the module-level blob cache (keyed by id)
// never leaks state between tests.
let idCounter = 0;
const nextId = () => `test-file-${++idCounter}`;

describe('downloadOrShare', () => {
	let originalNavigator: typeof navigator;
	let windowOpenSpy: ReturnType<typeof vi.fn>;
	let fetchSpy: ReturnType<typeof vi.fn>;
	let navigatorShareSpy: ReturnType<typeof vi.fn>;
	let navigatorCanShareSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		originalNavigator = global.navigator;
		vi.clearAllMocks();

		windowOpenSpy = vi.fn();
		(global.window.open as any) = windowOpenSpy;

		fetchSpy = vi.fn();
		(global.fetch as any) = fetchSpy;

		navigatorShareSpy = vi.fn();
		navigatorCanShareSpy = vi.fn();
	});

	afterEach(() => {
		Object.defineProperty(global, 'navigator', {
			value: originalNavigator,
			writable: true,
			configurable: true,
		});
	});

	function mockMobileDevice() {
		Object.defineProperty(global.navigator, 'userAgent', {
			value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
			writable: true,
			configurable: true,
		});
	}

	function mockDesktopDevice() {
		Object.defineProperty(global.navigator, 'userAgent', {
			value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
			writable: true,
			configurable: true,
		});
	}

	function mockShareAPI(canShare = true) {
		Object.defineProperty(global.navigator, 'canShare', {
			value: navigatorCanShareSpy.mockReturnValue(canShare),
			writable: true,
			configurable: true,
		});
		Object.defineProperty(global.navigator, 'share', {
			value: navigatorShareSpy,
			writable: true,
			configurable: true,
		});
	}

	describe('Desktop behavior', () => {
		it('should use window.open on desktop browsers', async () => {
			mockDesktopDevice();
			const id = nextId();

			await downloadOrShare(id, 'test.mp4');

			expect(windowOpenSpy).toHaveBeenCalledWith(`/api/files/${id}`, '_blank');
			expect(fetchSpy).not.toHaveBeenCalled();
			expect(navigatorShareSpy).not.toHaveBeenCalled();
		});

		it('should use window.open when Share API is not available', async () => {
			mockMobileDevice();
			const id = nextId();
			// Don't mock Share API (it's undefined)

			await downloadOrShare(id);

			expect(windowOpenSpy).toHaveBeenCalledWith(`/api/files/${id}`, '_blank');
			expect(fetchSpy).not.toHaveBeenCalled();
		});
	});

	describe('Mobile behavior with Share API', () => {
		beforeEach(() => {
			mockMobileDevice();
			mockShareAPI(true);
		});

		it('should use Share API on mobile when available', async () => {
			const id = nextId();
			fetchSpy.mockResolvedValue(mockResponse(new Blob(['test content'], { type: 'video/mp4' })));
			navigatorShareSpy.mockResolvedValue(undefined);

			await downloadOrShare(id, 'test-video.mp4');

			expect(navigatorCanShareSpy).toHaveBeenCalledWith({ files: [expect.any(File)] });
			expect(fetchSpy).toHaveBeenCalledWith(`/api/files/${id}`);
			expect(navigatorShareSpy).toHaveBeenCalledWith({ files: [expect.any(File)] });
			expect(windowOpenSpy).not.toHaveBeenCalled();
		});

		it('should use the provided filename in Share API', async () => {
			const id = nextId();
			fetchSpy.mockResolvedValue(mockResponse(new Blob(['x'], { type: 'video/mp4' })));
			navigatorShareSpy.mockResolvedValue(undefined);

			await downloadOrShare(id, 'my-custom-video.mp4');

			const file = navigatorShareSpy.mock.calls[0][0].files[0];
			expect(file.name).toBe('my-custom-video.mp4');
			expect(file.type).toBe('video/mp4');
		});

		it('should prefer the Content-Disposition filename from the server', async () => {
			const id = nextId();
			fetchSpy.mockResolvedValue(
				mockResponse(
					new Blob(['x'], { type: 'video/mp4' }),
					'attachment; filename="Server Name.mp4"',
				),
			);
			navigatorShareSpy.mockResolvedValue(undefined);

			await downloadOrShare(id, 'client-fallback.mp4');

			const file = navigatorShareSpy.mock.calls[0][0].files[0];
			expect(file.name).toBe('Server Name.mp4');
		});

		it('should append the correct extension so iOS recognises the media', async () => {
			const id = nextId();
			// No extension on the provided name → must gain .mp4 from the blob type.
			fetchSpy.mockResolvedValue(mockResponse(new Blob(['x'], { type: 'video/mp4' })));
			navigatorShareSpy.mockResolvedValue(undefined);

			await downloadOrShare(id, 'My Cool Video');

			const file = navigatorShareSpy.mock.calls[0][0].files[0];
			expect(file.name).toBe('My Cool Video.mp4');
		});

		it('should default the filename to "download.mp4" when none provided', async () => {
			const id = nextId();
			fetchSpy.mockResolvedValue(mockResponse(new Blob(['x'], { type: 'video/mp4' })));
			navigatorShareSpy.mockResolvedValue(undefined);

			await downloadOrShare(id);

			const file = navigatorShareSpy.mock.calls[0][0].files[0];
			expect(file.name).toBe('download.mp4');
		});

		it('should silently handle AbortError (user cancelled)', async () => {
			const id = nextId();
			fetchSpy.mockResolvedValue(mockResponse(new Blob(['x'], { type: 'video/mp4' })));

			const abortError = new Error('User cancelled');
			abortError.name = 'AbortError';
			navigatorShareSpy.mockRejectedValue(abortError);

			await downloadOrShare(id, 'test.mp4');

			expect(toastStore.addToast).not.toHaveBeenCalled();
			expect(windowOpenSpy).not.toHaveBeenCalled();
		});

		it('should show toast and fallback on network error', async () => {
			const id = nextId();
			fetchSpy.mockRejectedValue(new Error('Network error'));

			await downloadOrShare(id, 'test.mp4');

			expect(toastStore.addToast).toHaveBeenCalledWith('error', 'Download failed: Network error');
			expect(windowOpenSpy).toHaveBeenCalledWith(`/api/files/${id}`, '_blank');
		});

		it('should show toast and fallback on HTTP error', async () => {
			const id = nextId();
			fetchSpy.mockResolvedValue({ ok: false, status: 404, headers: { get: () => null } });

			await downloadOrShare(id, 'test.mp4');

			expect(toastStore.addToast).toHaveBeenCalledWith('error', 'Download failed: HTTP 404');
			expect(windowOpenSpy).toHaveBeenCalledWith(`/api/files/${id}`, '_blank');
		});

		it('should keep the blob and prompt a retry when iOS drops the activation', async () => {
			const id = nextId();
			fetchSpy.mockResolvedValue(mockResponse(new Blob(['x'], { type: 'video/mp4' })));

			const shareError = new Error('Share not allowed');
			shareError.name = 'NotAllowedError';
			navigatorShareSpy.mockRejectedValueOnce(shareError);

			// First tap: download succeeds but share is blocked → prompt, no fallback.
			await downloadOrShare(id, 'test.mp4');

			expect(toastStore.addToast).toHaveBeenCalledWith(
				'info',
				'Video ready — tap download again to save it',
			);
			expect(windowOpenSpy).not.toHaveBeenCalled();
			expect(fetchSpy).toHaveBeenCalledTimes(1);

			// Second tap: shares the cached blob without re-downloading.
			navigatorShareSpy.mockResolvedValueOnce(undefined);
			await downloadOrShare(id, 'test.mp4');

			expect(navigatorShareSpy).toHaveBeenCalledTimes(2);
			expect(fetchSpy).toHaveBeenCalledTimes(1); // no second download
		});

		it('should handle a share error without a message', async () => {
			const id = nextId();
			fetchSpy.mockResolvedValue(mockResponse(new Blob(['x'], { type: 'video/mp4' })));
			navigatorShareSpy.mockRejectedValue({});

			await downloadOrShare(id, 'test.mp4');

			expect(toastStore.addToast).toHaveBeenCalledWith('error', 'Download failed: Unknown error');
			expect(windowOpenSpy).toHaveBeenCalledWith(`/api/files/${id}`, '_blank');
		});
	});

	describe('Mobile detection', () => {
		it('should detect Android devices', async () => {
			Object.defineProperty(global.navigator, 'userAgent', {
				value: 'Mozilla/5.0 (Linux; Android 11)',
				writable: true,
				configurable: true,
			});
			mockShareAPI(true);
			fetchSpy.mockResolvedValue(mockResponse(new Blob(['t'], { type: 'video/mp4' })));
			navigatorShareSpy.mockResolvedValue(undefined);

			await downloadOrShare(nextId());

			expect(navigatorShareSpy).toHaveBeenCalled();
		});

		it('should detect iOS devices (iPhone)', async () => {
			Object.defineProperty(global.navigator, 'userAgent', {
				value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
				writable: true,
				configurable: true,
			});
			mockShareAPI(true);
			fetchSpy.mockResolvedValue(mockResponse(new Blob(['t'], { type: 'video/mp4' })));
			navigatorShareSpy.mockResolvedValue(undefined);

			await downloadOrShare(nextId());

			expect(navigatorShareSpy).toHaveBeenCalled();
		});

		it('should detect iOS devices (iPad)', async () => {
			Object.defineProperty(global.navigator, 'userAgent', {
				value: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)',
				writable: true,
				configurable: true,
			});
			mockShareAPI(true);
			fetchSpy.mockResolvedValue(mockResponse(new Blob(['t'], { type: 'video/mp4' })));
			navigatorShareSpy.mockResolvedValue(undefined);

			await downloadOrShare(nextId());

			expect(navigatorShareSpy).toHaveBeenCalled();
		});
	});

	describe('Edge cases', () => {
		it('should handle canShare returning false', async () => {
			mockMobileDevice();
			mockShareAPI(false); // canShare returns false
			const id = nextId();

			await downloadOrShare(id, 'test.mp4');

			expect(windowOpenSpy).toHaveBeenCalledWith(`/api/files/${id}`, '_blank');
			expect(fetchSpy).not.toHaveBeenCalled();
			expect(navigatorShareSpy).not.toHaveBeenCalled();
		});

		it('should preserve blob type in the File object', async () => {
			mockMobileDevice();
			mockShareAPI(true);
			const id = nextId();

			fetchSpy.mockResolvedValue(mockResponse(new Blob(['x'], { type: 'audio/mpeg' })));
			navigatorShareSpy.mockResolvedValue(undefined);

			await downloadOrShare(id, 'song.mp3');

			const file = navigatorShareSpy.mock.calls[0][0].files[0];
			expect(file.type).toBe('audio/mpeg');
			expect(file.name).toBe('song.mp3');
		});
	});
});
