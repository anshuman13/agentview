// Stands in for the AgentView server and the hub during the e2e suite: Vite proxies /api here (AV_PORT).
import chat from './fixtures/chat.json';
import earlier from './fixtures/earlier.json';
import live from './fixtures/live.json';
import sessions from './fixtures/sessions.json';
import spawned from './fixtures/spawned.json';

const PORT = Number(process.env.STUB_PORT ?? 7788);
const enc = new TextEncoder();

// Fixture times are offsets from the first prompt, which the stub places a minute ago.
const shift = <T extends { at: number }>(events: T[], base: number) => events.map((e) => ({ ...e, at: base + e.at }));

function initMessages() {
  const base = Date.now() - 60_000;
  return [
    { type: 'init', state: { ...chat, events: shift(chat.events, base) }, boot: 1 },
    { type: 'live', chats: live.map((c) => ({ ...c, lastActive: Date.now() })) },
    { type: 'runs', runs: [] },
    { type: 'attention', items: [] },
  ];
}

const frame = (m: unknown) => enc.encode(`data: ${JSON.stringify(m)}\n\n`);

// The stream stays open after the init, as the server's does.
function events() {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode('retry: 60000\n\n'));
      for (const m of initMessages()) c.enqueue(frame(m));
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } });
}

const json = (body: unknown) => Response.json(body);

const GET: Record<string, (u: URL) => unknown> = {
  '/api/chat/events': () => ({ ...earlier, events: shift(earlier.events, Date.now() - 60_000) }),
  '/api/chat/spawned': (u) => (u.searchParams.get('session') === 's1' ? spawned : []),
  '/api/chat/subchats': () => [],
  '/api/assistant/changes': () => ({ version: 1, changes: [] }),
  '/api/sessions/seen': () => ({}),
  '/api/sessions': () => sessions.chats.map((c) => ({ ...c, lastModified: Date.now() - 3_600_000 })),
  '/api/repos': () => sessions.repos,
  '/api/git/status': () => ({ branch: 'main', ahead: 0, behind: 0, files: [] }),
  '/api/settings': () => ({ deploy: false, accountLabels: { main: 'Account 1', alt: 'Account 2', alt2: 'Account 3' } }),
};

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  idleTimeout: 0,
  fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === '/api/events') return events();
    if (u.pathname === '/api/cmd' || u.pathname === '/api/assistant/sync') return json({ ok: true, version: 1, changes: [] });
    const get = GET[u.pathname];
    if (get) return json(get(u));
    if (process.env.STUB_LOG) console.error('stub: unhandled, answered []', req.method, u.pathname);
    return json([]);
  },
});

console.log(`e2e stub on :${PORT}`);
