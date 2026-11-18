/**
 * Rehearse the proposed migration reconciliation in temporary folders and an in-memory SQLite DB.
 * Does not edit migration sources or connect to configured application databases.
 * Run from apps/backend: bun scripts/db.verify-upstream-integration.ts
 */
import assert from 'assert/strict';
import { Database } from 'bun:sqlite';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import fs from 'fs';
import os from 'os';
import path from 'path';
import postgres from 'postgres';
import { fileURLToPath } from 'url';

import { checkMigrationIntegrity } from '../src/db/migration-integrity';

const UPSTREAM_SHA = '08f1a42b620889b87d2222a77c5f700adefa43b5';
const FORK_SHA = 'e15ecc06377dca2334268528f10817c844328265';
const backendDir = fileURLToPath(new URL('../', import.meta.url));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-upstream-migrations-'));
const forkRoot = path.join(tempDir, 'fork');
const forkBackendDir = path.join(forkRoot, 'apps/backend');

function extractForkHistory() {
	fs.mkdirSync(forkRoot);
	const archive = execFileSync(
		'git',
		['archive', FORK_SHA, 'apps/backend/migrations-sqlite', 'apps/backend/migrations-postgres'],
		{
			cwd: path.resolve(backendDir, '../..'),
			maxBuffer: 64 * 1024 * 1024,
		},
	);
	execFileSync('tar', ['-xf', '-', '-C', forkRoot], { input: archive });
}

interface Journal {
	entries: { idx: number; tag: string; when: number }[];
}

interface Snapshot {
	id: string;
	prevId: string;
	tables: Record<string, unknown>;
}

function upstreamFile(relative: string): string {
	return execFileSync('git', ['show', `${UPSTREAM_SHA}:apps/backend/${relative}`], {
		cwd: backendDir,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
	});
}

function prepareCandidate(dialect: string): string {
	const name = `migrations-${dialect}`;
	const folder = path.join(tempDir, name);
	fs.cpSync(path.join(forkBackendDir, name), folder, { recursive: true });
	const journal: Journal = JSON.parse(fs.readFileSync(path.join(folder, 'meta/_journal.json'), 'utf8'));
	const upstream: Journal = JSON.parse(upstreamFile(`${name}/meta/_journal.json`));
	assert.equal(journal.entries.length, 67, 'This rehearsal expects the published 67-migration fork history');
	const forkSnapshot: Snapshot = JSON.parse(fs.readFileSync(path.join(folder, 'meta/0066_snapshot.json'), 'utf8'));
	const localTables = Object.fromEntries(
		Object.entries(forkSnapshot.tables).filter(([table]) =>
			['context_asset', 'irrifarm_identity', 'public.context_asset', 'public.irrifarm_identity'].includes(table),
		),
	);
	assert.equal(Object.keys(localTables).length, 2);
	let previousId = forkSnapshot.id;

	// Keep published fork history intact; append upstream 0065..0104 as 0067..0106.
	for (const entry of upstream.entries.filter((entry) => entry.idx >= 65)) {
		const idx = entry.idx + 2;
		const prefix = String(idx).padStart(4, '0');
		const tag = `${prefix}_${entry.tag.slice(entry.tag.indexOf('_') + 1)}`;
		fs.writeFileSync(path.join(folder, `${tag}.sql`), upstreamFile(`${name}/${entry.tag}.sql`));
		journal.entries.push({ ...entry, idx, tag });
		const snapshot: Snapshot = JSON.parse(
			upstreamFile(`${name}/meta/${String(entry.idx).padStart(4, '0')}_snapshot.json`),
		);
		const hex = createHash('sha256').update(`${forkSnapshot.id}:${snapshot.id}`).digest('hex');
		snapshot.id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
		snapshot.prevId = previousId;
		snapshot.tables = { ...snapshot.tables, ...localTables };
		previousId = snapshot.id;
		fs.writeFileSync(path.join(folder, 'meta', `${prefix}_snapshot.json`), JSON.stringify(snapshot));
	}
	fs.writeFileSync(path.join(folder, 'meta/_journal.json'), JSON.stringify(journal));
	assert.deepEqual(checkMigrationIntegrity(folder), [], `${dialect}: inconsistent candidate history`);
	console.log(`${dialect}: candidate journal and snapshots validated (${journal.entries.length} migrations)`);
	return folder;
}

