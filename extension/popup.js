// Elements
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const versionText = document.getElementById('versionText');
const urlText = document.getElementById('urlText');
const urlFavicon = document.getElementById('urlFavicon');
const openWytuiBtn = document.getElementById('openWytuiBtn');
const profileSelect = document.getElementById('profileSelect');
const libraryToggle = document.getElementById('libraryToggle');
const libraryToggleRow = document.getElementById('libraryToggleRow');
const libraryToggleTitle = document.getElementById('libraryToggleTitle');
const libraryToggleSub = document.getElementById('libraryToggleSub');
const downloadBtn = document.getElementById('downloadBtn');
const downloadBtnLabel = document.getElementById('downloadBtnLabel');
const messageEl = document.getElementById('message');
const viewLink = document.getElementById('viewLink');
const serverUrlInput = document.getElementById('serverUrl');
const apiKeyInput = document.getElementById('apiKey');
const saveBtn = document.getElementById('saveBtn');
// Existing-download card
const existingWrap = document.getElementById('existingWrap');
const existingTitle = document.getElementById('existingTitle');
const existingChannel = document.getElementById('existingChannel');
const existingStatus = document.getElementById('existingStatus');
const existingFormat = document.getElementById('existingFormat');
const existingViewLink = document.getElementById('existingViewLink');
const copyPrev = document.getElementById('copyPrev');
const copyNext = document.getElementById('copyNext');
const copyCounter = document.getElementById('copyCounter');
const copyDeleteBtn = document.getElementById('copyDeleteBtn');

let currentTabUrl = '';
let serverUrl = '';
let saveToLibrary = false;

// Copies of the video currently on the page (one card, page through these)
let existingCopies = [];
let copyIndex = 0;
let deleteArmed = false;
let deleteArmTimer = null;

// Show the running extension version (read from manifest so it can't drift)
try {
	versionText.textContent = 'v' + chrome.runtime.getManifest().version;
} catch {}

const downloadTabBtn = document.querySelector('.tab-btn[data-tab="download"]');

function setConfigured(configured) {
	downloadTabBtn.disabled = !configured;
	downloadTabBtn.title = configured ? '' : 'Configure wytui first';
}

// Tab switching
document.querySelectorAll('.tab-btn').forEach((btn) => {
	btn.addEventListener('click', () => {
		if (btn.disabled) return;
		document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
		document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
		btn.classList.add('active');
		document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
	});
});

// Library toggle
libraryToggleRow.addEventListener('click', () => {
	saveToLibrary = !saveToLibrary;
	libraryToggle.classList.toggle('on', saveToLibrary);
});

// Init: load settings, current tab, profiles
chrome.storage.local.get(['serverUrl', 'apiKey'], async (data) => {
	if (data.serverUrl) serverUrlInput.value = data.serverUrl;
	if (data.apiKey) apiKeyInput.value = data.apiKey;

	serverUrl = data.serverUrl || '';

	// If no server URL at all, go straight to settings
	if (!data.serverUrl) {
		updateStatus('unconfigured');
		setConfigured(false);
		switchToSettings();
		return;
	}

	// Get current tab (do this while checking auth)
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (tab?.url) {
		currentTabUrl = tab.url;
		urlText.textContent = formatUrl(tab.url);
		if (tab.favIconUrl) {
			urlFavicon.src = tab.favIconUrl;
			urlFavicon.style.display = '';
		} else {
			urlFavicon.style.display = 'none';
		}
	}

	// Verify auth (API key or cookie session) and load profiles
	updateStatus('checking');
	const profileResult = await chrome.runtime.sendMessage({ action: 'fetchProfiles' });
	if (!profileResult?.success) {
		updateStatus(data.apiKey ? 'key-invalid' : 'error');
		setConfigured(false);
		switchToSettings();
		return;
	}

	updateStatus(statusFromResult(profileResult), profileResult.email);
	setConfigured(true);
	applyLibraryVisibility(profileResult);
	populateProfiles(profileResult);
	if (currentTabUrl) lookupExisting(currentTabUrl);
});

