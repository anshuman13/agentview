import net from 'node:net';
import { z } from 'zod';
import { errText } from '../../../../shared/util.js';
import { lines, type HostLine } from '../../host/protocol.js';
import type { Tool } from './tool.js';

type Message = { id?: number | string; method: string; params?: any };

const text = (t: string, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError && { isError }) });

// The reply to one MCP message over stdio (initialize, tools/list, tools/call); null for a notification.
export async function mcpReply(msg: Message, tools: Tool[], call: (name: string, args: unknown) => Promise<string>): Promise<object | null> {
  if (msg.id === undefined) return null;
  const reply = (result: object) => ({ jsonrpc: '2.0', id: msg.id, result });
  switch (msg.method) {
    case 'initialize':
      return reply({ protocolVersion: msg.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'agentview', version: '1' } });
    case 'tools/list':
      return reply({ tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: z.toJSONSchema(z.object(t.schema), { io: 'input' }) })) });
    case 'tools/call':
      return reply(await call(msg.params.name, msg.params.arguments ?? {}).then((t) => text(t), (err) => text(errText(err), true)));
    case 'ping':
      return reply({});
    default:
      return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Unknown method ${msg.method}` } };
  }
}

// One tool call as one request on its own connection to the agent host, which runs it against the chat.
export function callHost(sock: string, chat: string, name: string, args: unknown) {
  return new Promise<string>((ok, fail) => {
    const conn = net.connect(sock);
    const send = lines(conn, (v) => {
      const line = v as HostLine & { n: number };
      conn.destroy();
      if ('ok' in line && line.ok) ok(String(line.r));
      else fail(new Error('error' in line ? line.error : 'Bad reply from the agent host'));
    });
    conn.on('connect', () => send({ n: 1, op: 'tool_call', id: chat, name, args }));
    conn.on('error', fail);
    conn.on('close', () => fail(new Error('The agent host closed the connection')));
  });
}
