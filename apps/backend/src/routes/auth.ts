import type { IncomingHttpHeaders } from 'node:http';

import type { App } from '../app';
import { getAuth } from '../auth';
import { normalizeAuthRequestPayload } from '../utils/auth-request';
import { convertHeaders } from '../utils/utils';

interface DispatchAuthRequestInput {
	method: string;
	url: string;
	headers: IncomingHttpHeaders;
	body: unknown;
}

export async function dispatchAuthRequest(input: DispatchAuthRequestInput): Promise<Response> {
	const url = new URL(input.url, `http://${input.headers.host}`);
	const headers = convertHeaders(input.headers);
	headers.delete('content-length');
	headers.delete('transfer-encoding');
	const payload = normalizeAuthRequestPayload({
		method: input.method,
		url: input.url,
		contentType: input.headers['content-type'],
		body: input.body,
	});
	if (payload.contentType) {
		headers.set('content-type', payload.contentType);
	}
	const request = new Request(url.toString(), {
		method: input.method,
		headers,
		body: payload.body,
	});
	const auth = await getAuth();
	return auth.handler(request);
}

export const authRoutes = async (app: App) => {
	app.route({
		method: ['GET', 'POST'],
		url: '/auth/*',
		async handler(request, reply) {
			try {
				const response = await dispatchAuthRequest({
					method: request.method,
					url: request.url,
					headers: request.headers,
					body: request.body,
				});
				// Forward response to client
				reply.status(response.status);
				response.headers.forEach((value, key) => reply.header(key, value));
				reply.send(response.body ? await response.text() : null);
			} catch (error) {
				app.log.error(error, 'Authentication Error');
				reply.status(500).send({
					error: 'Internal authentication error',
					code: 'AUTH_FAILURE',
				});
			}
		},
	});
};
