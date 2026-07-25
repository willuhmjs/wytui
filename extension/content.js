// wytui content script — universal toast notifications

const TOAST_ID = 'wytui-toast';

function showToast(message, success) {
	const existing = document.getElementById(TOAST_ID);
	if (existing) existing.remove();

	const toast = document.createElement('div');
	toast.id = TOAST_ID;
	toast.className = success ? 'wytui-toast-success' : 'wytui-toast-error';
	toast.textContent = message;
	document.body.appendChild(toast);

	requestAnimationFrame(() => toast.classList.add('wytui-toast-visible'));

	setTimeout(() => {
		toast.classList.remove('wytui-toast-visible');
		setTimeout(() => toast.remove(), 300);
	}, 3500);
}

// Listen for toast messages from background (context menu downloads)
chrome.runtime.onMessage.addListener((message, sender) => {
	// Validate sender is from this extension
	if (sender.id !== chrome.runtime.id) {
		console.warn('[wytui] Message from unknown sender:', sender);
		return;
	}

	// Validate message structure
	if (!message || typeof message !== 'object') {
		console.warn('[wytui] Invalid message format:', message);
		return;
	}

	// Validate action
	if (typeof message.action !== 'string') {
		console.warn('[wytui] Invalid message action:', message);
		return;
	}

	if (message.action === 'showToast') {
		if (typeof message.message === 'string' && typeof message.success === 'boolean') {
			showToast(message.message, message.success);
		}
	}
});
