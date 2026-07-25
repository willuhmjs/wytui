import { error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/guards';
import { prisma } from '$lib/server/db';
import { toOpml, toCsv, type SubItem } from '$lib/server/utils/subscriptions-io';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = requireAuth(locals);
	const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'opml';
	const subs = await prisma.subscription.findMany({ where: { userId, type: 'CHANNEL' } });
	if (!subs.length) throw error(404, 'No subscriptions');
	const items: SubItem[] = subs.map((s) => ({ name: s.name, url: s.url }));
	const body = format === 'csv' ? toCsv(items) : toOpml(items);
	return new Response(body, {
		headers: {
			'content-type': format === 'csv' ? 'text/csv' : 'text/x-opml',
			'content-disposition': `attachment; filename="wytui-subscriptions.${format}"`,
		},
	});
};
