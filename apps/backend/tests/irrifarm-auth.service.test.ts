import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IrrifarmAuthError, IrrifarmAuthService } from '../src/services/irrifarm-auth.service';

const mocks = {
	checkUser: vi.fn(),
	getMotherBoardsByClient: vi.fn(),
};

beforeEach(() => {
	mocks.checkUser.mockReset();
	mocks.getMotherBoardsByClient
		.mockReset()
		.mockResolvedValue([{ mboSn: ' SN002 ' }, { mboSn: 'SN001' }, { mboSn: 'SN001' }, { mboSn: null }]);
});

describe('IrrifarmAuthService', () => {
	it('uses the server-side Vincenzo fixture and validates the token remotely by fetching MBOs', async () => {
		const service = new IrrifarmAuthService(mocks, {
			mode: 'fixture',
			fixture: { username: 'vincenzo', userId: 605, clientId: 1, clientLevel: 1 },
		});
		const token = createJwt({ sub: 'vincenzo' });

		await expect(service.resolve({ token, username: 'vincenzo' })).resolves.toEqual({
			username: 'vincenzo',
			userId: 605,
			clientId: 1,
			clientLevel: 1,
			userRole: null,
			regId: null,
			mboSns: ['SN001', 'SN002'],
		});
		expect(mocks.checkUser).not.toHaveBeenCalled();
		expect(mocks.getMotherBoardsByClient).toHaveBeenCalledWith({
			token,
			clientId: 1,
			userId: 605,
			clientLevel: 1,
		});
	});

	it('rejects another subject in fixture mode', async () => {
		const service = new IrrifarmAuthService(mocks, {
			mode: 'fixture',
			fixture: { username: 'vincenzo', userId: 605, clientId: 1, clientLevel: 1 },
		});

		await expect(service.resolve({ token: createJwt({ sub: 'domenico' }), username: 'domenico' })).rejects.toThrow(
			'No Irrifarm fixture',
		);
		expect(mocks.getMotherBoardsByClient).not.toHaveBeenCalled();
	});

	it('resolves both configured fixtures with their own client scopes', async () => {
		const service = new IrrifarmAuthService(mocks, {
			mode: 'fixture',
			fixture: { username: 'domenico', userId: 470, clientId: 204, clientLevel: 20 },
			adminFixture: { username: 'vincenzo', userId: 605, clientId: 1, clientLevel: 1 },
		});

		await service.resolve({ token: createJwt({ sub: 'domenico' }), username: 'domenico' });
		expect(mocks.getMotherBoardsByClient).toHaveBeenLastCalledWith(
			expect.objectContaining({ userId: 470, clientId: 204, clientLevel: 20 }),
		);

		await service.resolve({ token: createJwt({ sub: 'vincenzo' }), username: 'vincenzo' });
		expect(mocks.getMotherBoardsByClient).toHaveBeenLastCalledWith(
			expect.objectContaining({ userId: 605, clientId: 1, clientLevel: 1 }),
		);
	});

	it('uses CheckUser values in check-user mode', async () => {
		const regId = '31da332d-9790-4f15-9765-ea9d05cd7b69';
		mocks.checkUser.mockResolvedValue({
			active: true,
			userRole: 'Casa Madre',
			userClientId: 1,
			userClientLevel: 1,
			userId: 605,
			regId,
		});
		const service = new IrrifarmAuthService(mocks, { mode: 'check-user' });
		const token = createJwt({ sub: 'vincenzo' });

		const result = await service.resolve({ token, username: 'vincenzo', regId });

		expect(result).toEqual(
			expect.objectContaining({
				userId: 605,
				clientId: 1,
				clientLevel: 1,
				userRole: 'Casa Madre',
				regId,
			}),
		);
		expect(mocks.checkUser).toHaveBeenCalledWith({ token, username: 'vincenzo', regId });
	});

	it('requires RegId in check-user mode', async () => {
		const service = new IrrifarmAuthService(mocks, { mode: 'check-user' });

		await expect(service.resolve({ token: createJwt({ sub: 'vincenzo' }), username: 'vincenzo' })).rejects.toThrow(
			'RegId is required',
		);
	});

	it('rejects inactive CheckUser responses', async () => {
		const regId = '31da332d-9790-4f15-9765-ea9d05cd7b69';
		mocks.checkUser.mockResolvedValue({
			active: false,
			userRole: null,
			userClientId: 0,
			userClientLevel: 0,
			userId: 0,
			regId,
		});
		const service = new IrrifarmAuthService(mocks, { mode: 'check-user' });

		await expect(
			service.resolve({ token: createJwt({ sub: 'vincenzo' }), username: 'vincenzo', regId }),
		).rejects.toThrow('rejected');
	});

	it('rejects expired tokens before contacting Irrifarm', async () => {
		const service = new IrrifarmAuthService(mocks, {
			mode: 'fixture',
			fixture: { username: 'vincenzo', userId: 605, clientId: 1, clientLevel: 1 },
		});

		await expect(
			service.resolve({ token: createJwt({ sub: 'vincenzo', exp: 1 }), username: 'vincenzo' }),
		).rejects.toBeInstanceOf(IrrifarmAuthError);
		expect(mocks.getMotherBoardsByClient).not.toHaveBeenCalled();
	});
});

function createJwt(overrides: { sub: string; exp?: number }): string {
	const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
	return [
		encode({ alg: 'HS256', typ: 'JWT' }),
		encode({
			iss: 'com.panagri.irrifarm',
			aud: 'com.panagri.irrifarm',
			exp: overrides.exp ?? Math.floor(Date.now() / 1000) + 3600,
			sub: overrides.sub,
		}),
		'signature',
	].join('.');
}
