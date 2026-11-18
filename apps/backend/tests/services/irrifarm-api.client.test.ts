import { describe, expect, it, vi } from 'vitest';

import { IrrifarmApiClient, IrrifarmApiError } from '../../src/services/irrifarm-api.client';

const JWT = 'header.payload.signature';

describe('IrrifarmApiClient', () => {
	it('creates an app token using multipart form data', async () => {
		const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(JWT), { status: 200 }));
		const client = new IrrifarmApiClient({ baseUrl: 'https://irrifarm.example/', fetch });

		await expect(client.createAppToken('vincenzo', 'secret')).resolves.toBe(JWT);
		expect(fetch).toHaveBeenCalledOnce();
		const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://irrifarm.example/api/Token/apptokenreg');
		expect(init.method).toBe('POST');
		expect((init.body as FormData).get('username')).toBe('vincenzo');
		expect((init.body as FormData).get('password')).toBe('secret');
	});

	it('calls CheckUser with bearer authentication', async () => {
		const payload = {
			active: true,
			userRole: 'Casa Madre',
			userClientId: 1,
			userClientLevel: 1,
			userId: 605,
			regId: '31da332d-9790-4f15-9765-ea9d05cd7b69',
		};
		const fetch = vi.fn().mockResolvedValue(Response.json(payload));
		const client = new IrrifarmApiClient({ baseUrl: 'https://irrifarm.example', fetch });

		await expect(client.checkUser({ token: JWT, username: 'vincenzo', regId: payload.regId })).resolves.toEqual(
			payload,
		);
		const [, init] = fetch.mock.calls[0] as [string, RequestInit];
		expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${JWT}`);
		expect((init.body as FormData).get('RegId')).toBe(payload.regId);
	});

	it('returns typed motherboards and preserves null serials', async () => {
		const payload = [
			{ mboSn: 'SN001', mboAlias: 'North field', cityId: 1, stato: 1 },
			{ mboSn: null, mboAlias: null, cityId: 0, stato: 0 },
		];
		const fetch = vi.fn().mockResolvedValue(Response.json(payload));
		const client = new IrrifarmApiClient({ baseUrl: 'https://irrifarm.example', fetch });

		await expect(
			client.getMotherBoardsByClient({ token: JWT, clientId: 1, userId: 605, clientLevel: 1 }),
		).resolves.toEqual(payload);
		const [, init] = fetch.mock.calls[0] as [string, RequestInit];
		const body = init.body as FormData;
		expect(body.get('Client_Id')).toBe('1');
		expect(body.get('USR_Id')).toBe('605');
		expect(body.get('IdClientLevel')).toBe('1');
	});

	it('does not include the remote response body in HTTP errors', async () => {
		const fetch = vi.fn().mockResolvedValue(new Response('sensitive details', { status: 401 }));
		const client = new IrrifarmApiClient({ baseUrl: 'https://irrifarm.example', fetch });

		await expect(
			client.getMotherBoardsByClient({ token: JWT, clientId: 1, userId: 605, clientLevel: 1 }),
		).rejects.toEqual(expect.objectContaining<IrrifarmApiError>({ status: 401 }));
	});

	it('rejects an unexpected CheckUser response', async () => {
		const fetch = vi.fn().mockResolvedValue(Response.json({ active: true }));
		const client = new IrrifarmApiClient({ baseUrl: 'https://irrifarm.example', fetch });

		await expect(
			client.checkUser({
				token: JWT,
				username: 'vincenzo',
				regId: '31da332d-9790-4f15-9765-ea9d05cd7b69',
			}),
		).rejects.toThrow('unexpected response');
	});
});
