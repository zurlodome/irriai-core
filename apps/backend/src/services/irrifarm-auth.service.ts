import { decodeJwt } from 'jose';

import { env } from '../env';
import type { IrrifarmApiClient, IrrifarmCheckUser, IrrifarmMotherBoard } from './irrifarm-api.client';

const IRRIFARM_ISSUER = 'com.panagri.irrifarm';
const IRRIFARM_AUDIENCE = 'com.panagri.irrifarm';

type AuthMode = 'fixture' | 'check-user';

export interface IrrifarmResolvedIdentity {
	username: string;
	userId: number;
	clientId: number;
	clientLevel: number;
	userRole: string | null;
	regId: string | null;
	mboSns: string[];
}

export interface IrrifarmAuthConfig {
	mode: AuthMode;
	fixture?: {
		username: string;
		userId: number;
		clientId: number;
		clientLevel: number;
	};
	adminFixture?: {
		username: string;
		userId: number;
		clientId: number;
		clientLevel: number;
	};
}

type ApiClient = Pick<IrrifarmApiClient, 'checkUser' | 'getMotherBoardsByClient'>;

export class IrrifarmAuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'IrrifarmAuthError';
	}
}

export class IrrifarmAuthService {
	constructor(
		private readonly client: ApiClient,
		private readonly config: IrrifarmAuthConfig,
	) {}

	async resolve(input: { token: string; username: string; regId?: string }): Promise<IrrifarmResolvedIdentity> {
		const subject = validateTokenClaims(input.token);
		const username = input.username.trim();
		if (!username || subject.toLowerCase() !== username.toLowerCase()) {
			throw new IrrifarmAuthError('The Irrifarm token subject does not match the requested username.');
		}

		const identity =
			this.config.mode === 'fixture'
				? this.resolveFixture(username)
				: await this.resolveWithCheckUser(input.token, username, input.regId);

		const motherBoards = await this.client.getMotherBoardsByClient({
			token: input.token,
			clientId: identity.clientId,
			userId: identity.userId,
			clientLevel: identity.clientLevel,
		});

		return { ...identity, mboSns: normalizeMboSns(motherBoards) };
	}

	private resolveFixture(username: string): Omit<IrrifarmResolvedIdentity, 'mboSns'> {
		const fixture = [this.config.fixture, this.config.adminFixture].find(
			(candidate) => candidate?.username.toLowerCase() === username.toLowerCase(),
		);
		if (!fixture) {
			throw new IrrifarmAuthError('No Irrifarm fixture is configured for this user.');
		}
		return {
			username,
			userId: fixture.userId,
			clientId: fixture.clientId,
			clientLevel: fixture.clientLevel,
			userRole: null,
			regId: null,
		};
	}

	private async resolveWithCheckUser(
		token: string,
		username: string,
		regId: string | undefined,
	): Promise<Omit<IrrifarmResolvedIdentity, 'mboSns'>> {
		if (!regId) {
			throw new IrrifarmAuthError('RegId is required when Irrifarm CheckUser validation is enabled.');
		}

		const checked = await this.client.checkUser({ token, username, regId });
		assertActiveCheckUser(checked, regId);
		return {
			username,
			userId: checked.userId,
			clientId: checked.userClientId,
			clientLevel: checked.userClientLevel,
			userRole: checked.userRole ?? null,
			regId: checked.regId,
		};
	}
}

