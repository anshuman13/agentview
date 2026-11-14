// Starts the real server against a fake agent host and talks to it over HTTP, SSE and WebSockets.
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { waitFor } from '../../testing.js';

const home = mkdtempSync('/tmp/av-e2e-');
const cwd = path.join(home, 'project');
mkdirSync(path.join(home, '.agentview'), { recursive: true });
mkdirSync(cwd);
const chat = { id: 'c1', sessionId: 's1', cwd, title: 'Test', running: false, pending: 0, status: '', lastActive: 0 };
const asked: Record<string, unknown>[] = [];
let toServer: ((v: unknown) => void) | null = null;
let server: Bun.Subprocess;
let port = 0;
let base = '';

const freePort = () =>
  new Promise<number>((ok) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => ok(p));
    });
  });

// Answers the server like the agent host does: newline-delimited JSON over a unix socket.
function fakeHost() {
  const sock = path.join(home, '.agentview', `host-${port}.sock`);
  return net
    .createServer((s) => {
      let buf = '';
      s.setEncoding('utf8');
      toServer = (v) => s.write(`${JSON.stringify(v)}\n`);
      s.on('data', (chunk: string) => {
        buf += chunk;
        for (let i; (i = buf.indexOf('\n')) >= 0; ) {
          const req = JSON.parse(buf.slice(0, i));
          buf = buf.slice(i + 1);
          asked.push(req);
          if (!req.n) continue;
          const r = req.op === 'hello' ? { last: 'c1', restarting: false, chats: [chat], runs: [] } : req.op === 'state' ? { rows: [], id: req.id, pad: 'x'.repeat(4000) } : null;
          toServer!({ n: req.n, ok: true, r });
        }
      });
    })
    .listen(sock);
}

