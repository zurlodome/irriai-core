import { describe, expect, it } from 'vitest';

import { normalizeAuthRequestPayload } from '../../src/utils/auth-request';

describe('Irrifarm auth route form adapter', () => {
	it('converts the Irrifarm HTML form into the JSON expected by Better Auth', () => {
		const result = normalizeAuthRequestPayload({
			method: 'POST',
			url: '/api/auth/sign-in/irrifarm',
			contentType: 'application/x-www-form-urlencoded',
			body: { token: 'header.payload.signature', username: 'domenico' },
		});

		expect(result).toEqual({
			contentType: 'application/json',
			body: JSON.stringify({ token: 'header.payload.signature', username: 'domenico' }),
		});
	});

	it('does not change other Better Auth form requests', () => {
		const result = normalizeAuthRequestPayload({
			method: 'POST',
			url: '/api/auth/sign-in/email',
			contentType: 'application/x-www-form-urlencoded',
			body: { email: 'person@example.com', password: 'secret' },
		});

		expect(result).toEqual({
			contentType: 'application/x-www-form-urlencoded',
			body: 'email=person%40example.com&password=secret',
		});
	});
});
