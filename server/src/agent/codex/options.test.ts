import { expect, test } from 'bun:test';
import { threadParams } from './options.js';

test('the thread config adds the agentview server and leaves the user\'s other servers alone', () => {
  const { config, developerInstructions } = threadParams('chat-1');
  expect(Object.keys(config).filter((k) => k.startsWith('mcp_servers'))).toEqual(['mcp_servers.agentview']);
  expect(config['mcp_servers.agentview']).toMatchObject({ env: { AGENTVIEW_CHAT: 'chat-1' }, default_tools_approval_mode: 'approve' });
  expect(config.project_doc_fallback_filenames).toEqual(['CLAUDE.md']);
  expect(developerInstructions).toContain('mcp__agentview__set_status');
});