function switchToSettings() {
	document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
	document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
	document.querySelector('.tab-btn[data-tab="settings"]').classList.add('active');
	document.getElementById('panel-settings').classList.add('active');
}

// Open in wytui (opens downloads page)
openWytuiBtn.addEventListener('click', () => {
	if (serverUrl) chrome.tabs.create({ url: serverUrl.replace(/\/+$/, '') + '/downloads' });
});

function formatUrl(url) {
	try {
		const u = new URL(url);
		const path = u.pathname === '/' ? '' : u.pathname;
		const query = u.search;
		const full = u.hostname + path + query;
		return full.length > 50 ? full.slice(0, 48) + '…' : full;
	} catch {
		return url;
	}
}

function updateStatus(state, detail) {
	const states = {
		unconfigured: ['status-dot', 'Not configured'],
		checking: ['status-dot checking', 'Checking…'],
		'connected-key': ['status-dot connected', 'Connected · API key'],
		'connected-session': ['status-dot connected', 'Connected · Session'],
		'connected-proxy': ['status-dot connected', 'Connected · Proxy'],
		'key-invalid': ['status-dot error', 'API key invalid'],
		error: ['status-dot error', 'Auth failed'],
	};
	const [cls, label] = states[state] || states.unconfigured;
	statusDot.className = cls;
	statusText.textContent = detail ? `${label} · ${detail}` : label;
	const isConnected = state.startsWith('connected-');
	downloadBtn.disabled = !isConnected;
}

// Map a successful fetchProfiles result to the status the server actually used.
// If an API key is stored but the server did NOT authenticate via it, the key is
// invalid — surface that instead of a misleading "connected" state.
function statusFromResult(result) {
	if (result.hasApiKey && result.authMethod !== 'apikey') return 'key-invalid';
	if (result.authMethod === 'apikey') return 'connected-key';
	if (result.authMethod === 'proxy') return 'connected-proxy';
	return 'connected-session';
}

const STATUS_MAP = {
	COMPLETED: ['completed', 'Completed'],
	PENDING: ['pending', 'Pending'],
	DOWNLOADING: ['downloading', 'Downloading'],
	FETCHING_INFO: ['downloading', 'Fetching info'],
	PROCESSING: ['downloading', 'Processing'],
	FAILED: ['failed', 'Failed'],
	CANCELLED: ['failed', 'Cancelled'],
};

// Human label for a copy's format/profile (e.g. "1080p · MP4", "Audio · MP3")
function copyFormatLabel(c) {
	const p = c.profile;
	let detail = '';
	if (p?.audioOnly) {
		detail = p.audioFormat ? p.audioFormat.toUpperCase() : 'Audio';
	} else {
		detail = p?.quality || (c.height ? c.height + 'p' : c.format || '');
	}
	const pool = c.storagePool === 'library' ? ' · Library' : '';
	const name = p?.name || '';
	if (name && detail) return `${name} · ${detail}${pool}`;
	return (name || detail || '—') + pool;
}

async function lookupExisting(url) {
	let result;
	try {
		result = await chrome.runtime.sendMessage({ action: 'lookupUrl', url });
	} catch (err) {
		console.error('[wytui] sendMessage failed:', err);
		return;
	}

	existingCopies = result?.success && Array.isArray(result.downloads) ? result.downloads : [];
	copyIndex = 0;
	disarmDelete();

	if (!existingCopies.length) {
		existingWrap.classList.remove('visible');
		setDownloadButtonLabel('Download');
		return;
	}

	// Header: title + channel shown once (first copy with a title wins)
	const named = existingCopies.find((d) => d.title) || existingCopies[0];
	existingTitle.textContent = named.title || url;
	if (named.uploader) {
		existingChannel.textContent = named.uploader;
		existingChannel.style.display = '';
	} else {
		existingChannel.style.display = 'none';
	}

	renderCopy();
	existingWrap.classList.add('visible');
	setDownloadButtonLabel('Download another format');
}

