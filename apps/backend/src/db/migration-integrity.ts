import fs from 'fs';
import path from 'path';

interface JournalEntry {
	idx: number;
	tag: string;
	when: number;
}

/** Structural checks only: a valid history still needs fresh-install and upgrade tests. */
export function checkMigrationIntegrity(migrationsDir: string): string[] {
	const issues: string[] = [];
	const journal = JSON.parse(fs.readFileSync(path.join(migrationsDir, 'meta', '_journal.json'), 'utf8')) as {
		entries: JournalEntry[];
	};
	const files = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql'));
	const snapshots = fs
		.readdirSync(path.join(migrationsDir, 'meta'))
		.filter((file) => file.endsWith('_snapshot.json'));
	const indices = new Set<number>();
	const tags = new Set<string>();
	const timestamps = new Set<number>();
	const snapshotIds = new Set<string>();
	const expectedSql = new Set<string>();
	const expectedSnapshots = new Set<string>();
	let previousTime = -Infinity;
	let previousId = '00000000-0000-0000-0000-000000000000';

	for (const [position, entry] of journal.entries.entries()) {
		const label = `journal entry ${position} (${entry.tag})`;
		if (!Number.isInteger(entry.idx) || entry.idx !== position) {
			issues.push(`${label}: expected index ${position}, got ${entry.idx}`);
		}
		if (indices.has(entry.idx)) {
			issues.push(`${label}: duplicate index ${entry.idx}`);
		}
		indices.add(entry.idx);
		if (tags.has(entry.tag)) {
			issues.push(`${label}: duplicate tag ${entry.tag}`);
		}
		tags.add(entry.tag);
		if (!Number.isSafeInteger(entry.when) || entry.when <= previousTime || timestamps.has(entry.when)) {
			issues.push(`${label}: timestamps must be unique and strictly increasing`);
		}
		timestamps.add(entry.when);
		previousTime = entry.when;

		const prefix = String(entry.idx).padStart(4, '0');
		if (typeof entry.tag !== 'string' || !new RegExp(`^${prefix}_[a-zA-Z0-9_-]+$`).test(entry.tag)) {
			issues.push(`${label}: tag must use its index prefix and contain no path separators`);
			continue;
		}
		const sqlFile = `${entry.tag}.sql`;
		const snapshotFile = `${prefix}_snapshot.json`;
		expectedSql.add(sqlFile);
		expectedSnapshots.add(snapshotFile);
		if (!files.includes(sqlFile)) {
			issues.push(`${label}: missing SQL file ${sqlFile}`);
		}
		if (!snapshots.includes(snapshotFile)) {
			issues.push(`${label}: missing snapshot ${snapshotFile}`);
			continue;
		}
		try {
			const snapshot = JSON.parse(fs.readFileSync(path.join(migrationsDir, 'meta', snapshotFile), 'utf8')) as {
				id: string;
				prevId: string;
			};
			if (typeof snapshot.id !== 'string' || !snapshot.id || snapshotIds.has(snapshot.id)) {
				issues.push(`${snapshotFile}: snapshot id must be present and unique`);
			}
			if (snapshot.prevId !== previousId) {
				issues.push(
					`${snapshotFile}: broken snapshot chain; expected prevId ${previousId}, got ${snapshot.prevId}`,
				);
			}
			snapshotIds.add(snapshot.id);
			previousId = snapshot.id;
		} catch {
			issues.push(`${snapshotFile}: invalid snapshot JSON`);
		}
	}

	for (const file of files) {
		if (!expectedSql.has(file)) {
			issues.push(`${file}: SQL file is not registered in the journal`);
		}
	}
	for (const file of snapshots) {
		if (!expectedSnapshots.has(file)) {
			issues.push(`${file}: snapshot is not registered in the journal`);
		}
	}
	return issues;
}