function verifySqliteUpgrade(candidate: string) {
	const upgraded = new Database(':memory:');
	const fresh = new Database(':memory:');
	try {
		const db = drizzle(upgraded);
		migrate(db, { migrationsFolder: path.join(forkBackendDir, 'migrations-sqlite') });
		upgraded.run("INSERT INTO user (id,name,email) VALUES ('alice','Alice','alice@example.test')");
		upgraded.run("INSERT INTO organization (id,name,slug) VALUES ('org','Irrifarm','irrifarm')");
		upgraded.run(
			`INSERT INTO project (id,org_id,name,type,path,default_models,env_vars)
			 VALUES ('farm','org','Farm','local','/projects/irrifarm','{}','{"preserve":"yes"}')`,
		);
		upgraded.run(
			"INSERT INTO chat (id,user_id,project_id,title) VALUES ('chat','alice','farm','Preserve this conversation')",
		);
		upgraded.run(
			`INSERT INTO irrifarm_identity (user_id,irrifarm_user_id,username,client_id,client_level,mbo_sns,last_validated_at)
			 VALUES ('alice',123,'Alice',5,1,'["SN001"]',100)`,
		);
		upgraded.run(
			`INSERT INTO context_asset (id,project_id,virtual_path,content_hash,data,media_type)
			 VALUES ('asset','farm','/manual.pdf','hash','test-asset','application/pdf')`,
		);
		const queries = [
			'SELECT id,name,email FROM user ORDER BY id',
			'SELECT id,name,default_models,env_vars FROM project ORDER BY id',
			'SELECT id,user_id,project_id,title FROM chat ORDER BY id',
			'SELECT * FROM irrifarm_identity ORDER BY user_id',
			'SELECT * FROM context_asset ORDER BY id',
		];
		const before = queries.map((query) => upgraded.query(query).all());
		migrate(db, { migrationsFolder: candidate });
		assert.deepEqual(
			queries.map((query) => upgraded.query(query).all()),
			before,
			'Upgrade changed existing data',
		);
		const migrations = () => upgraded.query('SELECT * FROM __drizzle_migrations ORDER BY created_at').all();
		assert.equal(migrations().length, 107);
		const after = migrations();
		migrate(db, { migrationsFolder: candidate });
		assert.deepEqual(migrations(), after, 'Repeated upgrade must not apply migrations again');
		migrate(drizzle(fresh), { migrationsFolder: candidate });
		const schema =
			"SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name";
		const normalizedSchema = (connection: Database) =>
			connection
				.query(schema)
				.all()
				.map((row) => {
					const value = row as { type: string; name: string; tbl_name: string; sql: string | null };
					return { ...value, sql: value.sql?.replace(/\r\n/g, '\n') ?? null };
				});
		assert.deepEqual(normalizedSchema(upgraded), normalizedSchema(fresh), 'Fresh and upgraded schemas differ');
		assert.deepEqual(upgraded.query('PRAGMA foreign_key_check').all(), []);
		console.log(
			'SQLite: fresh install, upgrade 67->107, repeat run, schema equivalence and data preservation passed',
		);
	} finally {
		upgraded.close();
		fresh.close();
	}
}

