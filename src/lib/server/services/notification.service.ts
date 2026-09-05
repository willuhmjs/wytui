import { prisma } from '../db';

class NotificationService {
	/**
	 * Resolve the Apprise endpoint + event toggles for a download's owner. A
	 * linked account with its own appriseUrl replaces the server-wide settings;
	 * otherwise the global Settings apply.
	 */
	private async resolveTarget(userId?: string | null): Promise<{
		appriseUrl: string | null;
		notifyOnComplete: boolean;
		notifyOnFail: boolean;
	} | null> {
		const [settings, link] = await Promise.all([
			prisma.settings.findUnique({ where: { id: 'singleton' } }),
			userId ? prisma.youTubeLink.findUnique({ where: { userId } }) : Promise.resolve(null),
		]);
		if (link?.appriseUrl) {
			return {
				appriseUrl: link.appriseUrl,
				notifyOnComplete: link.notifyOnComplete,
				notifyOnFail: link.notifyOnFail,
			};
		}
		if (!settings) return null;
		return {
			appriseUrl: settings.appriseUrl ?? null,
			notifyOnComplete: settings.notifyOnComplete,
			notifyOnFail: settings.notifyOnFail,
		};
	}

	private async deliver(
		appriseUrl: string,
		title: string,
		body: string,
		type: 'info' | 'success' | 'warning' | 'failure',
	): Promise<void> {
		try {
			await fetch(`${appriseUrl}/notify`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title, body, type }),
			});
		} catch (e) {
			console.error('[Notification] Failed to send:', e);
		}
	}

	async send(
		title: string,
		body: string,
		type: 'info' | 'success' | 'warning' | 'failure' = 'info',
	) {
		const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
		if (!settings?.appriseUrl) return;
		await this.deliver(settings.appriseUrl, title, body, type);
	}

	async notifyComplete(downloadTitle: string, userId?: string | null) {
		const target = await this.resolveTarget(userId);
		if (!target?.notifyOnComplete || !target.appriseUrl) return;
		await this.deliver(
			target.appriseUrl,
			'Download Complete',
			`"${downloadTitle}" has finished downloading.`,
			'success',
		);
	}

	async notifyFail(downloadTitle: string, error: string, userId?: string | null) {
		const target = await this.resolveTarget(userId);
		if (!target?.notifyOnFail || !target.appriseUrl) return;
		await this.deliver(
			target.appriseUrl,
			'Download Failed',
			`"${downloadTitle}" failed: ${error}`,
			'failure',
		);
	}

	async test() {
		const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
		if (!settings?.appriseUrl) throw new Error('Apprise URL not configured');
		await this.send('Test Notification', 'This is a test notification from wytui.', 'info');
	}

	/** Test the linked account's own Apprise endpoint. */
	async testAccount(userId: string): Promise<void> {
		const link = await prisma.youTubeLink.findUnique({ where: { userId } });
		if (!link?.appriseUrl) throw new Error('No Apprise URL configured for this account');
		await this.deliver(
			link.appriseUrl,
			'Test Notification',
			'This is a test notification from wytui.',
			'info',
		);
	}
}

export const notificationService = new NotificationService();
