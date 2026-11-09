import { createInterface } from 'node:readline';
import { callHost, mcpReply } from './mcp.js';
import { TOOLS } from './index.js';

// The MCP server codex starts for a chat: it lists the shared tools and runs each call in the agent host.
const { AGENTVIEW_CHAT: chat = '', AGENTVIEW_HOST_SOCK: sock = '' } = process.env;

createInterface({ input: process.stdin }).on('line', async (line) => {
  const reply = await mcpReply(JSON.parse(line), TOOLS, (name, args) => callHost(sock, chat, name, args));
  if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`);
});
