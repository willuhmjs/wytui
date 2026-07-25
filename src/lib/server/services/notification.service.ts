import { prisma } from '../db';

class NotificationService {
	async send(
		title: string,
		body: string,
		type: 'info' | 'success' | 'warning' | 'failure' = 'info',
	) {
		const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
		if (!settings?.appriseUrl) return;

		try {
			await fetch(`${settings.appriseUrl}/notify`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title, body, type }),
			});
		} catch (e) {
			console.error('[Notification] Failed to send:', e);
		}
	}

	async notifyComplete(downloadTitle: string) {
		const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
		if (!settings?.notifyOnComplete) return;
		await this.send('Download Complete', `"${downloadTitle}" has finished downloading.`, 'success');
	}

	async notifyFail(downloadTitle: string, error: string) {
		const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
		if (!settings?.notifyOnFail) return;
		await this.send('Download Failed', `"${downloadTitle}" failed: ${error}`, 'failure');
	}

	async test() {
		const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
		if (!settings?.appriseUrl) throw new Error('Apprise URL not configured');
		await this.send('Test Notification', 'This is a test notification from wytui.', 'info');
	}
}

export const notificationService = new NotificationService();
