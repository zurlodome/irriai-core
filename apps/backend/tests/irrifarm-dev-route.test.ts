import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../src/env';
import {
	irrifarmTestPageRoutes,
	renderIrrifarmSsoTestPage,
	shouldRegisterIrrifarmTestPage,
} from '../src/routes/irrifarm-dev';

describe('Irrifarm development test page', () => {
	let app: FastifyInstance;
	const originalPassword = env.IRRIFARM_TEST_PAGE_PASSWORD;
	const originalBaseUrl = env.IRRIFARM_BASE_URL;
	const originalAdminUsername = env.IRRIFARM_FIXTURE_ADMIN_USERNAME;
	const originalAdminPassword = env.IRRIFARM_TEST_ADMIN_PASSWORD;
	const authorization = `Basic ${Buffer.from('test:page-secret').toString('base64')}`;

	beforeEach(async () => {
		env.IRRIFARM_TEST_PAGE_PASSWORD = 'page-secret';
		app = Fastify();
		await app.register(irrifarmTestPageRoutes, { prefix: '/api/auth/irrifarm' });
		await app.ready();
	});

	afterEach(async () => {
		await app.close();
		env.IRRIFARM_TEST_PAGE_PASSWORD = originalPassword;
		env.IRRIFARM_BASE_URL = originalBaseUrl;
		env.IRRIFARM_FIXTURE_ADMIN_USERNAME = originalAdminUsername;
		env.IRRIFARM_TEST_ADMIN_PASSWORD = originalAdminPassword;
		vi.restoreAllMocks();
	});

	it('serves a non-cacheable form with separate Domenico and Vincenzo sign-in buttons', async () => {
		const response = await app.inject({
			method: 'GET',
			url: '/api/auth/irrifarm/test',
			headers: { authorization },
		});

		expect(response.statusCode).toBe(200);
		expect(response.headers['cache-control']).toBe('no-store');
		expect(response.headers['content-security-policy']).toContain("form-action 'self'");
		expect(response.body).toContain('action="/api/auth/irrifarm/test"');
		expect(response.body).toContain('name="referrer" content="strict-origin"');
		expect(response.body).toContain('name="account" value="domenico"');
		expect(response.body).toContain('name="account" value="vincenzo"');
		expect(response.body).toContain('Accedi come Domenico (singolo MBO)');
		expect(response.body).toContain('Accedi come Vincenzo (tutti i controller)');
		expect(response.body).not.toContain('name="token"');
		expect(response.body).not.toContain('name="username"');
		expect(response.body).not.toContain('name="password"');
	});

	it('challenges both GET and POST without valid page credentials', async () => {
		for (const method of ['GET', 'POST'] as const) {
			for (const header of [undefined, `Basic ${Buffer.from('test:wrong').toString('base64')}`]) {
				const response = await app.inject({
					method,
					url: '/api/auth/irrifarm/test',
					headers: header ? { authorization: header } : {},
					payload: method === 'POST' ? { account: 'unknown' } : undefined,
				});
				expect(response.statusCode).toBe(401);
				expect(response.headers['www-authenticate']).toContain('Basic realm="Irrifarm test"');
				expect(response.headers['cache-control']).toBe('no-store');
			}
		}
	});

	it('fails closed when the page password is not configured', async () => {
		env.IRRIFARM_TEST_PAGE_PASSWORD = undefined;
		const response = await app.inject({
			method: 'GET',
			url: '/api/auth/irrifarm/test',
			headers: { authorization },
		});
		expect(response.statusCode).toBe(503);
	});

	it('rejects unrecognized demo accounts', async () => {
		const response = await app.inject({
			method: 'POST',
			url: '/api/auth/irrifarm/test',
			headers: { authorization },
			payload: { account: 'unknown' },
		});

		expect(response.statusCode).toBe(400);
	});

	it('identifies an Irrifarm token rejection without exposing the upstream body or password', async () => {
		env.IRRIFARM_BASE_URL = 'https://irrifarm.example';
		env.IRRIFARM_FIXTURE_ADMIN_USERNAME = 'vincenzo';
		env.IRRIFARM_TEST_ADMIN_PASSWORD = 'private-admin-password';
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('private upstream details', { status: 401 }));

		const response = await app.inject({
			method: 'POST',
			url: '/api/auth/irrifarm/test',
			headers: { authorization },
			payload: { account: 'vincenzo' },
		});

		expect(response.statusCode).toBe(502);
		expect(response.body).toContain('HTTP 401');
		expect(response.body).toContain('vincenzo');
		expect(response.body).not.toContain('private upstream details');
		expect(response.body).not.toContain('private-admin-password');
	});

	it('escapes values rendered from configuration', () => {
		const page = renderIrrifarmSsoTestPage('fixture<script>');

		expect(page).not.toContain('fixture<script>');
		expect(page).toContain('fixture&lt;script&gt;');
	});

	it('requires explicit enablement in every environment', () => {
		expect(shouldRegisterIrrifarmTestPage('dev', false)).toBe(false);
		expect(shouldRegisterIrrifarmTestPage('test', false)).toBe(false);
		expect(shouldRegisterIrrifarmTestPage('prod', false)).toBe(false);
		expect(shouldRegisterIrrifarmTestPage('prod', true)).toBe(true);
	});
});
