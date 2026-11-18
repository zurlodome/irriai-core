import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { contextAssetRoutes } from '../../src/routes/context-assets';
import { HandlerError } from '../../src/utils/error';
import { createToolContext } from '../helpers/tool-context';

const mocks = vi.hoisted(() => ({ getAsset: vi.fn(), role: vi.fn(), context: vi.fn() }));
vi.mock('../../src/queries/context-asset.queries', () => ({ getContextAssetById: mocks.getAsset }));
vi.mock('../../src/queries/project.queries', () => ({ getUserRoleInProject: mocks.role }));
vi.mock('../../src/services/agent', () => ({ buildMcpToolContext: mocks.context }));
vi.mock('../../src/middleware/auth', () => ({
	authMiddleware: async (request: FastifyRequest, reply: FastifyReply) => {
		if (!request.headers['x-test-user']) {
			return reply.status(401).send({ error: 'Unauthorized' });
		}
		request.user = {
			id: 'viewer',
			name: 'Viewer',
			email: 'viewer@example.test',
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
	},
}));

const id = '00000000-0000-4000-8000-000000000001';
let app: FastifyInstance;

beforeEach(async () => {
	vi.clearAllMocks();
	mocks.getAsset.mockResolvedValue({
		projectId: 'farm',
		virtualPath: '/docs/private/image.png',
		mediaType: 'image/png',
		data: Buffer.from('image').toString('base64'),
	});
	mocks.role.mockResolvedValue('user');
	mocks.context.mockResolvedValue(createToolContext());
	app = Fastify();
	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);
	app.setErrorHandler((error, _request, reply) =>
		reply
			.status(error instanceof HandlerError ? error.code : 500)
			.send({ error: error instanceof Error ? error.message : 'Forbidden' }),
	);
	await app.register(contextAssetRoutes, { prefix: '/context-assets' });
	await app.ready();
});

afterEach(async () => {
	await app.close();
});

describe('stored context asset access', () => {
	it('requires authentication before resolving the asset', async () => {
		const response = await app.inject({ method: 'GET', url: `/context-assets/${id}` });
		expect(response.statusCode).toBe(401);
		expect(mocks.getAsset).not.toHaveBeenCalled();
	});

	it('denies users outside the asset project even if they know its UUID', async () => {
		mocks.role.mockResolvedValue(null);
		const response = await app.inject({
			method: 'GET',
			url: `/context-assets/${id}`,
			headers: { 'x-test-user': 'viewer' },
		});
		expect(response.statusCode).toBe(403);
		expect(mocks.context).not.toHaveBeenCalled();
	});

	it('checks current document permissions before returning previously stored bytes', async () => {
		mocks.context.mockResolvedValue(
			createToolContext({ docsContextAccess: { enforced: true, access: { mode: 'restricted', grants: [] } } }),
		);
		const response = await app.inject({
			method: 'GET',
			url: `/context-assets/${id}`,
			headers: { 'x-test-user': 'viewer' },
		});
		expect(response.statusCode, response.body).toBe(403);
		expect(response.body).not.toBe('image');
	});

	it('serves authorized assets without a public or reusable browser cache', async () => {
		const response = await app.inject({
			method: 'GET',
			url: `/context-assets/${id}`,
			headers: { 'x-test-user': 'viewer' },
		});
		expect(response.statusCode).toBe(200);
		expect(response.body).toBe('image');
		expect(response.headers['cache-control']).toBe('private, no-store');
		expect(mocks.role).toHaveBeenCalledWith('farm', 'viewer');
		expect(mocks.context).toHaveBeenCalledWith({ projectId: 'farm', userId: 'viewer' });
	});
});
