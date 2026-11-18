import { afterEach, describe, expect, it, vi } from 'vitest';

import { __reloadEnvForTesting } from '../../src/env';
import { checkForUpdate } from '../../src/services/version-check.service';

describe('version-check.service', () => {
	const originalEnv = { ...process.env };

	afterEach(() => {
		process.env = { ...originalEnv };
		__reloadEnvForTesting();
		vi.unstubAllGlobals();
	});

	it('skips the external release request by default', async () => {
		process.env.APP_VERSION = '1.2.3';
		delete process.env.UPDATE_CHECK_DISABLED;
		__reloadEnvForTesting();
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(checkForUpdate()).resolves.toEqual({
			currentVersion: '1.2.3',
			latestVersion: null,
			updateAvailable: false,
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
