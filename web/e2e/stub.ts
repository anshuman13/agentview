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
    { type: 'runs', runs: [buildRun(base)] },
    { type: 'attention', items: [] },
  ];
}

// A running build on the open chat, so its header shows the task line.
const buildRun = (at: number) => ({
  id: 'r1', kind: 'build', sessionId: 's1', chatId: 'c1', title: 'Build', what: '', startedAt: at, endedAt: null, state: 'running', why: '',
  round: 3, max: 9, nextAt: null, rounds: [], needsYou: false, phase: 'task', progress: '2 of 9',
  task: 'Clean up the session list (user, 27 Nov 21:52, compare the list in the reference shots): (1) a chat subtitle shows a helper branch, (2) idle rows need a ring dot, (3) build rows show Running',
});

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

const branchDiff = {
  files: [{ path: 'src/login.ts', additions: 3, deletions: 1 }],
  diff: 'diff --git a/src/login.ts b/src/login.ts\n--- a/src/login.ts\n+++ b/src/login.ts\n@@ -1,3 +1,5 @@\n-const ttl = 60;\n+const ttl = 3600;\n+const user = find(id);\n+return user;\n',
};

const GET: Record<string, (u: URL) => unknown> = {
  '/api/chat/events': () => ({ ...earlier, events: shift(earlier.events, Date.now() - 60_000) }),
  '/api/chat/spawned': (u) => (u.searchParams.get('session') === 's1' ? spawned : []),
  '/api/chat/subchats': () => [],
  '/api/assistant/changes': () => ({ version: 1, changes: [] }),
  '/api/sessions/seen': () => ({}),
  '/api/sessions': () => sessions.chats.map((c) => ({ ...c, lastModified: Date.now() - 3_600_000 })),
  '/api/repos': () => sessions.repos,
  '/api/git/status': () => ({
    branch: 'fix-login', ahead: 2, behind: 0, hashes: { 'w:src/login.ts': 'a1', 's:src/session/a-rather-long-folder-name/store.ts': 'b2' },
    files: [{ path: 'src/login.ts', status: 'M', staged: false }, { path: 'src/session/a-rather-long-folder-name/store.ts', status: 'A', staged: true }],
  }),
  '/api/git/branches': () => ({ branches: ['main', 'fix-login'], base: 'main' }),
  '/api/git/branch': () => ({ ...branchDiff, base: 'main', commits: [{ hash: 'abc1234', subject: 'Keep the user signed in for an hour after login', at: Date.now() - 3_600_000 }, { hash: 'def5678', subject: 'Add a test', at: Date.now() - 7_200_000 }] }),
  '/api/git/show': () => branchDiff,
  '/api/gh/prs': () => [{ number: 6, title: 'Test PR', author: 'me', branch: 'fix-login', draft: true, review: '', checks: 'failure', updatedAt: '', url: 'https://github.com/o/r/pull/6', sha: '', additions: 3, deletions: 2, mine: true, reviewRequested: false }],
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