export function createIrrifarmAuthConfigFromEnv(): IrrifarmAuthConfig | null {
	if (env.IRRIFARM_AUTH_MODE === 'disabled') {
		return null;
	}
	if (!env.IRRIFARM_BASE_URL) {
		throw new Error('IRRIFARM_BASE_URL is required when Irrifarm authentication is enabled.');
	}
	if (env.IRRIFARM_AUTH_MODE === 'check-user') {
		return { mode: 'check-user' };
	}

	if (
		!env.IRRIFARM_FIXTURE_USERNAME ||
		!env.IRRIFARM_FIXTURE_USER_ID ||
		!env.IRRIFARM_FIXTURE_CLIENT_ID ||
		!env.IRRIFARM_FIXTURE_CLIENT_LEVEL
	) {
		throw new Error('All IRRIFARM_FIXTURE_* values are required in fixture mode.');
	}
	const adminValues = [
		env.IRRIFARM_FIXTURE_ADMIN_USERNAME,
		env.IRRIFARM_FIXTURE_ADMIN_USER_ID,
		env.IRRIFARM_FIXTURE_ADMIN_CLIENT_ID,
		env.IRRIFARM_FIXTURE_ADMIN_CLIENT_LEVEL,
	];
	if (adminValues.some(Boolean) && !adminValues.every(Boolean)) {
		throw new Error('All IRRIFARM_FIXTURE_ADMIN_* values are required when the admin fixture is configured.');
	}
	if (env.IRRIFARM_FIXTURE_ADMIN_USERNAME?.toLowerCase() === env.IRRIFARM_FIXTURE_USERNAME.toLowerCase()) {
		throw new Error('Irrifarm fixture usernames must be distinct.');
	}
	return {
		mode: 'fixture',
		fixture: {
			username: env.IRRIFARM_FIXTURE_USERNAME,
			userId: env.IRRIFARM_FIXTURE_USER_ID,
			clientId: env.IRRIFARM_FIXTURE_CLIENT_ID,
			clientLevel: env.IRRIFARM_FIXTURE_CLIENT_LEVEL,
		},
		adminFixture: env.IRRIFARM_FIXTURE_ADMIN_USERNAME
			? {
					username: env.IRRIFARM_FIXTURE_ADMIN_USERNAME,
					userId: env.IRRIFARM_FIXTURE_ADMIN_USER_ID!,
					clientId: env.IRRIFARM_FIXTURE_ADMIN_CLIENT_ID!,
					clientLevel: env.IRRIFARM_FIXTURE_ADMIN_CLIENT_LEVEL!,
				}
			: undefined,
	};
}

function validateTokenClaims(token: string): string {
	let payload: ReturnType<typeof decodeJwt>;
	try {
		payload = decodeJwt(token);
	} catch {
		throw new IrrifarmAuthError('Invalid Irrifarm JWT format.');
	}

	const now = Math.floor(Date.now() / 1000);
	const audiences = typeof payload.aud === 'string' ? [payload.aud] : payload.aud;
	if (payload.iss !== IRRIFARM_ISSUER || !audiences?.includes(IRRIFARM_AUDIENCE)) {
		throw new IrrifarmAuthError('Invalid Irrifarm JWT issuer or audience.');
	}
	if (typeof payload.exp !== 'number' || payload.exp <= now) {
		throw new IrrifarmAuthError('The Irrifarm JWT is expired.');
	}
	if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
		throw new IrrifarmAuthError('The Irrifarm JWT has no subject.');
	}
	return payload.sub;
}

function assertActiveCheckUser(checked: IrrifarmCheckUser, requestedRegId: string): void {
	if (!checked.active) {
		throw new IrrifarmAuthError('Irrifarm CheckUser rejected the user or device.');
	}
	if (checked.regId.toLowerCase() !== requestedRegId.toLowerCase()) {
		throw new IrrifarmAuthError('Irrifarm CheckUser returned a different RegId.');
	}
	if (checked.userId <= 0 || checked.userClientId <= 0 || checked.userClientLevel <= 0) {
		throw new IrrifarmAuthError('Irrifarm CheckUser returned an invalid identity.');
	}
}

function normalizeMboSns(motherBoards: IrrifarmMotherBoard[]): string[] {
	const values = motherBoards
		.map((motherBoard) => motherBoard.mboSn?.trim())
		.filter((serial): serial is string => !!serial && serial.length <= 128);
	return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
