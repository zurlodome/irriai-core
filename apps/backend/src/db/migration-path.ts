import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface MigrationRuntime {
	moduleUrl: string;
	executablePath: string;
	compiled: boolean;
}

export function resolveMigrationsPath(migrationsPath: string, runtime: MigrationRuntime): string {
	if (path.isAbsolute(migrationsPath)) {
		return migrationsPath;
	}
	if (runtime.compiled) {
		return path.resolve(path.dirname(runtime.executablePath), migrationsPath);
	}
	const moduleDirectory = path.dirname(fileURLToPath(runtime.moduleUrl));
	const isSource = path.basename(moduleDirectory) === 'db' && path.basename(path.dirname(moduleDirectory)) === 'src';
	return path.resolve(moduleDirectory, isSource ? '../..' : '..', migrationsPath);
}