let host: net.Server;
beforeAll(async () => {
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  host = fakeHost();
  server = Bun.spawn(['bun', path.join(import.meta.dir, 'index.ts'), cwd], {
    env: { ...process.env, HOME: home, PORT: String(port), AGENTVIEW_DEV_WEB: '' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  await waitFor(async () => {
    const r = await fetch(`${base}/api/runs`);
    if (!r.ok) throw new Error(String(r.status));
  }, { timeout: 15_000, interval: 100 });
  await waitFor(() => expect(asked.some((r) => r.op === 'hello')).toBe(true));
});

afterAll(async () => {
  server.kill();
  await server.exited;
  host.close();
  rmSync(home, { recursive: true, force: true });
});

// Reads server-sent events until `until` holds for the events so far.
async function readEvents(res: Response, until: (events: { id?: string; data: any }[]) => boolean) {
  const reader = res.body!.getReader();
  const events: { id?: string; data: any }[] = [];
  let buf = '';
  const text = new TextDecoder();
  const deadline = Date.now() + 5_000;
  while (!until(events)) {
    if (Date.now() > deadline) throw new Error(`timed out with ${JSON.stringify(events.map((e) => e.data?.type))}`);
    const { value, done } = await reader.read();
    if (done) break;
    buf += text.decode(value, { stream: true });
    for (let i; (i = buf.indexOf('\n\n')) >= 0; ) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const id = block.match(/^id: (.*)$/m)?.[1];
      const data = block.match(/^data: (.*)$/m)?.[1];
      if (data) events.push({ id, data: JSON.parse(data) });
    }
  }
  reader.releaseLock();
  return events;
}

const types = (events: { data: any }[]) => events.map((e) => e.data.type);

function openWs(query: string, headers: Record<string, string> = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?${query}`, { headers } as never);
  const got: any[] = [];
  const closed = new Promise<number>((ok) => ws.addEventListener('close', (e) => ok(e.code)));
  ws.addEventListener('message', (e) => got.push(typeof e.data === 'string' ? e.data : String(e.data)));
  const opened = new Promise<void>((ok, fail) => {
    ws.addEventListener('open', () => ok());
    ws.addEventListener('error', () => fail(new Error('ws error')));
  });
  return { ws, got, opened, closed };
}

describe('http', () => {
  it('answers JSON, gzipped when asked and large enough', async () => {
    const r = await fetch(`${base}/api/runs`);
    expect(r.headers.get('content-type')).toBe('application/json');
    expect(await r.json()).toEqual([]);
  });

  it('gzips a JSON reply over 1 KB', async () => {
    const r = await fetch(`${base}/api/state?chat=c1`, { headers: { 'accept-encoding': 'gzip' }, decompress: false } as RequestInit);
    expect(r.headers.get('content-encoding')).toBe('gzip');
    expect(JSON.parse(gunzipSync(Buffer.from(await r.arrayBuffer())).toString()).pad).toHaveLength(4000);
  });

  it('reads a JSON body and turns a thrown error into a 500', async () => {
    const ok = await fetch(`${base}/api/cmd?chat=c1`, { method: 'POST', body: JSON.stringify({ type: 'stop' }) });
    expect(await ok.json()).toEqual({ ok: true });
    await waitFor(() => expect(asked.some((r) => r.op === 'cmd' && (r.msg as { type: string }).type === 'stop')).toBe(true));
    const bad = await fetch(`${base}/api/cmd?chat=c1`, { method: 'POST', body: JSON.stringify({}) });
    expect(bad.status).toBe(500);
    expect(await bad.json()).toEqual({ error: 'Bad command' });
  });

  it('refuses a foreign Host or a cross-site Origin with 403', async () => {
    expect((await fetch(`${base}/api/runs`, { headers: { host: 'evil.example' } })).status).toBe(403);
    expect((await fetch(`${base}/api/runs`, { headers: { origin: 'http://evil.example' } })).status).toBe(403);
  });

  it('answers a preflight from the bundled app origin', async () => {
    const r = await fetch(`${base}/api/runs`, { method: 'OPTIONS', headers: { origin: 'tauri://localhost', 'access-control-request-method': 'POST' } });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe('tauri://localhost');
  });

  it('saves a pasted file', async () => {
    const r = await fetch(`${base}/api/paste?name=a.txt`, { method: 'POST', body: 'pasted' });
    const { path: file } = (await r.json()) as { path: string };
    expect(await Bun.file(file).text()).toBe('pasted');
  });
});

describe('event stream', () => {
  it('greets, relays host broadcasts with ids, and resumes from Last-Event-ID', async () => {
    const first = await fetch(`${base}/api/events?chat=c1&cid=a`);
    expect(first.headers.get('content-type')).toBe('text/event-stream');
    const greeting = await readEvents(first, (e) => types(e).includes('init'));
    expect(types(greeting)).toEqual(expect.arrayContaining(['live', 'runs', 'attention', 'init']));
    toServer!({ chat: 'c1', m: { type: 'status', text: 'one' } });
    toServer!({ chat: 'c1', m: { type: 'status', text: 'two' } });
    const relayed = await readEvents(first, (e) => e.length >= 2);
    expect(relayed.map((e) => e.data.text)).toEqual(['one', 'two']);
    await first.body!.cancel();

    const again = await fetch(`${base}/api/events?chat=c1&cid=a`, { headers: { 'last-event-id': relayed[0].id! } });
    const replay = await readEvents(again, (e) => e.some((x) => x.data.text === 'two'));
    expect(replay[0].data).toEqual({ type: 'status', text: 'two' });
    expect(types(replay)).not.toContain('init');
    await again.body!.cancel();
  });

  it('counts a stream as a viewer and drops it when the client goes', async () => {
    const res = await fetch(`${base}/api/events?chat=c1&cid=b`);
    await readEvents(res, (e) => types(e).includes('init'));
    const viewers = () => asked.filter((r) => r.op === 'viewers').at(-1) as { counts: Record<string, number> } | undefined;
    await waitFor(() => expect(viewers()?.counts.c1).toBe(1));
    await res.body!.cancel();
    await waitFor(() => expect(viewers()?.counts.c1).toBeUndefined());
  });
});

describe('websocket', () => {
  it('refuses an upgrade from a cross-site page', async () => {
    const { opened } = openWs('chrome', { origin: 'http://evil.example' });
    expect(await opened.then(() => 'open', () => 'refused')).toBe('refused');
  });

  it('runs a terminal: input goes in, output comes back', async () => {
    const { id } = (await (await fetch(`${base}/api/terms?chat=c1`, { method: 'POST' })).json()) as { id: string };
    const { ws, got, opened, closed } = openWs(`term=${id}`);
    await opened;
    ws.send(JSON.stringify({ t: 'i', d: 'echo $((40+2))\n' }));
    await waitFor(() => expect(got.join('')).toContain('42'), { timeout: 5_000 });
    await fetch(`${base}/api/terms?chat=c1&id=${id}`, { method: 'DELETE' });
    expect(await closed).toBe(4404);
  });

  it('closes an unknown terminal with 4404', async () => {
    expect(await openWs('term=nope').closed).toBe(4404);
  });

  it('closes a socket that asks for neither a terminal nor Chrome', async () => {
    expect(await openWs('chat=c1').closed).toBe(4400);
  });
});

// A Mac address that is neither loopback nor a NetBird peer.
const lan = Object.values(os.networkInterfaces()).flat().find((a) => a?.family === 'IPv4' && !a.internal && !a.address.startsWith('100.'))?.address;

describe.skipIf(!lan)('peers', () => {
  it('refuses a request from an address outside NetBird', async () => {
    const r = await fetch(`http://${lan}:${port}/api/runs`, { headers: { host: `127.0.0.1:${port}` } }).then((x) => x.status, () => 'dropped');
    expect([403, 'dropped']).toContain(r);
  });
});
