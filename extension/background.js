// Strip tracking params and fragment so stored URLs match on lookup
function normalizeUrl(url) {
	try {
		const u = new URL(url);
		u.hash = '';
		for (const p of [
			'si',
			'feature',
			'pp',
			'index',
			'utm_source',
			'utm_medium',
			'utm_campaign',
			'utm_term',
			'utm_content',
			'fbclid',
			'gclid',
			'ref',
			'igshid',
		]) {
			u.searchParams.delete(p);
		}
		return u.toString();
	} catch {
		return url;
	}
}

// Create context menu on install — works on any page
chrome.runtime.onInstalled.addListener(() => {
	chrome.contextMenus.create({
		id: 'send-to-wytui',
		title: 'Send URL to wytui',
		contexts: ['link', 'page'],
	});
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
	if (info.menuItemId !== 'send-to-wytui') return;

	const url = normalizeUrl(info.linkUrl || info.pageUrl);
	if (!url) return;

	const result = await sendToWytui(url);

	if (tab?.id) {
		chrome.tabs
			.sendMessage(tab.id, {
				action: 'showToast',
				success: result.success,
				message: result.success ? 'Download started!' : result.error,
			})
			.catch(() => {});
	}
});

// Handle messages from popup and content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.action === 'quickDownload') {
		sendToWytui(normalizeUrl(message.url), message.profileId, message.saveToLibrary).then(
			sendResponse,
		);
		return true;
	}
	if (message.action === 'fetchProfiles') {
		fetchProfiles().then(sendResponse);
		return true;
	}
	if (message.action === 'lookupUrl') {
		lookupUrl(normalizeUrl(message.url)).then(sendResponse);
		return true;
	}
	if (message.action === 'deleteDownload') {
		deleteDownload(message.id).then(sendResponse);
		return true;
	}
	if (message.action === 'linkYouTube') {
		linkYouTube().then(sendResponse);
		return true;
	}
});

// Cookies are sensitive credentials. Allow sending them over plain http:// only
// to loopback or private-LAN hosts (self-hosters on a LAN); require https://
// for anything routable over the public internet.
function isPrivateHost(host) {
	const h = host.toLowerCase();
	if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost'))
		return true;
	// 10.0.0.0/8
	if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
	// 192.168.0.0/16
	if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
	// 172.16.0.0/12 (172.16.x.x – 172.31.x.x)
	if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
	return false;
}

// Returns null if safe to send credentials to, otherwise an error message.
function checkSecureTransport(serverUrl) {
	let u;
	try {
		u = new URL(serverUrl);
	} catch {
		return 'Invalid server URL.';
	}
	if (u.protocol === 'https:') return null;
	if (u.protocol === 'http:' && isPrivateHost(u.hostname)) return null;
	return 'Refusing to send YouTube cookies over an insecure connection. Use https:// (plain http:// is only allowed for localhost or a private LAN address).';
}

function authHeaders(apiKey) {
	return apiKey ? { Authorization: 'Bearer ' + apiKey } : {};
}

function authCredentials(apiKey) {
	return apiKey ? 'omit' : 'include';
}

async function lookupUrl(url) {
	try {
		const data = await chrome.storage.local.get(['serverUrl', 'apiKey']);
		if (!data.serverUrl) return { success: false, downloads: [] };

		const endpoint = `${data.serverUrl.replace(/\/+$/, '')}/api/downloads/quick?url=${encodeURIComponent(url)}`;

		const res = await fetch(endpoint, {
			credentials: authCredentials(data.apiKey),
			headers: authHeaders(data.apiKey),
		});

		if (!res.ok) return { success: false, downloads: [] };
		const downloads = await res.json();
		return { success: true, downloads };
	} catch (err) {
		console.error('[wytui] lookupUrl exception:', err);
		return { success: false, downloads: [] };
	}
}

async function deleteDownload(id) {
	try {
		if (!id) return { success: false, error: 'Missing download id' };
		const data = await chrome.storage.local.get(['serverUrl', 'apiKey']);
		if (!data.serverUrl) return { success: false, error: 'Extension not configured.' };

		const endpoint = `${data.serverUrl.replace(/\/+$/, '')}/api/downloads/${encodeURIComponent(id)}`;
		const res = await fetch(endpoint, {
			method: 'DELETE',
			credentials: authCredentials(data.apiKey),
			headers: authHeaders(data.apiKey),
		});

		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			return {
				success: false,
				error: body.message || body.error || 'Server returned ' + res.status,
			};
		}
		return { success: true };
	} catch (err) {
		return { success: false, error: 'Connection failed: ' + err.message };
	}
}

