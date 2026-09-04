// Store listings and source for the wytui browser extension.
export const EXTENSION_STORE_URLS = {
	firefox: 'https://addons.mozilla.org/en-US/firefox/addon/wytui/',
	chrome: 'https://chromewebstore.google.com/detail/wytui/hpcfodkpajdnkooicfhigeeillkpfbmj',
} as const;

export const REPO_URL = 'https://github.com/willuhmjs/wytui';

/**
 * Detect whether the current browser is Firefox or a Firefox fork
 * (LibreWolf, Waterfox, Zen, Floorp, ...). Falls back to `chrome`
 * (which also covers Edge/Brave/other Chromium browsers).
 */
export function detectBrowser(userAgent?: string): 'firefox' | 'chrome' {
	const ua = userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
	return /firefox/i.test(ua) ? 'firefox' : 'chrome';
}

/**
 * Pick the store URL that matches the current browser. Defaults to the Chrome
 * Web Store (also covers Edge/Brave/other Chromium browsers). Returns the
 * Chrome listing during SSR where `navigator` is unavailable.
 */
export function getExtensionStoreUrl(userAgent?: string): string {
	const ua = userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
	return /firefox/i.test(ua) ? EXTENSION_STORE_URLS.firefox : EXTENSION_STORE_URLS.chrome;
}
