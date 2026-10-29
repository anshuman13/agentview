import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { callTool, data, expandDef, listTools, pidOf, stopAll, text } from './mcpClient.js';

const FAKE = `
let buf = '';
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
process.stdin.setEncoding('utf8').on('data', (c) => {
  buf += c;
  const lines = buf.split('\\n');
  buf = lines.pop();
  for (const l of lines) {
    if (!l.trim()) continue;
    const m = JSON.parse(l);
    if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: {}, serverInfo: { name: 'fake' } } });
    else if (m.method === 'notifications/initialized') process.stderr.write('ready\\n');
    else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'echo', inputSchema: { type: 'object' } }, { name: 'slow' }, { name: 'die' }, { name: 'fail' }] } });
    else if (m.method === 'tools/call') {
      const { name, arguments: args } = m.params;
      if (name === 'echo') {
        const out = JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify({ got: args, env: process.env.FAKE_FLAG, pid: process.pid }) }] } }) + '\\n';
        process.stdout.write(out.slice(0, 20));
        setTimeout(() => process.stdout.write(out.slice(20)), 20);
      } else if (name === 'fail') send({ jsonrpc: '2.0', id: m.id, result: { isError: true, content: [{ type: 'text', text: 'nope' }] } });
      else if (name === 'die') { process.stderr.write('fatal: giving up\\n'); process.exit(3); }
    } else send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'unknown method ' + m.method } });
  }
});
`;

const def = { command: process.execPath, args: ['-e', FAKE], env: { FAKE_FLAG: 'on' } };

afterAll(stopAll);

describe('mcpClient', () => {
  it('initializes, lists tools and calls a tool across split frames', async () => {
    const tools = await listTools('fake', def);
    expect(tools.map((t) => t.name)).toEqual(['echo', 'slow', 'die', 'fail']);
    const r = await callTool('fake', def, 'echo', { a: 1 });
    expect(data(r)).toMatchObject({ got: { a: 1 }, env: 'on' });
    expect(text(r)).toContain('"a":1');
  });

  it('turns isError results and JSON-RPC errors into exceptions', async () => {
    await expect(callTool('fake', def, 'fail')).rejects.toThrow('fail: nope');
  });

  it('times out a call that never answers', async () => {
    await expect(callTool('fake', def, 'slow', {}, 200)).rejects.toThrow(/timed out after 200ms/);
  });

  it('reports stderr when the server exits and restarts it on the next call', async () => {
    const pid = pidOf('fake');
    await expect(callTool('fake', def, 'die')).rejects.toThrow(/exited \(3\): .*fatal: giving up/s);
    const r = await callTool('fake', def, 'echo', {});
    expect((data(r) as { pid: number }).pid).not.toBe(pid);
    expect(pidOf('fake')).not.toBe(pid);
  });

  it('fails clearly when the command does not exist', async () => {
    await expect(listTools('missing', { command: '/nonexistent/mcp-server' }, 2000)).rejects.toThrow(/failed to start|exited/);
  });
});

describe('expandDef', () => {
  it('expands ${VAR} and ${VAR:-default} from the environment and the server env', () => {
    const def = { command: '${BIN:-npx}', args: ['--db', '${DB}', '${NOPE}'], env: { DB: '${HOME}/db', T: '${TOKEN}' }, url: 'https://${HOST:-x.io}/mcp', headers: { auth: 'Bearer ${TOKEN}' } };
    expect(expandDef(def, { HOME: '/h', TOKEN: 't', HOST: 'y.io' })).toEqual({
      command: 'npx', args: ['--db', '/h/db', '${NOPE}'], env: { DB: '/h/db', T: 't' }, url: 'https://y.io/mcp', headers: { auth: 'Bearer t' },
    });
  });
});

describe('http transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    stopAll('web');
  });

  const reply = (body: unknown, init: ResponseInit = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), init);

  it('starts a new session after the server answers 404 to an expired one', async () => {
    let inits = 0;
    let expired = false;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const m = JSON.parse(init.body as string);
      if (m.method === 'initialize') {
        inits++;
        return reply({ jsonrpc: '2.0', id: m.id, result: { serverInfo: { name: 'web' } } }, { headers: { 'mcp-session-id': `s${inits}`, 'content-type': 'application/json' } });
      }
      if (!m.id) return reply('', { status: 202 });
      if (!expired) {
        expired = true;
        return reply('gone', { status: 404 });
      }
      return reply({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'a' }] } });
    });
    const def = { url: 'http://x.test/mcp' };
    await expect(listTools('web', def)).rejects.toThrow(/session expired/);
    expect(await listTools('web', def)).toEqual([{ name: 'a' }]);
    expect(inits).toBe(2);
  });

  it('skips SSE data lines that are not JSON', async () => {
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const m = JSON.parse(init.body as string);
      if (!m.id) return reply('', { status: 202 });
      const result = m.method === 'initialize' ? {} : { tools: [{ name: 'b' }] };
      return reply(`data: not json\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result })}\n`, { headers: { 'content-type': 'text/event-stream' } });
    });
    expect(await listTools('web', { url: 'http://x.test/mcp' })).toEqual([{ name: 'b' }]);
  });
});
