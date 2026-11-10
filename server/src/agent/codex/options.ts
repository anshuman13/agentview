import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOCK } from '../../socket.js';
import { TOOL_INSTRUCTIONS } from '../tools/index.js';

const STDIO = path.join(path.dirname(fileURLToPath(import.meta.url)), '../tools/stdio.ts');

// What a thread gets besides its folder and policy. The dotted key adds our MCP server to the user's own [mcp_servers] table instead of replacing it.
export const threadParams = (chatId: string) => ({
  developerInstructions: TOOL_INSTRUCTIONS,
  config: {
    project_doc_fallback_filenames: ['CLAUDE.md'],
    'mcp_servers.agentview': { command: process.execPath, args: [STDIO], env: { AGENTVIEW_CHAT: chatId, AGENTVIEW_HOST_SOCK: SOCK }, default_tools_approval_mode: 'approve' },
  },
});
