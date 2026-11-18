import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../../src/env';

vi.mock('../../src/services/license.service', () => ({
	hasFeature: vi.fn(async () => false),
	LICENSE_FEATURES: { excludeColumns: 'exclude-columns' },
}));
vi.mock('../../src/queries/execute-sql.queries', () => ({
	EXECUTE_SEMANTIC_QUERY_TOOL_NAME: 'execute_semantic_query',
	getExecuteSqlPartByQueryIdInChat: vi.fn(async () => null),
	updateExecuteSqlPart: vi.fn(),
}));
vi.mock('../../src/queries/project.queries', () => ({
	getAgentSettings: vi.fn(),
}));
vi.mock('../../src/agents/tools/query-app-db', () => ({
	queryAppDb: vi.fn(),
}));
vi.mock('../../src/services/local-query.service', () => ({
	runQueryOnLocalFiles: vi.fn(),
}));

import executeSqlTool, { executeQuery } from '../../src/agents/tools/execute-sql';
import { getExecuteSqlPartByQueryIdInChat, updateExecuteSqlPart } from '../../src/queries/execute-sql.queries';
import { hasFeature, LICENSE_FEATURES } from '../../src/services/license.service';
import type { WarehouseTableAccess } from '../../src/services/user-group-context-access.service';
import type { ToolContext } from '../../src/types/tools';
import { createToolContext, executeTool } from '../helpers/tool-context';

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('execute_sql excluded-column enforcement', () => {
	it.each([
		{ licensed: false, storedSetting: true, expected: false },
		{ licensed: true, storedSetting: undefined, expected: true },
		{ licensed: true, storedSetting: false, expected: false },
		{ licensed: true, storedSetting: true, expected: true },
	] as const)(
		'sends $expected when licensed=$licensed and stored setting=$storedSetting',
		async ({ licensed, storedSetting, expected }) => {
			vi.mocked(hasFeature).mockResolvedValue(licensed);
			const fetch = stubWarehouseFetch();

			await executeQuery({ sql_query: 'SELECT 1' }, createLicenseContext(storedSetting));

			expect(hasFeature).toHaveBeenCalledWith(LICENSE_FEATURES.excludeColumns, { projectId: 'project-1' });
			expect(sentBody(fetch)).toMatchObject({ enforce_excluded_columns: expected });
		},
	);

	it.each([
		{
			name: 'unlicensed bypass',
			access: { enforced: false } as WarehouseTableAccess,
			expected: { enforced: false },
		},
		{
			name: 'licensed strict restricted empty',
			access: { enforced: true, strict: true, tables: [] } as WarehouseTableAccess,
			expected: { enforced: true, tables: [] },
		},
		{
			name: 'licensed non-strict filtered access',
			access: {
				enforced: true,
				strict: false,
				tables: [{ databaseType: 'postgres', database: 'analytics', schema: 'public', table: 'orders' }],
			} as WarehouseTableAccess,
			expected: { enforced: false },
		},
		{
			name: 'licensed expanded schema or table grants',
			access: {
				enforced: true,
				strict: true,
				tables: [{ databaseType: 'postgres', database: 'analytics', schema: 'public', table: 'orders' }],
			} as WarehouseTableAccess,
			expected: {
				enforced: true,
				tables: [{ database_type: 'postgres', database: 'analytics', schema: 'public', table: 'orders' }],
			},
		},
	])('sends server-resolved table access for $name', async ({ access, expected }) => {
		vi.mocked(hasFeature).mockResolvedValue(false);
		const fetch = stubWarehouseFetch();

		await executeQuery({ sql_query: 'SELECT 1' }, createLicenseContext(undefined, access));

		expect(sentBody(fetch).table_access).toEqual(expected);
	});

	it('rejects an unsafe malformed access discriminant before sending', async () => {
		vi.mocked(hasFeature).mockResolvedValue(false);
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		const malformedAccess = { enforced: 0 } as unknown as WarehouseTableAccess;

		await expect(
			executeQuery({ sql_query: 'SELECT 1' }, createLicenseContext(undefined, malformedAccess)),
		).rejects.toThrow('invalid enforced discriminant');
		expect(fetch).not.toHaveBeenCalled();
	});
});

