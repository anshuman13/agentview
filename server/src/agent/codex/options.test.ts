import { afterEach, expect, test, vi } from 'bun:test';
import { hubRows } from '../../integrations/assistant.js';
import { TOOL_INSTRUCTIONS } from '../tools/index.js';
import { stubGlobal, unstubAllGlobals } from '../../../../testing.js';
import { threadParams } from './options.js';

afterEach(() => unstubAllGlobals());

const mirror = (changes: unknown[]) => stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: 2, hasMore: false, changes }), { status: 200, headers: { 'content-type': 'application/json' } })));

test('the developer instructions carry the folder profile\'s live Memory claims after the tool instructions', async () => {
  mirror([]);
  await hubRows('facts');
  expect(threadParams('chat-1', '/tmp').developerInstructions).toBe(TOOL_INSTRUCTIONS);
  await hubRows('facts');
  const fact = (id: string, profile: string) => ({ table: 'facts', id, profile, deleted: false, updated_at: 2, fields: { state: 'live', at: Date.now(), text: `Claim ${id}` } });
  mirror([fact('w', 'work'), fact('p', 'personal')]);
  await hubRows('facts');
  const text = threadParams('chat-1', '/tmp').developerInstructions;
  expect(text.startsWith(TOOL_INSTRUCTIONS)).toBe(true);
  expect(text).toContain('- Claim w');
  expect(text).not.toContain('Claim p');
});

test('the thread config adds the agentview server and leaves the user\'s other servers alone', () => {
  const { config, developerInstructions } = threadParams('chat-1', '/tmp');
  expect(Object.keys(config).filter((k) => k.startsWith('mcp_servers'))).toEqual(['mcp_servers.agentview']);
  expect(config['mcp_servers.agentview']).toMatchObject({ env: { AGENTVIEW_CHAT: 'chat-1' }, default_tools_approval_mode: 'approve' });
  expect(config.project_doc_fallback_filenames).toEqual(['CLAUDE.md']);
  expect(config['tools.update_plan']).toEqual({ enabled: true });
  expect(developerInstructions).toContain('mcp__agentview__set_status');
});
