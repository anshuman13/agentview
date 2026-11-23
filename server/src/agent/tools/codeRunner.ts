import { callTool, data, listTools, stopAll, type McpServerDef } from '../../integrations/mcpClient.js';

// Runs one run_code script with the chat's MCP servers as functions, then stops the servers it started.
const servers: Record<string, McpServerDef> = JSON.parse(process.env.AGENTVIEW_MCP ?? '{}');
const CALL_TIMEOUT = 120_000;

function def(server: string) {
  const d = servers[server];
  if (!d) throw new Error(`No MCP server ${server}. Servers: ${Object.keys(servers).join(', ') || 'none'}`);
  return d;
}

Object.assign(globalThis, {
  listMCPServers: () => Object.keys(servers),
  listMCPTools: async (server: string) => (await listTools(`code:${server}`, def(server), CALL_TIMEOUT)).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  callMCPTool: async (server: string, tool: string, args: Record<string, unknown> = {}) => data(await callTool(`code:${server}`, def(server), tool, args, CALL_TIMEOUT, process.cwd())),
});

process.on('SIGTERM', () => {
  stopAll();
  process.exit(143);
});

let code = 0;
try {
  await import(process.argv[2]!);
} catch (err) {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  code = 1;
}
stopAll();
process.exit(code);
