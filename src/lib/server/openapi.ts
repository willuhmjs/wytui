interface ParamSchema {
	type: string;
	description?: string;
	enum?: string[];
	minimum?: number;
	maximum?: number;
	default?: number | string | boolean;
	format?: string;
	nullable?: boolean;
	// Nested schemas for array element types and object shapes.
	items?: ParamSchema;
	properties?: Record<string, ParamSchema>;
}

interface BodySchema {
	[field: string]: ParamSchema & { required?: boolean };
}

interface ResponseSchema {
	type: string;
	properties?: Record<string, ParamSchema & { properties?: Record<string, ParamSchema> }>;
	items?: { type: string; properties?: Record<string, ParamSchema> };
}

interface ResponseDef {
	description: string;
	schema?: ResponseSchema;
}

interface RouteConfig {
	summary: string;
	description?: string;
	tags: string[];
	auth?: boolean | 'admin' | 'optional' | false;
	params?: Record<string, ParamSchema>;
	query?: Record<string, ParamSchema>;
	body?: BodySchema;
	responses?: Record<number, ResponseDef>;
}

interface RouteEntry {
	path: string;
	method: string;
	config: RouteConfig;
}

const registry: RouteEntry[] = [];

export function apiRoute<T extends (...args: any[]) => any>(
	path: string,
	method: string,
	config: RouteConfig,
	handler: T,
): T {
	registry.push({ path, method: method.toLowerCase(), config });
	return handler;
}

const API_DESCRIPTION = `## Authentication

All authenticated endpoints accept either method:

1. **API Key** (recommended for programmatic access): Include an \`Authorization: Bearer <key>\` header. Create keys via \`POST /api/keys\`.
2. **Session Cookie**: Log in through the web UI; the \`wytui.session-token\` cookie is set automatically.

## Typical Workflow

1. **Create an API key**: \`POST /api/keys\` with a name
2. **List profiles**: \`GET /api/profiles\` to find available download quality presets
3. **Create a download**: \`POST /api/downloads\` with a URL and profile ID
4. **Monitor progress**: \`GET /api/downloads/{id}\` — watch the \`status\` field progress through PENDING → FETCHING_INFO → DOWNLOADING → PROCESSING → COMPLETED
5. **Download the file**: \`GET /api/files/{id}\` returns the binary file

## Key Concepts

- **Profiles**: Quality presets (e.g., "Best Video", "Audio Only MP3"). System profiles are shared; users can create custom ones.
- **Downloads**: Individual download jobs tracked through a status lifecycle.
- **Subscriptions**: Auto-monitor a YouTube channel/playlist for new uploads and download them.
- **Monitors**: Watch for livestreams (YouTube Live, Twitch) and record them automatically.
- **Library vs Cache**: Downloads land in cache by default. Promote to library for permanent organized storage. Cache can be cleared; library cannot.
`;

export function buildSpec() {
	const paths: Record<string, Record<string, unknown>> = {};

	for (const { path, method, config } of registry) {
		const oaPath = path.replace(/\[(\w+)\]/g, '{$1}');

		if (!paths[oaPath]) paths[oaPath] = {};

		const parameters: unknown[] = [];

		if (config.params) {
			for (const [name, schema] of Object.entries(config.params)) {
				parameters.push({
					name,
					in: 'path',
					required: true,
					schema: { type: schema.type, description: schema.description },
				});
			}
		}

		if (config.query) {
			for (const [name, schema] of Object.entries(config.query)) {
				parameters.push({
					name,
					in: 'query',
					required: false,
					schema: {
						type: schema.type,
						...(schema.enum && { enum: schema.enum }),
						...(schema.minimum !== undefined && { minimum: schema.minimum }),
						...(schema.maximum !== undefined && { maximum: schema.maximum }),
						...(schema.default !== undefined && { default: schema.default }),
						...(schema.description && { description: schema.description }),
					},
				});
			}
		}

		let requestBody: unknown = undefined;
		if (config.body) {
			const required: string[] = [];
			const properties: Record<string, unknown> = {};
			for (const [name, field] of Object.entries(config.body)) {
				const { required: isReq, ...schema } = field;
				properties[name] = schema;
				if (isReq) required.push(name);
			}
			requestBody = {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties,
							...(required.length > 0 && { required }),
						},
					},
				},
			};
		}

		const responses: Record<string, unknown> = {};
		if (config.responses) {
			for (const [code, resp] of Object.entries(config.responses)) {
				const entry: Record<string, unknown> = { description: resp.description };
				if (resp.schema) {
					entry.content = {
						'application/json': { schema: resp.schema },
					};
				} else {
					entry.content = {
						'application/json': { schema: { type: 'object' } },
					};
				}
				responses[String(code)] = entry;
			}
		} else {
			responses['200'] = {
				description: 'Success',
				content: { 'application/json': { schema: { type: 'object' } } },
			};
		}

		if (config.auth === true || config.auth === 'admin') {
			responses['401'] = { description: 'Authentication required' };
		}
		if (config.auth === 'admin') {
			responses['403'] = { description: 'Admin access required' };
		}

		const security: unknown[] = [];
		if (config.auth === true || config.auth === 'admin') {
			security.push({ bearerAuth: [] });
			security.push({ cookieAuth: [] });
		}

		const operation: Record<string, unknown> = {
			summary: config.summary,
			tags: config.tags,
			responses,
		};
		if (config.description) operation.description = config.description;
		if (parameters.length > 0) operation.parameters = parameters;
		if (requestBody) operation.requestBody = requestBody;
		if (security.length > 0) operation.security = security;

		paths[oaPath][method] = operation;
	}

	return {
		openapi: '3.0.3',
		info: {
			title: 'wytui API',
			version: '1.0.0',
			description: API_DESCRIPTION,
		},
		servers: [{ url: '/', description: 'Current server' }],
		paths,
		components: {
			securitySchemes: {
				bearerAuth: {
					type: 'http',
					scheme: 'bearer',
					description: 'API key from POST /api/keys',
				},
				cookieAuth: {
					type: 'apiKey',
					in: 'cookie',
					name: 'wytui.session-token',
				},
			},
		},
		tags: [
			{ name: 'Auth', description: 'API key management' },
			{ name: 'Downloads', description: 'Download management' },
			{ name: 'Profiles', description: 'Download profiles' },
			{ name: 'Subscriptions', description: 'Channel/playlist subscriptions' },
			{ name: 'Monitors', description: 'Livestream monitoring' },
			{ name: 'Watch Progress', description: 'Video watch progress tracking' },
			{ name: 'Playlists', description: 'Custom playlist management' },
			{ name: 'Settings', description: 'Application settings' },
			{ name: 'Users', description: 'User management (admin)' },
			{ name: 'Library', description: 'Storage and library management' },
			{ name: 'YouTube', description: 'YouTube search' },
			{ name: 'Channel Overrides', description: 'Per-channel download configuration overrides' },
			{ name: 'System', description: 'System health and setup' },
		],
	};
}
