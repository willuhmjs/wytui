export type SubItem = { name: string; url: string; channelId?: string };

function xmlEscape(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export function toOpml(items: SubItem[]): string {
	const body = items
		.map(
			(i) =>
				`    <outline text="${xmlEscape(i.name)}" title="${xmlEscape(i.name)}" type="rss" xmlUrl="${xmlEscape(i.url)}"/>`,
		)
		.join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="1.1">\n  <head><title>wytui subscriptions</title></head>\n  <body>\n${body}\n  </body>\n</opml>\n`;
}

export function parseOpml(xml: string): SubItem[] {
	const out: SubItem[] = [];
	const re = /<outline\b[^>]*\bxmlUrl="([^"]+)"[^>]*\/?>/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(xml))) {
		const full = m[0];
		const url = m[1].replace(/&amp;/g, '&');
		const title = /\btitle="([^"]*)"/.exec(full)?.[1] ?? /\btext="([^"]*)"/.exec(full)?.[1] ?? url;
		out.push({ name: title.replace(/&amp;/g, '&'), url });
	}
	return out;
}

function csvCell(s: string): string {
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(items: SubItem[]): string {
	const rows = ['name,url,channelId'];
	for (const i of items)
		rows.push([csvCell(i.name), csvCell(i.url), csvCell(i.channelId ?? '')].join(','));
	return rows.join('\n') + '\n';
}

/** Minimal CSV parser (handles quoted cells with commas and doubled quotes). */
function parseCsvLine(line: string): string[] {
	const cells: string[] = [];
	let cur = '',
		inQ = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (inQ) {
			if (ch === '"' && line[i + 1] === '"') {
				cur += '"';
				i++;
			} else if (ch === '"') inQ = false;
			else cur += ch;
		} else if (ch === '"') inQ = true;
		else if (ch === ',') {
			cells.push(cur);
			cur = '';
		} else cur += ch;
	}
	cells.push(cur);
	return cells;
}

export function parseCsv(text: string): SubItem[] {
	const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
	const out: SubItem[] = [];
	for (const line of lines) {
		const cells = parseCsvLine(line);
		if (cells[0]?.toLowerCase() === 'name' && cells[1]?.toLowerCase() === 'url') continue; // header
		if (!cells[1]) continue;
		out.push({ name: cells[0] ?? cells[1], url: cells[1], channelId: cells[2] || undefined });
	}
	return out;
}