async function fetchProfiles() {
	try {
		const data = await chrome.storage.local.get(['serverUrl', 'apiKey']);
		if (!data.serverUrl) return { success: false, status: 0, profiles: [] };

		const base = data.serverUrl.replace(/\/+$/, '');
		const opts = { credentials: authCredentials(data.apiKey), headers: authHeaders(data.apiKey) };
		const hasApiKey = !!data.apiKey;

		const [profilesRes, settingsRes, meRes] = await Promise.all([
			fetch(`${base}/api/profiles`, opts),
			fetch(`${base}/api/settings`, opts),
			fetch(`${base}/api/auth/me`, opts),
		]);

		if (!profilesRes.ok) {
			return { success: false, status: profilesRes.status, profiles: [], hasApiKey };
		}

		const profiles = await profilesRes.json();

		// Library mode: derive from the per-user settings response.
		//   save -> may save directly | request -> needs admin approval | none -> hidden
		let libraryMode = 'none';
		if (settingsRes.ok) {
			const settings = await settingsRes.json();
			if (settings.canUseLibrary) libraryMode = 'save';
			else if (settings.canRequestLibrary) libraryMode = 'request';
		}

		// Server-confirmed auth method + identity (truth, not just "is a key present")
		let authMethod = null;
		let email = null;
		if (meRes.ok) {
			const me = await meRes.json();
			authMethod = me.authMethod || null;
			email = me.user?.email || null;
		}

		return { success: true, status: 200, profiles, libraryMode, authMethod, email, hasApiKey };
	} catch {
		return { success: false, status: 0, profiles: [] };
	}
}

async function sendToWytui(url, profileId, saveToLibrary) {
	try {
		const data = await chrome.storage.local.get(['serverUrl', 'apiKey']);

		if (!data.serverUrl) {
			return {
				success: false,
				error: 'Extension not configured. Open the popup to set the server URL.',
			};
		}

		const endpoint = data.serverUrl.replace(/\/+$/, '') + '/api/downloads/quick';

		const body = { url };
		if (profileId) body.profileId = profileId;
		if (saveToLibrary) body.saveToLibrary = true;

		const response = await fetch(endpoint, {
			method: 'POST',
			credentials: authCredentials(data.apiKey),
			headers: {
				'Content-Type': 'application/json',
				...authHeaders(data.apiKey),
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const body = await response.json().catch(() => ({}));
			return {
				success: false,
				error: body.message || body.error || 'Server returned ' + response.status,
			};
		}

		const result = await response.json();
		return { success: true, downloadId: result.id };
	} catch (err) {
		return { success: false, error: 'Connection failed: ' + err.message };
	}
}

async function linkYouTube() {
	try {
		const data = await chrome.storage.local.get(['serverUrl', 'apiKey']);

		if (!data.serverUrl) {
			return {
				success: false,
				error: 'Extension not configured. Open the popup to set the server URL.',
			};
		}

		// Never transmit harvested cookies over an insecure connection.
		const transportError = checkSecureTransport(data.serverUrl);
		if (transportError) {
			return { success: false, error: transportError };
		}

		const raw = await chrome.cookies.getAll({ domain: 'youtube.com' });
		const cookies = raw.map((c) => ({
			domain: c.domain,
			name: c.name,
			value: c.value,
			path: c.path,
			secure: c.secure,
			expirationDate: c.expirationDate,
			hostOnly: c.hostOnly,
		}));

		const endpoint = data.serverUrl.replace(/\/+$/, '') + '/api/youtube/link';

		const response = await fetch(endpoint, {
			method: 'POST',
			credentials: authCredentials(data.apiKey),
			headers: {
				'Content-Type': 'application/json',
				...authHeaders(data.apiKey),
			},
			body: JSON.stringify({ cookies }),
		});

		if (!response.ok) {
			const body = await response.json().catch(() => ({}));
			return {
				success: false,
				error: body.message || body.error || 'Server returned ' + response.status,
			};
		}

		const result = await response.json();
		return { success: true, channelName: result.channelName || null };
	} catch (err) {
		return { success: false, error: 'Connection failed: ' + err.message };
	}
}