/** Own the server lifecycle: never accept an application connection string here. */
async function verifyPostgresUpgrade(candidate: string) {
	const container = `nao-migration-check-${crypto.randomUUID()}`;
	const password = crypto.randomUUID();
	const docker = (args: string[]) => execFileSync('docker', args, { encoding: 'utf8', timeout: 180_000 }).trim();
	let started = false;
	let upgraded: ReturnType<typeof postgres> | undefined;
	let fresh: ReturnType<typeof postgres> | undefined;
	try {
		console.log('PostgreSQL: starting a disposable PostgreSQL 17 container on a random loopback port');
		docker([
			'run',
			'--detach',
			'--rm',
			'--name',
			container,
			'--label',
			'nao.purpose=upstream-migration-rehearsal',
			'--env',
			'POSTGRES_USER=nao_test',
			'--env',
			`POSTGRES_PASSWORD=${password}`,
			'--publish',
			'127.0.0.1::5432',
			'postgres:17-alpine',
		]);
		started = true;
		const port = Number(
			docker([
				'inspect',
				'--format',
				'{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
				container,
			]),
		);
		assert(Number.isInteger(port) && port > 0);
		let ready = false;
		for (let attempt = 0; attempt < 60; attempt++) {
			try {
				// The image starts a socket-only bootstrap server first; wait for the final TCP server.
				docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'nao_test']);
				ready = true;
				break;
			} catch {
				await Bun.sleep(500);
			}
		}
		assert(ready, 'Disposable PostgreSQL server did not become ready');
		for (const name of ['upgrade_test', 'fresh_test']) {
			docker(['exec', container, 'createdb', '-U', 'nao_test', name]);
		}
		const connect = (database: string) =>
			postgres({ host: '127.0.0.1', port, username: 'nao_test', password, database, max: 1, onnotice: () => {} });
		upgraded = connect('upgrade_test');
		fresh = connect('fresh_test');
		const db = drizzlePostgres(upgraded);
		await migratePostgres(db, { migrationsFolder: path.join(forkBackendDir, 'migrations-postgres') });
		await upgraded`INSERT INTO "user" (id,name,email) VALUES ('alice','Alice','alice@example.test')`;
		await upgraded`INSERT INTO organization (id,name,slug) VALUES ('org','Irrifarm','irrifarm')`;
		await upgraded`INSERT INTO project (id,org_id,name,type,path,default_models,env_vars)
			VALUES ('farm','org','Farm','local','/projects/irrifarm','{}','{"preserve":"yes"}')`;
		await upgraded`INSERT INTO chat (id,user_id,project_id,title) VALUES ('chat','alice','farm','Preserve this conversation')`;
		await upgraded`INSERT INTO irrifarm_identity (user_id,irrifarm_user_id,username,client_id,client_level,mbo_sns,last_validated_at)
			VALUES ('alice',123,'Alice',5,1,'["SN001"]','2026-11-15T00:00:00')`;
		await upgraded`INSERT INTO context_asset (id,project_id,virtual_path,content_hash,data,media_type)
			VALUES ('asset','farm','/manual.pdf','hash','test-asset','application/pdf')`;
		const queries = [
			'SELECT id,name,email FROM "user" ORDER BY id',
			'SELECT id,name,slug FROM organization ORDER BY id',
			'SELECT id,name,default_models,env_vars FROM project ORDER BY id',
			'SELECT id,user_id,project_id,title FROM chat ORDER BY id',
			'SELECT * FROM irrifarm_identity ORDER BY user_id',
			'SELECT * FROM context_asset ORDER BY id',
		];
		const readData = async () => {
			const rows = [];
			for (const query of queries) {
				rows.push(Array.from(await upgraded!.unsafe(query)));
			}
			return rows;
		};
		const before = await readData();
		await migratePostgres(db, { migrationsFolder: candidate });
		assert.deepEqual(await readData(), before, 'PostgreSQL upgrade changed existing data');
		const readMigrations = async () =>
			Array.from(await upgraded!`SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at`);
		const after = await readMigrations();
		assert.equal(after.length, 107);
		await migratePostgres(db, { migrationsFolder: candidate });
		assert.deepEqual(await readMigrations(), after, 'PostgreSQL repeated upgrade must not apply migrations again');
		await migratePostgres(drizzlePostgres(fresh), { migrationsFolder: candidate });
		const schemaQueries = [
			`SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default
			 FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`,
			`SELECT c.relname,k.conname,k.contype,k.convalidated,pg_get_constraintdef(k.oid) AS definition
			 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
			 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,k.conname`,
			`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname`,
		];
		for (const query of schemaQueries) {
			assert.deepEqual(
				Array.from(await upgraded.unsafe(query)),
				Array.from(await fresh.unsafe(query)),
				'PostgreSQL fresh and upgraded schemas differ',
			);
		}
		console.log(
			'PostgreSQL: fresh install, upgrade 67->107, repeat run, schema/constraint equivalence and data preservation passed',
		);
	} finally {
		await Promise.allSettled([upgraded?.end({ timeout: 5 }), fresh?.end({ timeout: 5 })]);
		if (started) {
			docker(['rm', '--force', container]);
		}
	}
}

try {
	extractForkHistory();
	const sqliteCandidate = process.argv.includes('--current')
		? path.join(backendDir, 'migrations-sqlite')
		: prepareCandidate('sqlite');
	const postgresCandidate = process.argv.includes('--current')
		? path.join(backendDir, 'migrations-postgres')
		: prepareCandidate('postgres');
	for (const candidate of [sqliteCandidate, postgresCandidate]) {
		assert.deepEqual(checkMigrationIntegrity(candidate), []);
	}
	verifySqliteUpgrade(sqliteCandidate);
	if (process.argv.includes('--postgres')) {
		await verifyPostgresUpgrade(postgresCandidate);
	} else {
		console.log('PostgreSQL: structural checks only; pass --postgres to verify against a disposable Docker server');
	}
} finally {
	assert.equal(path.dirname(path.resolve(tempDir)), path.resolve(os.tmpdir()));
	fs.rmSync(tempDir, { recursive: true, force: true });
}
