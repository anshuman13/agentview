import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { z } from 'zod';
import { expect, test } from 'bun:test';
import { lines } from '../../socket.js';
import { callTool, TOOLS } from './index.js';
import { callHost, mcpReply } from './mcp.js';
import { defineTool } from './tool.js';

const fake = defineTool({
  name: 'echo',
  description: 'Echo the chat id and text',
  schema: { text: z.string() },
  handler: async ({ text }, { chatId }) => `${chatId}:${text}`,
});

test('tools/list matches the registry', async () => {
  const r = (await mcpReply({ id: 1, method: 'tools/list' }, TOOLS, async () => '')) as { result: { tools: Array<{ name: string; description: string; inputSchema: { required?: string[] } }> } };
  expect(r.result.tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
  expect(r.result.tools.map((t) => t.description)).toEqual(TOOLS.map((t) => t.description));
  expect(r.result.tools.find((t) => t.name === 'wiki_propose')!.inputSchema.required).toEqual(['text']);
});

test('tools/call hands the name and arguments to the caller and turns a throw into an error result', async () => {
  const seen: unknown[] = [];
  const ok = await mcpReply({ id: 2, method: 'tools/call', params: { name: 'echo', arguments: { text: 'hi' } } }, [fake], async (name, args) => (seen.push([name, args]), 'done'));
  expect(seen).toEqual([['echo', { text: 'hi' }]]);
  expect(ok).toMatchObject({ id: 2, result: { content: [{ type: 'text', text: 'done' }] } });
  const bad = await mcpReply({ id: 3, method: 'tools/call', params: { name: 'echo' } }, [fake], async () => Promise.reject(new Error('boom')));
  expect(bad).toMatchObject({ result: { isError: true, content: [{ text: 'boom' }] } });
  expect(await mcpReply({ method: 'notifications/initialized' }, [fake], async () => '')).toBeNull();
});

test('callTool runs the handler with the chat and rejects bad arguments', async () => {
  const ctx = { cwd: '/tmp', chatId: 'chat-1', provider: 'claude' as const, host: { setStatus: () => undefined } };
  expect(await callTool('echo', { text: 'hi' }, ctx, [fake])).toBe('chat-1:hi');
  await expect(callTool('echo', { text: 1 }, ctx, [fake])).rejects.toThrow();
  await expect(callTool('nope', {}, ctx, [fake])).rejects.toThrow('No tool nope');
});

test('callHost sends one tool_call request for the chat and returns its reply', async () => {
  const sock = path.join(mkdtempSync(path.join(os.tmpdir(), 'av-')), 'host.sock');
  const got: unknown[] = [];
  const server = net.createServer((c) => {
    const send = lines(c, (v) => {
      got.push(v);
      send({ n: (v as { n: number }).n, ok: true, r: 'done' });
    });
  });
  await new Promise<void>((ok) => server.listen(sock, ok));
  try {
    expect(await callHost(sock, 'chat-1', 'set_status', { text: 'x' })).toBe('done');
    expect(got).toEqual([{ n: 1, op: 'tool_call', id: 'chat-1', name: 'set_status', args: { text: 'x' } }]);
  } finally {
    server.close();
  }
});