function renderCopy() {
	if (!existingCopies.length) return;
	if (copyIndex >= existingCopies.length) copyIndex = existingCopies.length - 1;
	if (copyIndex < 0) copyIndex = 0;
	disarmDelete();

	const c = existingCopies[copyIndex];
	const [cls, label] = STATUS_MAP[c.status] || ['other', c.status];
	existingStatus.className = 'existing-status ' + cls;
	existingStatus.textContent = label;
	existingFormat.textContent = copyFormatLabel(c);
	existingViewLink.href = serverUrl.replace(/\/+$/, '') + '/downloads/' + c.id;

	const multi = existingCopies.length > 1;
	copyCounter.textContent = multi ? `${copyIndex + 1} / ${existingCopies.length}` : '';
	copyPrev.classList.toggle('hidden', !multi);
	copyNext.classList.toggle('hidden', !multi);
	copyPrev.disabled = copyIndex === 0;
	copyNext.disabled = copyIndex === existingCopies.length - 1;
}

copyPrev.addEventListener('click', () => {
	if (copyIndex > 0) {
		copyIndex--;
		renderCopy();
	}
});
copyNext.addEventListener('click', () => {
	if (copyIndex < existingCopies.length - 1) {
		copyIndex++;
		renderCopy();
	}
});

function disarmDelete() {
	deleteArmed = false;
	if (deleteArmTimer) {
		clearTimeout(deleteArmTimer);
		deleteArmTimer = null;
	}
	copyDeleteBtn.textContent = 'Delete';
	copyDeleteBtn.disabled = false;
}

// Two-step delete (avoids confirm() dismissing the popup)
copyDeleteBtn.addEventListener('click', async () => {
	if (!existingCopies.length) return;

	if (!deleteArmed) {
		deleteArmed = true;
		copyDeleteBtn.textContent = 'Confirm delete?';
		deleteArmTimer = setTimeout(disarmDelete, 3000);
		return;
	}

	if (deleteArmTimer) {
		clearTimeout(deleteArmTimer);
		deleteArmTimer = null;
	}
	deleteArmed = false;
	const target = existingCopies[copyIndex];
	copyDeleteBtn.disabled = true;
	copyDeleteBtn.textContent = 'Deleting…';

	const res = await chrome.runtime.sendMessage({ action: 'deleteDownload', id: target.id });
	if (!res?.success) {
		showMessage(res?.error || 'Failed to delete.', 'error');
		disarmDelete();
		return;
	}

	existingCopies.splice(copyIndex, 1);
	if (!existingCopies.length) {
		existingWrap.classList.remove('visible');
		setDownloadButtonLabel('Download');
		showMessage('Deleted.', 'success');
		return;
	}
	renderCopy();
	showMessage('Deleted.', 'success');
});

function applyLibraryVisibility(result) {
	const mode = result?.libraryMode || 'none';
	if (mode === 'none') {
		libraryToggleRow.style.display = 'none';
		saveToLibrary = false;
		libraryToggle.classList.remove('on');
		return;
	}
	libraryToggleRow.style.display = '';
	if (libraryToggleTitle && libraryToggleSub) {
		if (mode === 'request') {
			libraryToggleTitle.textContent = 'Request Library Save';
			libraryToggleSub.textContent = 'Needs admin approval';
		} else {
			libraryToggleTitle.textContent = 'Save to Library';
			libraryToggleSub.textContent = 'Skip cache and save permanently';
		}
	}
}

function populateProfiles(result) {
	profileSelect.innerHTML = '';

	if (!result?.success || !result.profiles?.length) {
		profileSelect.innerHTML = '<option value="">Default profile</option>';
		profileSelect.disabled = false;
		return;
	}

	const defaultOpt = document.createElement('option');
	defaultOpt.value = '';
	defaultOpt.textContent = 'Default profile';
	profileSelect.appendChild(defaultOpt);

	result.profiles.forEach((p) => {
		const opt = document.createElement('option');
		opt.value = p.id;
		const badge = p.isDefault ? ' ★' : p.isSystem ? ' (system)' : '';
		const detail = p.audioOnly ? ' · audio' : p.quality ? ` · ${p.quality}` : '';
		opt.textContent = p.name + badge + detail;
		profileSelect.appendChild(opt);
	});

	profileSelect.disabled = false;

	const defaultProfile = result.profiles.find((p) => p.isDefault);
	if (defaultProfile) profileSelect.value = defaultProfile.id;
}

