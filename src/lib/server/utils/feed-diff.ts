/** Ids present in feed but not in seen; de-duplicated, order-preserving. */
export function newVideoIds(feed: { id: string }[], seen: Set<string>): string[] {
	const out: string[] = [];
	const emitted = new Set<string>();
	for (const { id } of feed) {
		if (seen.has(id) || emitted.has(id)) continue;
		emitted.add(id);
		out.push(id);
	}
	return out;
}
