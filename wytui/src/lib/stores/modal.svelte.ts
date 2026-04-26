type ModalType = 'confirm' | 'alert';

type ModalState = {
	isOpen: boolean;
	type: ModalType;
	title: string;
	message: string;
	confirmText?: string;
	cancelText?: string;
	onConfirm?: () => void;
	onCancel?: () => void;
};

let modal = $state<ModalState>({
	isOpen: false,
	type: 'alert',
	title: '',
	message: '',
});

export function showAlert(title: string, message: string): Promise<void> {
	return new Promise((resolve) => {
		modal = {
			isOpen: true,
			type: 'alert',
			title,
			message,
			confirmText: 'OK',
			onConfirm: () => {
				modal.isOpen = false;
				resolve();
			},
		};
	});
}

export function showConfirm(
	title: string,
	message: string,
	confirmText = 'Confirm',
	cancelText = 'Cancel'
): Promise<boolean> {
	return new Promise((resolve) => {
		modal = {
			isOpen: true,
			type: 'confirm',
			title,
			message,
			confirmText,
			cancelText,
			onConfirm: () => {
				modal.isOpen = false;
				resolve(true);
			},
			onCancel: () => {
				modal.isOpen = false;
				resolve(false);
			},
		};
	});
}

export function getModalState() {
	return {
		get isOpen() {
			return modal.isOpen;
		},
		get type() {
			return modal.type;
		},
		get title() {
			return modal.title;
		},
		get message() {
			return modal.message;
		},
		get confirmText() {
			return modal.confirmText;
		},
		get cancelText() {
			return modal.cancelText;
		},
		confirm: () => modal.onConfirm?.(),
		cancel: () => modal.onCancel?.(),
		close: () => {
			modal.isOpen = false;
		},
	};
}
