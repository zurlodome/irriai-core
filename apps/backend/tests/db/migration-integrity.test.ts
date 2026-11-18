import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it } from 'vitest';

import { checkMigrationIntegrity } from '../../src/db/migration-integrity';
import { useTemporaryFolders } from '../helpers/temporary-folders';

const createTemporaryFolder = useTemporaryFolders();
const rootId = '00000000-0000-0000-0000-000000000000';
let directory: string;
let entries: { idx: number; tag: string; when: number }[];

function writeJournal() {
	fs.writeFileSync(path.join(directory, 'meta/_journal.json'), JSON.stringify({ entries }));
}

function writeSnapshot(index: number, id: string, prevId: string) {
	fs.writeFileSync(
		path.join(directory, 'meta', `${String(index).padStart(4, '0')}_snapshot.json`),
		JSON.stringify({ id, prevId }),
	);
}

describe('migration history integrity', () => {
	beforeEach(() => {
		directory = createTemporaryFolder('nao-migration-integrity-');
		fs.mkdirSync(path.join(directory, 'meta'));
		entries = [
			{ idx: 0, tag: '0000_initial', when: 100 },
			{ idx: 1, tag: '0001_irrifarm_identity', when: 200 },
		];
		for (const entry of entries) {
			fs.writeFileSync(path.join(directory, `${entry.tag}.sql`), 'SELECT 1;');
		}
		writeJournal();
		writeSnapshot(0, 'initial', rootId);
		writeSnapshot(1, 'irrifarm', 'initial');
	});

	it('accepts a contiguous journal with matching SQL and linked snapshots', () => {
		expect(checkMigrationIntegrity(directory)).toEqual([]);
	});

	it('rejects an automatically merged journal with competing migrations at the same index', () => {
		entries.push({ idx: 1, tag: '0001_user_groups', when: 300 });
		fs.writeFileSync(path.join(directory, '0001_user_groups.sql'), 'SELECT 1;');
		writeJournal();
		expect(checkMigrationIntegrity(directory)).toContainEqual(expect.stringContaining('duplicate index 1'));
	});

	it.each([100, 99, 200.5])('rejects a non-increasing or invalid migration timestamp: %s', (when) => {
		entries[1].when = when;
		writeJournal();
		expect(checkMigrationIntegrity(directory)).toContainEqual(expect.stringContaining('timestamps must be unique'));
	});

	it('rejects duplicate migration tags', () => {
		entries[1].tag = entries[0].tag;
		writeJournal();
		expect(checkMigrationIntegrity(directory)).toContainEqual(expect.stringContaining('duplicate tag'));
	});

	it('rejects a gap in the migration indices', () => {
		entries[1] = { idx: 2, tag: '0002_irrifarm_identity', when: 200 };
		writeJournal();
		expect(checkMigrationIntegrity(directory)).toContainEqual(expect.stringContaining('expected index 1, got 2'));
	});

	it('rejects a snapshot still linked to the upstream history instead of the fork', () => {
		writeSnapshot(1, 'irrifarm', 'upstream-snapshot');
		expect(checkMigrationIntegrity(directory)).toContainEqual(expect.stringContaining('broken snapshot chain'));
	});

	it('rejects duplicate snapshot identities', () => {
		writeSnapshot(1, 'initial', 'initial');
		expect(checkMigrationIntegrity(directory)).toContainEqual(
			expect.stringContaining('snapshot id must be present'),
		);
	});

	it('rejects a missing SQL file even if a same-number file exists', () => {
		fs.renameSync(path.join(directory, '0001_irrifarm_identity.sql'), path.join(directory, '0001_user_groups.sql'));
		expect(checkMigrationIntegrity(directory)).toContainEqual(expect.stringContaining('missing SQL file'));
		expect(checkMigrationIntegrity(directory)).toContainEqual(
			expect.stringContaining('not registered in the journal'),
		);
	});

	it('rejects missing and conflicted snapshots', () => {
		fs.unlinkSync(path.join(directory, 'meta/0000_snapshot.json'));
		fs.writeFileSync(path.join(directory, 'meta/0001_snapshot.json'), '<<<<<<< fork\n=======\n>>>>>>> upstream');
		const issues = checkMigrationIntegrity(directory);
		expect(issues).toContainEqual(expect.stringContaining('missing snapshot'));
		expect(issues).toContainEqual(expect.stringContaining('invalid snapshot JSON'));
	});

	it('rejects unregistered snapshots', () => {
		writeSnapshot(2, 'orphan', 'irrifarm');
		expect(checkMigrationIntegrity(directory)).toContainEqual(
			expect.stringContaining('snapshot is not registered'),
		);
	});

	it('does not follow a tag outside the migration directory', () => {
		entries[1].tag = '../outside';
		writeJournal();
		expect(checkMigrationIntegrity(directory)).toContainEqual(
			expect.stringContaining('contain no path separators'),
		);
	});
});

interface BaselineEntry {
	idx: number;
	tag: string;
	when: number;
	sqlSha256: string;
	snapshotSha256: string;
}

const baseline = JSON.parse(
	fs.readFileSync(new URL('../fixtures/irrifarm-migration-baseline.json', import.meta.url), 'utf8'),
) as { forkCommit: string; dialects: Record<string, BaselineEntry[]> };

function digest(file: string) {
	return createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
}

describe.each(['sqlite', 'postgres'])('published Irrifarm migration history (%s)', (dialect) => {
	const directory = fileURLToPath(new URL(`../../migrations-${dialect}/`, import.meta.url));

	it('has a coherent journal, registered SQL and a single snapshot chain', () => {
		expect(checkMigrationIntegrity(directory)).toEqual([]);
	});

	it('preserves the applied fork history while allowing new migrations to be appended', () => {
		const { entries } = JSON.parse(fs.readFileSync(path.join(directory, 'meta/_journal.json'), 'utf8')) as {
			entries: { idx: number; tag: string; when: number }[];
		};
		const published = baseline.dialects[dialect];
		expect(entries.length).toBeGreaterThanOrEqual(published.length);
		for (const entry of published) {
			expect(entries[entry.idx], `journal metadata changed for ${entry.tag}`).toMatchObject({
				idx: entry.idx,
				tag: entry.tag,
				when: entry.when,
			});
			expect(digest(path.join(directory, `${entry.tag}.sql`)), `applied SQL changed for ${entry.tag}`).toBe(
				entry.sqlSha256,
			);
			expect(
				digest(path.join(directory, 'meta', `${String(entry.idx).padStart(4, '0')}_snapshot.json`)),
				`published snapshot changed for ${entry.tag}`,
			).toBe(entry.snapshotSha256);
		}
	});
});
