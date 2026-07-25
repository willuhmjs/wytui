import { buildSpec } from '$lib/server/openapi';
import type { RequestHandler } from './$types';

const modules = import.meta.glob('/src/routes/api/**/+server.ts', { eager: true });

function specToText(spec: ReturnType<typeof buildSpec>): string {
	const lines: string[] = [];

	lines.push(`# ${spec.info.title} API Reference`);
	lines.push('');
	lines.push(spec.info.description || '');
	lines.push('');
	lines.push('---');
	lines.push('');

	for (const [path, methods] of Object.entries(spec.paths)) {
		for (const [method, op] of Object.entries(methods as Record<string, any>)) {
			lines.push(`## ${method.toUpperCase()} ${path}`);
			if (op.summary) lines.push(`${op.summary}`);
			if (op.description) lines.push(`\n${op.description}`);
			if (op.tags?.length) lines.push(`Tags: ${op.tags.join(', ')}`);

			if (op.security?.length) {
				lines.push('Auth: required');
			}

			if (op.parameters?.length) {
				lines.push('\nParameters:');
				for (const p of op.parameters) {
					const req = p.required ? ' (required)' : '';
					lines.push(
						`  - ${p.name} [${p.in}]: ${p.schema?.type || 'string'}${req}${p.schema?.description ? ' - ' + p.schema.description : ''}`,
					);
				}
			}

			if (op.requestBody) {
				lines.push('\nRequest body:');
				const content = op.requestBody.content?.['application/json'];
				if (content?.schema) {
					lines.push(`  ${JSON.stringify(content.schema, null, 2).replace(/\n/g, '\n  ')}`);
				}
			}

			lines.push('\nResponses:');
			for (const [code, resp] of Object.entries(op.responses as Record<string, any>)) {
				lines.push(`  ${code}: ${resp.description}`);
				const content = resp.content?.['application/json'];
				if (content?.schema) {
					lines.push(`    ${JSON.stringify(content.schema, null, 2).replace(/\n/g, '\n    ')}`);
				}
			}

			lines.push('');
			lines.push('---');
			lines.push('');
		}
	}

	return lines.join('\n');
}

export const GET: RequestHandler = async () => {
	const spec = buildSpec();
	return new Response(specToText(spec), {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
};
