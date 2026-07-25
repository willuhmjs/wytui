/**
 * Accessibility utilities: focus management (focus trap, restore focus),
 * keyboard activation helpers, and unique ID generation for ARIA
 * associations.
 */

const FOCUSABLE_SELECTOR = [
	'a[href]',
	'area[href]',
	'input:not([disabled]):not([type="hidden"])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'button:not([disabled])',
	'iframe',
	'object',
	'embed',
	'[tabindex]:not([tabindex="-1"])',
	'[contenteditable="true"]',
].join(',');

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
		(el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
	);
}

/**
 * Trap focus within `container` until the returned `release` is called.
 * Tab and Shift+Tab cycle within the focusable descendants. The
 * previously focused element is restored on release.
 */
export function trapFocus(container: HTMLElement): () => void {
	const previouslyFocused = document.activeElement as HTMLElement | null;

	const focusables = getFocusableElements(container);
	const initial = focusables[0] ?? container;
	initial.focus();

	function handleKeydown(e: KeyboardEvent) {
		if (e.key !== 'Tab') return;
		const items = getFocusableElements(container);
		if (items.length === 0) {
			e.preventDefault();
			container.focus();
			return;
		}
		const first = items[0];
		const last = items[items.length - 1];
		const active = document.activeElement as HTMLElement | null;

		if (e.shiftKey && active === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && active === last) {
			e.preventDefault();
			first.focus();
		}
	}

	container.addEventListener('keydown', handleKeydown);

	return () => {
		container.removeEventListener('keydown', handleKeydown);
		previouslyFocused?.focus?.();
	};
}

/**
 * Returns true when a keyboard event represents an activation
 * (Enter or Space) on a non-button element that should behave like
 * a button. Use inside `onkeydown` handlers for click-equivalents.
 */
export function isActivationKey(e: KeyboardEvent): boolean {
	return e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar';
}

/**
 * Build an `onkeydown` handler that mirrors a click handler for
 * Enter/Space key presses. Prevents the default Space-scroll behavior.
 */
export function clickOnEnterOrSpace(handler: (e: KeyboardEvent) => void) {
	return (e: KeyboardEvent) => {
		if (isActivationKey(e)) {
			e.preventDefault();
			handler(e);
		}
	};
}

let idCounter = 0;
export function uniqueId(prefix = 'a11y'): string {
	idCounter += 1;
	return `${prefix}-${idCounter}`;
}

/**
 * Svelte action that focuses the node when it mounts. Use in place of the
 * native `autofocus` attribute (which triggers an a11y lint warning and is
 * applied inconsistently) for inputs revealed inside menus/dialogs.
 */
export function focusOnMount(node: HTMLElement) {
	node.focus();
}