describe('execute_sql in-place edit of a query created in the current turn', () => {
	beforeEach(() => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ data: [{ n: 1 }], row_count: 1, columns: ['n'] })),
		);
	});

	it('re-runs a same-turn SQL query under its id when it is not persisted yet', async () => {
		const context = createToolContext();
		const created = await executeQuery({ sql_query: 'SELECT 1 AS n' }, context);

		const edited = await executeTool(executeSqlTool, { sql_query: 'SELECT 2 AS n', query_id: created.id }, context);

		expect(getExecuteSqlPartByQueryIdInChat).toHaveBeenCalledWith('chat-1', created.id);
		expect(edited.id).toBe(created.id);
		expect(context.queryResults.get(created.id)).toEqual({
			columns: ['n'],
			data: [{ n: 1 }],
			sqlQuery: 'SELECT 2 AS n',
		});
		expect(updateExecuteSqlPart).not.toHaveBeenCalled();
	});

	it('refuses to edit a same-turn semantic query as SQL', async () => {
		const context = createToolContext();
		const created = await executeQuery({ sql_query: 'SELECT 1 AS n' }, context, {
			semanticQuery: { metrics: ['orders'] },
		});

		await expect(
			executeTool(executeSqlTool, { sql_query: 'SELECT 2 AS n', query_id: created.id }, context),
		).rejects.toThrow(`Query ${created.id} is a semantic query and cannot be edited as SQL`);
	});

	it('still reports unknown query ids', async () => {
		await expect(
			executeTool(
				executeSqlTool,
				{ sql_query: 'SELECT 2 AS n', query_id: 'query_missing0' },
				createToolContext(),
			),
		).rejects.toThrow('Query query_missing0 not found in this chat');
	});
});

describe('execute_sql blocks catalog/server-passthrough calls unconditionally', () => {
	const exploitSql =
		"SELECT * FROM postgres_query('__ducklake_metadata_lake', 'SELECT rolname, rolpassword FROM pg_authid')";

	it.each([
		[
			'rejects the exploit payload when write permissions are disabled',
			{ sql: { dangerouslyWritePermEnabled: false } },
		],
		[
			'still rejects the exploit payload when write permissions are enabled',
			{ sql: { dangerouslyWritePermEnabled: true } },
		],
		['still rejects the exploit payload when no agent settings are configured', null],
	])('%s', async (_name, agentSettings) => {
		await expect(
			executeQuery({ sql_query: exploitSql }, createToolContext({ agentSettings: agentSettings as never })),
		).rejects.toThrow(/passthrough/);
	});
});

function createLicenseContext(
	storedSetting: boolean | undefined,
	warehouseTableAccess: WarehouseTableAccess = { enforced: false },
): ToolContext {
	return createToolContext({
		agentSettings: storedSetting === undefined ? {} : { sql: { enforceExcludedColumns: storedSetting } },
		warehouseTableAccess,
	});
}

function stubWarehouseFetch() {
	const fetch = vi.fn(async () => Response.json({ data: [], row_count: 0, columns: [] }));
	vi.stubGlobal('fetch', fetch);
	return fetch;
}

function sentBody(fetch: ReturnType<typeof stubWarehouseFetch>) {
	const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
	return JSON.parse(String(init.body));
}

const sqlTransportFetch = vi.fn<typeof fetch>();
function context(userId: string, allowedMboSns: string[] | null): ToolContext {
	return createToolContext({
		projectId: 'irrifarm-project',
		projectFolder: '/projects/irrifarm',
		chatId: `chat-${userId}`,
		userId,
		allowedMboSns,
		envVars: { WAREHOUSE_HOST: 'warehouse.test' },
		azureAccessToken: 'azure-test-token',
	});
}
function warehouseResult(appliedLimit?: number) {
	return Response.json({
		data: [{ MBO_SN: 'SN001' }],
		columns: ['MBO_SN'],
		row_count: 1,
		dialect: 'mysql',
		...(appliedLimit !== undefined && { applied_limit: appliedLimit }),
	});
}

function sentRequest(call = 0) {
	const [url, options] = sqlTransportFetch.mock.calls[call];
	return { url, options: options!, body: JSON.parse(String(options!.body)) };
}

