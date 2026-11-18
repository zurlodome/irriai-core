import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
	extractConfiguredDatabases,
	extractConfiguredRepos,
	extractLlmProviderOptions,
	extractRequiredEnvVars,
} from '../../src/utils/nao-config';
import { restoreProcessEnvAfterEach } from '../helpers/process-env-snapshot';
import { useTemporaryFolders } from '../helpers/temporary-folders';

vi.mock('../../src/utils/logger', () => import('../helpers/logger-mock'));

const createTemporaryFolder = useTemporaryFolders();

restoreProcessEnvAfterEach();

describe('extractRequiredEnvVars', () => {
	it('returns env vars declared in nao_config.yaml', () => {
		const dir = createProject({
			naoConfig: [
				'project_name: demo',
				'databases:',
				'  - name: warehouse',
				'    type: postgres',
				'    password: "{{ env(\'DB_PASSWORD\') }}"',
			],
		});

		expect(extractRequiredEnvVars(dir)).toEqual(['DB_PASSWORD']);
	});

	it('returns env vars declared in mcp.json', () => {
		const dir = createProject({
			mcpServers: {
				dbt: {
					command: 'npx',
					args: ['-y', '@example/dbt-mcp'],
					env: {
						DBT_TOKEN: '${DBT_TOKEN}',
					},
				},
			},
		});

		expect(extractRequiredEnvVars(dir)).toEqual(['DBT_TOKEN']);
	});

	it('deduplicates env vars across nao_config.yaml and mcp.json', () => {
		const dir = createProject({
			naoConfig: ['password: "{{ env(\'DB_PASSWORD\') }}"', ''],
			mcpServers: {
				warehouse: {
					command: 'npx',
					env: {
						DB_PASSWORD: '${DB_PASSWORD}',
						DBT_TOKEN: '${DBT_TOKEN}',
					},
				},
			},
		});

		expect(extractRequiredEnvVars(dir)).toEqual(['DB_PASSWORD', 'DBT_TOKEN']);
	});

	it('skips config files that cannot be read', () => {
		const dir = createProject({});
		fs.mkdirSync(path.join(dir, 'agent', 'mcps', 'mcp.json'), { recursive: true });

		expect(extractRequiredEnvVars(dir)).toEqual([]);
	});
});

describe('extractConfiguredRepos', () => {
	it('returns repos declared in nao_config.yaml with GitHub metadata', () => {
		const dir = createProject({
			naoConfig: [
				'project_name: demo',
				'repos:',
				'  - name: dbt-models',
				'    url: https://github.com/nao/dbt-models.git',
				'    branch: main',
				'  - name: local-docs',
				'    local_path: ../docs',
			],
		});

		expect(extractConfiguredRepos(dir)).toEqual([
			{
				branch: 'main',
				contextPath: 'repos/dbt-models',
				localPath: null,
				name: 'dbt-models',
				provider: 'github',
				repoFullName: 'nao/dbt-models',
				url: 'https://github.com/nao/dbt-models.git',
			},
			{
				branch: null,
				contextPath: 'repos/local-docs',
				localPath: '../docs',
				name: 'local-docs',
				provider: null,
				repoFullName: null,
				url: null,
			},
		]);
	});

	it.each([
		{ envVars: undefined, url: "https://x:{{ env('REPO_TOKEN') }}@github.com/nao/dbt-models.git" },
		{ envVars: { REPO_TOKEN: 'project-token' }, url: 'https://x:project-token@github.com/nao/dbt-models.git' },
	])('resolves env references in repo URLs only with project variables ($envVars)', ({ envVars, url }) => {
		process.env.REPO_TOKEN = 'server-token';
		const dir = createProject({
			naoConfig: [
				'project_name: demo',
				'repos:',
				'  - name: dbt-models',
				`    url: "https://x:{{ env('REPO_TOKEN') }}@github.com/nao/dbt-models.git"`,
			],
		});

		expect(extractConfiguredRepos(dir, envVars)[0]?.url).toBe(url);
	});

	it('returns repos declared in nao_config.yaml with GitLab metadata', () => {
		const dir = createProject({
			naoConfig: [
				'project_name: demo',
				'repos:',
				'  - name: dbt-models',
				'    url: https://gitlab.com/nao/dbt-models.git',
				'    branch: main',
			],
		});

		expect(extractConfiguredRepos(dir)).toEqual([
			{
				branch: 'main',
				contextPath: 'repos/dbt-models',
				localPath: null,
				name: 'dbt-models',
				provider: 'gitlab',
				repoFullName: 'nao/dbt-models',
				url: 'https://gitlab.com/nao/dbt-models.git',
			},
		]);
	});

	it('leaves provider null when the repo url does not match a recognized host', () => {
		const dir = createProject({
			naoConfig: [
				'project_name: demo',
				'repos:',
				'  - name: dbt-models',
				'    url: https://bitbucket.org/nao/dbt-models.git',
			],
		});

		expect(extractConfiguredRepos(dir)).toEqual([
			{
				branch: null,
				contextPath: 'repos/dbt-models',
				localPath: null,
				name: 'dbt-models',
				provider: null,
				repoFullName: null,
				url: 'https://bitbucket.org/nao/dbt-models.git',
			},
		]);
	});
});

function createProject({ naoConfig, mcpServers }: { naoConfig?: string[]; mcpServers?: Record<string, unknown> }) {
	const dir = createTemporaryFolder('nao-config-');
	if (naoConfig) {
		fs.writeFileSync(path.join(dir, 'nao_config.yaml'), naoConfig.join('\n'));
	}
	if (mcpServers) {
		const mcpDir = path.join(dir, 'agent', 'mcps');
		fs.mkdirSync(mcpDir, { recursive: true });
		fs.writeFileSync(path.join(mcpDir, 'mcp.json'), JSON.stringify({ mcpServers }));
	}
	return dir;
}

