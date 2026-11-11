import type { ServerWebSocket } from 'bun';
import { chromeRunning, endpoint } from './launch.js';

const PORT = Number(process.env.AGENTVIEW_RELAY_PORT ?? 7779);
const TOKEN = process.env.AGENTVIEW_RELAY_TOKEN ?? '';
const MAX = 512 * 1024 * 1024;

let chrome: WebSocket | null = null;
let opening: Promise<WebSocket> | null = null;
let client: ServerWebSocket | null = null;
const attaching = new Set<number>();
const sessions = new Set<string>();

async function statusFor(err: unknown) {
  const m = (err as Error)?.message ?? '';
  if (m === 'nofda') return 451;
  if (m === 'nochrome') return 410;
  if (m === 'disabled' || /\b404\b/.test(m)) return 404;
  if (/ECONNREFUSED|Failed to connect/.test(m)) return (await chromeRunning()) ? 404 : 410;
  if (/\b403\b/.test(m)) return 403;
  if (/timed out/i.test(m)) return 504;
  return 502;
}

function open(): Promise<WebSocket> {
  if (chrome?.readyState === WebSocket.OPEN) return Promise.resolve(chrome);
  opening ??= (async () => {
    const ws = new WebSocket(await endpoint());
    ws.binaryType = 'arraybuffer';
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Opening Chrome timed out'));
        ws.close();
      }, 60_000);
      ws.addEventListener('open', () => (clearTimeout(timer), resolve()), { once: true });
      ws.addEventListener('error', (e) => (clearTimeout(timer), reject(new Error((e as ErrorEvent).message))), { once: true });
    });
    ws.addEventListener('message', (e) => {
      const data = e.data as string | ArrayBuffer;
      if (attaching.size && typeof data === 'string' && data.startsWith('{"id":')) {
        try {
          const m = JSON.parse(data);
          if (attaching.delete(m.id) && m.result?.sessionId) sessions.add(m.result.sessionId);
        } catch {}
      }
      if (client?.readyState === WebSocket.OPEN) client.send(data);
    });
    ws.addEventListener('close', () => {
      chrome = null;
      sessions.clear();
      attaching.clear();
      client?.close(1011, 'closed');
    });
    chrome = ws;
    return ws;
  })().finally(() => {
    opening = null;
  });
  return opening;
}

function release() {
  let id = 1_000_000_000;
  sessions.forEach((sessionId) => chrome?.send(JSON.stringify({ id: id++, method: 'Target.detachFromTarget', params: { sessionId } })));
  sessions.clear();
  attaching.clear();
}

function attach(ws: ServerWebSocket) {
  // Chrome closed while this client was upgrading; its close handler already ran, so nothing would end this client.
  if (chrome?.readyState !== WebSocket.OPEN) return ws.close(1011, 'closed');
  client?.close(1000, 'replaced');
  release();
  client = ws;
}

function relay(data: string | Buffer) {
  const s = String(data);
  if (s.includes('"Target.attachToTarget"')) {
    try {
      attaching.add(JSON.parse(s).id);
    } catch {}
  } else if (s.includes('"Target.detachFromTarget"')) {
    try {
      sessions.delete(JSON.parse(s).params?.sessionId);
    } catch {}
  }
  chrome?.send(data);
}

if (!TOKEN) {
  console.error('relay: AGENTVIEW_RELAY_TOKEN is not set');
  process.exit(1);
}

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  async fetch(req, server) {
    const url = new URL(req.url);
    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response(chrome ? 'on' : 'off', { headers: { 'content-type': 'text/plain' } });
    if (req.headers.get('origin') || url.pathname !== `/${TOKEN}`) return new Response(null, { status: 401 });
    try {
      await open();
    } catch (err) {
      return new Response(null, { status: await statusFor(err) });
    }
    return server.upgrade(req) ? undefined : new Response(null, { status: 400 });
  },
  websocket: {
    maxPayloadLength: MAX,
    idleTimeout: 0,
    sendPings: false,
    open: attach,
    message: (ws, data) => {
      if (client === ws) relay(data);
    },
    close: (ws) => {
      if (client !== ws) return;
      client = null;
      release();
    },
  },
});
console.log(`chrome relay on 127.0.0.1:${PORT}`);
