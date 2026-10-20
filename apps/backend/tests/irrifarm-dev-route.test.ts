import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	irrifarmTestPageRoutes,
	renderIrrifarmSsoTestPage,
	shouldRegisterIrrifarmTestPage,
} from '../src/routes/irrifarm-dev';

describe('Irrifarm development test page', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		app = Fastify();
		await app.register(irrifarmTestPageRoutes, { prefix: '/api/auth/irrifarm' });
		await app.ready();
	});

	afterEach(async () => {
		await app.close();
	});

	it('serves a non-cacheable form with separate Domenico and Vincenzo sign-in buttons', async () => {
		const response = await app.inject({ method: 'GET', url: '/api/auth/irrifarm/test' });

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

	it('rejects unrecognized demo accounts', async () => {
		const response = await app.inject({
			method: 'POST',
			url: '/api/auth/irrifarm/test',
			payload: { account: 'unknown' },
		});

		expect(response.statusCode).toBe(400);
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