describe('Irrifarm warehouse HTTP contract', () => {
	beforeEach(() => {
		vi.mocked(hasFeature).mockResolvedValue(true);
		sqlTransportFetch.mockReset();
		sqlTransportFetch.mockImplementation(async () => warehouseResult());
		vi.stubGlobal('fetch', sqlTransportFetch);
	});
	it.each([{ scope: ['SN001'] }, { scope: ['SN001', 'SN002'] }, { scope: [] }])(
		'sends the exact authorized scope, including empty scope: $scope',
		async ({ scope: serials }) => {
			await executeQuery(
				{ sql_query: 'SELECT * FROM motherboards', database_id: 'farm' },
				context('alice', serials),
			);
			const request = sentRequest();
			expect(request.url).toBe(`http://localhost:${env.FASTAPI_PORT}/execute_sql`);
			expect(request.body).toMatchObject({
				allowed_mbo_sns: serials,
				database_id: 'farm',
				nao_project_folder: '/projects/irrifarm',
				enforce_excluded_columns: true,
				env_vars: { WAREHOUSE_HOST: 'warehouse.test' },
				azure_access_token: 'azure-test-token',
			});
			expect(Object.hasOwn(request.options.headers!, 'X-Nao-Internal-Secret')).toBe(true);
			expect(request.options.signal).toBeInstanceOf(AbortSignal);
		},
	);

	it('omits Irrifarm scope and timeout for an identity outside the Irrifarm integration', async () => {
		await executeQuery({ sql_query: 'SELECT 1' }, context('local-admin', null));
		expect(sentRequest().body).not.toHaveProperty('allowed_mbo_sns');
		expect(sentRequest().options.signal).toBeUndefined();
	});

	it('keeps disjoint user scopes separate across consecutive calls', async () => {
		await executeQuery({ sql_query: 'SELECT * FROM motherboards' }, context('alice', ['SN001']));
		await executeQuery({ sql_query: 'SELECT * FROM motherboards' }, context('bob', ['SN002']));
		expect(sentRequest(0).body.allowed_mbo_sns).toEqual(['SN001']);
		expect(sentRequest(1).body.allowed_mbo_sns).toEqual(['SN002']);
	});

	it('sends an empty scope after permissions are revoked instead of reusing the previous scope', async () => {
		await executeQuery({ sql_query: 'SELECT * FROM motherboards' }, context('alice', ['SN001']));
		await executeQuery({ sql_query: 'SELECT * FROM motherboards' }, context('alice', []));
		expect(sentRequest(1).body.allowed_mbo_sns).toEqual([]);
	});

	it('propagates warehouse denials without retrying with a broader scope or caching results', async () => {
		sqlTransportFetch.mockResolvedValue(Response.json({ detail: 'MBO access denied' }, { status: 403 }));
		const caller = context('alice', []);
		await expect(executeQuery({ sql_query: 'SELECT * FROM motherboards' }, caller)).rejects.toThrow(
			'MBO access denied',
		);
		expect(sqlTransportFetch).toHaveBeenCalledTimes(1);
		expect(caller.queryResults.size).toBe(0);
	});

	it('returns a useful timeout error without retrying an authorized query unscoped', async () => {
		sqlTransportFetch.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
		await expect(
			executeQuery({ sql_query: 'SELECT * FROM motherboards' }, context('alice', ['SN001'])),
		).rejects.toThrow(`Irrifarm SQL query exceeded ${env.IRRIFARM_QUERY_TIMEOUT_MS} ms`);
		expect(sqlTransportFetch).toHaveBeenCalledTimes(1);
	});

	it.each([
		['SELECT * FROM motherboards', 500],
		['SELECT * FROM motherboards LIMIT 1000', 500],
		['SELECT * FROM motherboards LIMIT 20', 20],
	])('preserves the effective bounded-result metadata for %s', async (sql, expectedLimit) => {
		sqlTransportFetch.mockResolvedValue(warehouseResult(500));
		const output = await executeQuery({ sql_query: sql }, context('alice', ['SN001']));
		expect(output.applied_limit).toBe(expectedLimit);
	});

	it('does not send write queries when write permission is disabled', async () => {
		await expect(
			executeQuery({ sql_query: 'DELETE FROM motherboards' }, context('alice', ['SN001'])),
		).rejects.toThrow('Write SQL operations are disabled');
		expect(sqlTransportFetch).not.toHaveBeenCalled();
	});
});
