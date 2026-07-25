type ToastType = 'success' | 'error' | 'info';

type Toast = {
	id: string;
	type: ToastType;
	message: string;
	progress?: number;
	sticky?: boolean;
	details?: string[];
};

let toasts = $state<Toast[]>([]);
const timers = new Map<string, ReturnType<typeof setTimeout>>();

let idCounter = 0;

export function addToast(type: ToastType, message: string, duration = 4000): string {
	const id = `toast-${++idCounter}`;
	toasts = [...toasts, { id, type, message }];

	if (toasts.length > 5) {
		const dropped = toasts.slice(0, toasts.length - 5);
		dropped.forEach((t) => {
			const timer = timers.get(t.id);
			if (timer) clearTimeout(timer);
			timers.delete(t.id);
		});
		toasts = toasts.slice(-5);
	}

	const timer = setTimeout(() => {
		removeToast(id);
	}, duration);
	timers.set(id, timer);
	return id;
}

export function addStickyToast(type: ToastType, message: string, progress?: number): string {
	const id = `toast-${++idCounter}`;
	toasts = [...toasts, { id, type, message, progress, sticky: true }];
	return id;
}

export function updateToast(
	id: string,
	update: { type?: ToastType; message?: string; progress?: number; details?: string[] },
): void {
	toasts = toasts.map((t) => (t.id === id ? { ...t, ...update } : t));
}

export function resolveToast(
	id: string,
	type: ToastType,
	message: string,
	options: { duration?: number; details?: string[] } = {},
): void {
	const { duration = 5000, details } = options;
	toasts = toasts.map((t) =>
		t.id === id ? { ...t, type, message, sticky: false, progress: undefined, details } : t,
	);
	const existing = timers.get(id);
	if (existing) clearTimeout(existing);
	const timer = setTimeout(() => removeToast(id), duration);
	timers.set(id, timer);
}

export function removeToast(id: string): void {
	const timer = timers.get(id);
	if (timer) clearTimeout(timer);
	timers.delete(id);
	toasts = toasts.filter((t) => t.id !== id);
}

export function getToasts() {
	return {
		get list() {
			return toasts;
		},
	};
}
