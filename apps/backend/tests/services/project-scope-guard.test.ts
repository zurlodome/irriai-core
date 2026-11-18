import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	classifyProjectScope,
	hasProjectScopeGuard,
	OUTSIDE_PROJECT_SCOPE,
	UNCLEAR_PROJECT_SCOPE,
} from '../../src/services/project-scope-guard';
import type { UIMessage } from '../../src/types/chat';

const mocks = vi.hoisted(() => ({
	generateText: vi.fn(),
	resolveProviderModel: vi.fn(),
	disableModelReasoning: vi.fn(),
}));

vi.mock('ai', async (importOriginal) => ({
	...(await importOriginal<typeof import('ai')>()),
	generateText: mocks.generateText,
}));
vi.mock('../../src/agents/providers', () => ({ disableModelReasoning: mocks.disableModelReasoning }));
vi.mock('../../src/agents/telemetry', () => ({ llmTelemetry: vi.fn(() => ({})) }));
vi.mock('../../src/utils/llm', () => ({ resolveProviderModel: mocks.resolveProviderModel }));
vi.mock('../../src/utils/ai', () => ({
	extractLastTextFromMessage: (message: UIMessage) =>
		message.parts
			.filter((part) => part.type === 'text')
			.map((part) => part.text)
			.join('\n'),
}));

const rules = `# Project rules
| Richiesta | File | Ambito |
| Telemetria senshistory | senshistory_agent_rules.md | Read-only |
| Esecuzioni proghistory | proghistory_agent_rules.md | Read-only |
| Wiki PanAgri/IrriFarm/IRRIGO | wiki_agent_rules.md | Documentazione |
| Fuori da questi ambiti                  | Nessuna query | Comunica il limite |
`;

const message = (role: UIMessage['role'], text: string): UIMessage => ({
	id: crypto.randomUUID(),
	role,
	parts: [{ type: 'text', text }],
});

describe('project scope guard activation', () => {
	it.each([
		'| Fuori da questi ambiti | Nessuna ricerca | Comunica il limite |',
		'| Fuori da questi ambiti                         | Nessuna ricerca | Comunica il limite |',
		'\r\n\t|\tFuori da questi ambiti\t| Nessuna ricerca | Comunica il limite |\r\n',
	])('accepts a scope routing row regardless of table alignment', (row) => {
		expect(hasProjectScopeGuard(row)).toBe(true);
	});
	it.each([undefined, '', '# General project rules', 'The phrase Fuori da questi ambiti is not an opt-in row.'])(
		'does not enable the guard without an explicit routing row',
		(value) => {
			expect(hasProjectScopeGuard(value)).toBe(false);
		},
	);
});

describe('project scope classification', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.resolveProviderModel.mockResolvedValue({ model: { modelId: 'gpt-6-luna' } });
		mocks.disableModelReasoning.mockReturnValue({ model: { modelId: 'gpt-6-luna' } });
		mocks.generateText.mockResolvedValue({ output: { scope: 'inside' } });
	});

	it.each(['chi sei', ' Cosa sai fare?! ', 'di cosa ti occupi.'])(
		'keeps identity questions local: %s',
		async (text) => {
			expect(await classifyProjectScope('project-1', rules, [message('user', text)])).toBe('inside');
			expect(mocks.resolveProviderModel).not.toHaveBeenCalled();
			expect(mocks.generateText).not.toHaveBeenCalled();
		},
	);

	it.each([
		{ messages: [] },
		{ messages: [message('user', '   ')] },
		{ messages: [message('assistant', '100 esecuzioni')] },
	])('requires a nonempty latest user message', async ({ messages }) => {
		expect(await classifyProjectScope('project-1', rules, messages)).toBe('unclear');
		expect(mocks.generateText).not.toHaveBeenCalled();
	});

	it('passes the current project rules and all authorized domains to the classifier', async () => {
		await classifyProjectScope('project-1', rules, [message('user', 'Quanta acqua ha erogato IRRIFT0000990521?')]);
		const request = mocks.generateText.mock.calls[0][0];
		expect(JSON.parse(request.prompt).projectRules).toBe(rules);
		expect(request.system).toContain('proghistory');
		expect(request.system).toContain('senshistory');
		expect(request.system).toContain('only when authorized by projectRules');
		expect(request.system).toContain('private database structure');
		expect(mocks.resolveProviderModel).toHaveBeenCalledWith('project-1', 'azure', 'gpt-6-luna', false);
	});

	it('keeps only five recent conversation messages and bounds each text', async () => {
		const messages = Array.from({ length: 7 }, (_, index) =>
			message(index % 2 === 0 ? 'user' : 'assistant', String(index) + 'x'.repeat(1500)),
		);
		await classifyProjectScope('project-1', rules, messages);
		const sent = JSON.parse(mocks.generateText.mock.calls[0][0].prompt).recentConversation;
		expect(sent).toHaveLength(5);
		expect(sent[0].text[0]).toBe('2');
		expect(sent.at(-1).text[0]).toBe('6');
		expect(sent.every((entry: { text: string }) => entry.text.length === 1200)).toBe(true);
	});

	it('does not whitelist a mixed request merely because it mentions proghistory', async () => {
		mocks.generateText.mockResolvedValue({ output: { scope: 'outside' } });
		const result = await classifyProjectScope('project-1', rules, [
			message('user', 'Mostrami le irrigazioni e scrivi una ricetta di lasagne.'),
		]);
		expect(result).toBe('outside');
		expect(mocks.generateText).toHaveBeenCalledOnce();
	});

	it('returns the model clarification decision without turning it into an allow', async () => {
		mocks.generateText.mockResolvedValue({ output: { scope: 'unclear' } });
		expect(await classifyProjectScope('project-1', rules, [message('user', "Com'e andata?")])).toBe('unclear');
	});

	it('surfaces model unavailability to the caller instead of allowing the request', async () => {
		mocks.resolveProviderModel.mockResolvedValue(null);
		await expect(
			classifyProjectScope('project-1', rules, [message('user', 'Quante irrigazioni?')]),
		).rejects.toThrow('not configured');
		expect(mocks.generateText).not.toHaveBeenCalled();
	});

	it('surfaces classifier errors instead of allowing the request', async () => {
		mocks.generateText.mockRejectedValue(new Error('provider unavailable'));
		await expect(
			classifyProjectScope('project-1', rules, [message('user', 'Quante irrigazioni?')]),
		).rejects.toThrow('provider unavailable');
	});

	it('describes program execution history in refusal and clarification messages', () => {
		expect(OUTSIDE_PROJECT_SCOPE).toContain('esecuzioni');
		expect(UNCLEAR_PROJECT_SCOPE).toContain('esecuzioni');
	});
});