// Save settings
saveBtn.addEventListener('click', () => {
	const url = serverUrlInput.value.trim().replace(/\/+$/, '');
	const key = apiKeyInput.value.trim();

	if (!url) {
		showSettingsError('Server URL is required.');
		return;
	}

	chrome.storage.local.set({ serverUrl: url, apiKey: key }, async () => {
		serverUrl = url;
		saveBtn.textContent = 'Saved!';
		setTimeout(() => {
			saveBtn.textContent = 'Save';
		}, 2000);
		updateStatus('checking');
		const profileResult = await chrome.runtime.sendMessage({ action: 'fetchProfiles' });
		if (!profileResult?.success) {
			updateStatus(key ? 'key-invalid' : 'error');
			setConfigured(false);
			return;
		}
		updateStatus(statusFromResult(profileResult), profileResult.email);
		setConfigured(true);
		applyLibraryVisibility(profileResult);
		populateProfiles(profileResult);
		if (currentTabUrl) lookupExisting(currentTabUrl);
	});
});

function showSettingsError(msg) {
	saveBtn.textContent = msg;
	saveBtn.style.background = '#ef4444';
	setTimeout(() => {
		saveBtn.textContent = 'Save';
		saveBtn.style.background = '';
	}, 2500);
}

function setDownloadButtonLabel(text) {
	if (downloadBtnLabel) downloadBtnLabel.textContent = text;
}

// Download (also used to add another format when the video already exists)
downloadBtn.addEventListener('click', async () => {
	if (!currentTabUrl) {
		showMessage('No page URL found.', 'error');
		return;
	}

	const wasExisting = existingCopies.length > 0;
	downloadBtn.disabled = true;
	setDownloadButtonLabel('Sending…');
	viewLink.style.display = 'none';

	const profileId = profileSelect.value || undefined;

	const response = await chrome.runtime.sendMessage({
		action: 'quickDownload',
		url: currentTabUrl,
		profileId,
		saveToLibrary,
	});

	downloadBtn.disabled = false;
	setDownloadButtonLabel(wasExisting ? 'Download another format' : 'Download');

	if (response?.success) {
		showMessage('Download started!', 'success');
		if (response.downloadId && serverUrl) {
			viewLink.href = serverUrl.replace(/\/+$/, '') + '/downloads/' + response.downloadId;
			viewLink.style.display = 'inline-flex';
		}
		// Refresh the card so the new copy shows up in the pager
		lookupExisting(currentTabUrl);
	} else {
		showMessage(response?.error || 'Failed to send download.', 'error');
	}
});

function showMessage(text, type) {
	messageEl.textContent = text;
	messageEl.className = 'message ' + type;
	if (type === 'error') viewLink.style.display = 'none';
}

// Link YouTube
document.getElementById('link-youtube').addEventListener('click', async () => {
	const status = document.getElementById('yt-status');
	status.textContent = 'Linking…';
	status.className = 'message';
	status.style.display = 'block';
	const res = await chrome.runtime.sendMessage({ action: 'linkYouTube' });
	if (res?.success) {
		status.textContent = 'Linked as ' + (res.channelName || 'YouTube user');
		status.className = 'message success';
	} else {
		status.className = 'message error';
		status.textContent = (res?.error || 'Linking failed.') + ' ';
		// Offer a quick way to sign in to YouTube (common cause: not logged in / expired cookies).
		const a = document.createElement('a');
		a.href = 'https://youtube.com';
		a.target = '_blank';
		a.rel = 'noopener';
		a.textContent = 'Log in to YouTube';
		status.appendChild(a);
	}
});

// Inject spin keyframe into popup
const style = document.createElement('style');
style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
document.head.appendChild(style);
