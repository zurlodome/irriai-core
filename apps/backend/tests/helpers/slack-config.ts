import type { WebClient } from '@slack/web-api';
import { vi } from 'vitest';

import type { SlackConfig } from '../../src/queries/project-slack-config.queries';
import type { ProjectSlackBot } from '../../src/services/slack';

export function stubSlackAdapterApi(bot: ProjectSlackBot, authTest?: WebClient['auth']['test']): void {
	const adapter = bot['_bot'].getAdapter('slack') as unknown as {
		_client: Pick<WebClient, 'auth' | 'users'>;
	};
	adapter._client.auth.test =
		authTest ?? vi.fn().mockResolvedValue({ ok: true, user_id: 'UBOT', bot_id: 'BBOT', user: 'nao' });
	adapter._client.users.info = vi.fn().mockResolvedValue({ ok: true, user: { id: 'UHUMAN', name: 'ada' } });
}

export function createSlackConfig(overrides: Partial<SlackConfig> = {}): SlackConfig {
	return {
		projectId: 'project-1',
		botToken: 'xoxb-test',
		signingSecret: 'secret',
		redirectUrl: 'https://nao.example.com/',
		autoCreateUsersEnabled: false,
		autoCreateUsersDomains: [],
		transportMode: 'webhook',
		appToken: '',
		replyMode: 'thread',
		dmScopeMissing: false,
		dmThreadsEnabled: false,
		...overrides,
	};
}