describe('extractConfiguredDatabases', () => {
	it('returns an empty list when nao_config.yaml is missing', () => {
		const dir = createTemporaryFolder('nao-config-');
		try {
			expect(extractConfiguredDatabases(dir)).toEqual([]);
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});

	it('returns an empty list when databases is absent', () => {
		const dir = createTemporaryFolder('nao-config-');
		try {
			fs.writeFileSync(path.join(dir, 'nao_config.yaml'), 'project_name: demo\n');

			expect(extractConfiguredDatabases(dir)).toEqual([]);
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});

	it('skips databases without a valid name', () => {
		const dir = createTemporaryFolder('nao-config-');
		try {
			fs.writeFileSync(
				path.join(dir, 'nao_config.yaml'),
				[
					'databases:',
					'  - type: duckdb',
					'    path: ./missing-name.duckdb',
					'  - name: "  "',
					'    type: postgres',
					'  - name: 123',
					'    type: bigquery',
					'  - name: valid-database',
					'    type: duckdb',
				].join('\n'),
			);

			expect(extractConfiguredDatabases(dir)).toEqual([{ id: 'valid-database', type: 'duckdb' }]);
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});

	it('returns ids, types, and identifying fields without secret-bearing fields', () => {
		const dir = createTemporaryFolder('nao-config-');
		try {
			fs.writeFileSync(
				path.join(dir, 'nao_config.yaml'),
				[
					'databases:',
					'  - name: duckdb-jaffle-shop',
					'    type: duckdb',
					'    path: ./jaffle_shop.duckdb',
					'  - name: bigquery-prod',
					'    type: bigquery',
					'    project_id: nao-corp',
					'    dataset_id: nao-corp.movies_silver',
					'    credentials_path: ./credentials.json',
				].join('\n'),
			);

			const databases = extractConfiguredDatabases(dir);

			expect(databases).toEqual([
				{
					id: 'duckdb-jaffle-shop',
					type: 'duckdb',
					database: 'jaffle_shop',
				},
				{
					id: 'bigquery-prod',
					type: 'bigquery',
					project_id: 'nao-corp',
					dataset_id: 'nao-corp.movies_silver',
				},
			]);
			expect(databases[1]).not.toHaveProperty('credentials_path');
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});

	it('derives safe database names from DuckDB paths', () => {
		const dir = createTemporaryFolder('nao-config-');
		try {
			fs.writeFileSync(
				path.join(dir, 'nao_config.yaml'),
				[
					'databases:',
					'  - name: in-memory',
					'    type: duckdb',
					'    path: ":memory:"',
					'  - name: motherduck-analytics',
					'    type: duckdb',
					'    path: "md:analytics?motherduck_token=secret123"',
					'  - name: motherduck-default',
					'    type: duckdb',
					'    path: "md:"',
					'  - name: mysql-analytics',
					'    type: mysql',
					'    path: "mysql://host:3306/analytics?user=u&password=hunter2"',
					'  - name: explicit-database',
					'    type: duckdb',
					'    path: ./ignored.duckdb',
					'    database: configured_name',
				].join('\n'),
			);

			const databases = extractConfiguredDatabases(dir);

			expect(databases).toEqual([
				{ id: 'in-memory', type: 'duckdb', database: 'memory' },
				{ id: 'motherduck-analytics', type: 'duckdb', database: 'analytics' },
				{ id: 'motherduck-default', type: 'duckdb', database: 'motherduck' },
				{ id: 'mysql-analytics', type: 'mysql', database: 'analytics' },
				{ id: 'explicit-database', type: 'duckdb', database: 'configured_name' },
			]);
			const serializedDatabases = JSON.stringify(databases);
			expect(serializedDatabases).not.toContain('secret123');
			expect(serializedDatabases).not.toContain('motherduck_token');
			expect(serializedDatabases).not.toContain('hunter2');
			expect(serializedDatabases).not.toContain('password');
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});
});

describe('extractLlmProviderOptions', () => {
	it('reads a global reasoning effort from nao_config.yaml', () => {
		const dir = createTemporaryFolder('nao-config-');
		try {
			fs.writeFileSync(
				path.join(dir, 'nao_config.yaml'),
				['project_name: demo', 'llm:', '  reasoning_effort: low'].join('\n'),
			);

			expect(extractLlmProviderOptions(dir, 'openai')).toEqual({ reasoningEffort: 'low' });
			expect(extractLlmProviderOptions(dir, 'azure')).toEqual({ reasoningEffort: 'low' });
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});

	it('lets provider-specific reasoning effort override the global value', () => {
		const dir = createTemporaryFolder('nao-config-');
		try {
			fs.writeFileSync(
				path.join(dir, 'nao_config.yaml'),
				[
					'project_name: demo',
					'llm:',
					'  reasoning_effort: low',
					'  providers:',
					'    openai:',
					'      reasoning_effort: high',
					'  azure:',
					'    reasoningEffort: medium',
				].join('\n'),
			);

			expect(extractLlmProviderOptions(dir, 'openai')).toEqual({ reasoningEffort: 'high' });
			expect(extractLlmProviderOptions(dir, 'azure')).toEqual({ reasoningEffort: 'medium' });
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});

	it('ignores unsupported Azure reasoning effort values', () => {
		const dir = createTemporaryFolder('nao-config-');
		try {
			fs.writeFileSync(
				path.join(dir, 'nao_config.yaml'),
				['project_name: demo', 'llm:', '  azure:', '    reasoning_effort: minimal'].join('\n'),
			);

			expect(extractLlmProviderOptions(dir, 'azure')).toEqual({});
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});
});
