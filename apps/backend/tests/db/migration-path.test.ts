import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { resolveMigrationsPath } from '../../src/db/migration-path';

const packageRoot = path.resolve(path.sep, 'build-validation', 'backend');
const layouts = [
	{ name: 'source', modulePath: 'src/db/migrate.ts', compiled: false },
	{ name: 'bundle', modulePath: 'dist/index.js', compiled: false },
	{ name: 'standalone', modulePath: 'virtual/bundled.js', compiled: true },
];

describe.each(layouts)('migration paths from $name', ({ modulePath, compiled }) => {
	const runtime = {
		moduleUrl: pathToFileURL(path.join(packageRoot, modulePath)).href,
		executablePath: path.join(compiled ? packageRoot : path.resolve(path.sep, 'runtime'), 'nao-chat-server'),
		compiled,
	};

	it.each(['sqlite', 'postgres'])('resolves the %s journal from the package, independently of cwd', (dialect) => {
		const directory = `migrations-${dialect}`;
		expect(resolveMigrationsPath(`./${directory}`, runtime)).toBe(path.join(packageRoot, directory));
	});

	it('preserves an explicitly supplied absolute directory', () => {
		const directory = path.resolve(path.sep, 'custom-migrations');
		expect(resolveMigrationsPath(directory, runtime)).toBe(directory);
	});
});
