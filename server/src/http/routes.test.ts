import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import type { LiveChat } from '../../../shared/protocol.js';

const mocks = {
  scheduleFocus: vi.fn(),
  cancelFocus: vi.fn(),
  listRepos: vi.fn(),
  isWorkspaceRepo: vi.fn(),
  createWorktree: vi.fn(),
  listSessions: vi.fn(),
  removeChat: vi.fn(),
  listBin: vi.fn(),
  listTerminals: vi.fn(),
  listLinks: vi.fn(async () => ({})),
  listSpawned: vi.fn(async () => ({})),
  groupOf: vi.fn(async (id: string) => [id]),
  restoreSession: vi.fn(),
  searchMessages: vi.fn(),
  savedEvents: vi.fn(),
  firstCommit: vi.fn(async () => null),
};

vi.mock('../integrations/focus.js', () => ({ scheduleFocus: mocks.scheduleFocus, cancelFocus: mocks.cancelFocus }));
vi.mock('../workspace/worktrees.js', () => ({ listRepos: mocks.listRepos, isWorkspaceRepo: mocks.isWorkspaceRepo, listWorktrees: vi.fn(), createWorktree: mocks.createWorktree, createFolder: vi.fn(), removeWorktree: vi.fn(), removeRunWorktree: vi.fn(), worktreeBase: async () => { throw new Error('paseo is not installed'); } }));
vi.mock('../agent/claude/sessions.js', () => ({ listSessions: mocks.listSessions, savedSession: (x: unknown) => x, renameRoute: vi.fn() }));
vi.mock('../agent/claude/pins.js', () => ({ removeChat: mocks.removeChat, pinsRoute: vi.fn() }));
vi.mock('../agent/claude/bin.js', () => ({ listBin: mocks.listBin, emptyBin: vi.fn(), restoreSession: mocks.restoreSession }));
const realSub = await import('../session/subChats.js');
vi.mock('../session/subChats.js', () => ({ listLinks: mocks.listLinks, groupOf: mocks.groupOf, latestOf: async (id: string) => (await mocks.groupOf(id)).at(-1), roundOf: realSub.roundOf }));
vi.mock('../session/spawned.js', () => ({ listSpawned: mocks.listSpawned, rowOf: (id: string) => mocks.groupOf(id) }));
vi.mock('../agent/claude/savedChat.js', () => ({ savedEvents: mocks.savedEvents, firstCommit: mocks.firstCommit }));
vi.mock('../agent/claude/search.js', () => ({ searchMessages: mocks.searchMessages }));
vi.mock('../workspace/terminal.js', () => ({ listTerminals: mocks.listTerminals, createTerminal: vi.fn(), closeTerminal: vi.fn() }));

import type { RouteDeps } from './routes.js';
const { createRoutes } = await import('./routes.js');
const accounts = await import('../agent/claude/accounts.js');

const chat = { id: 'c1', cwd: '/tmp/x' } as LiveChat;

async function call(method: string, path: string, body?: string, deps: Partial<RouteDeps> = {}) {
  const serveWeb = vi.fn(async () => null);
  const { dispatch } = createRoutes({ chats: () => new Map([['c1', chat]]), lastViewed: () => 'c1', bySession: () => undefined, serveWeb, ...deps } as unknown as RouteDeps);
  const res = await dispatch(new Request(new URL(path, 'http://x'), { method, body }), new URL(path, 'http://x'), '127.0.0.1');
  const text = await res.text();
  return { code: res.status, text, serveWeb, json: text ? JSON.parse(text) : undefined };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.groupOf.mockImplementation(async (id: string) => [id]);
});

describe('routes', () => {
  it('picks the method key before the ANY key', async () => {
    mocks.removeChat.mockResolvedValue({ removed: true });
    mocks.listSessions.mockResolvedValue([{ sessionId: 's' }]);
    mocks.listBin.mockResolvedValue([]);
    expect((await call('DELETE', '/api/sessions?id=s')).json).toEqual({ removed: true });
    expect((await call('GET', '/api/sessions')).json).toEqual([{ sessionId: 's' }]);
    mocks.listTerminals.mockReturnValue(['t']);
    expect((await call('PUT', '/api/terms')).json).toEqual(['t']);
  });

  it('streams the chat of the latest sub-chat for any session of its group', async () => {
    mocks.groupOf.mockResolvedValue(['root', 'kid']);
    const openEvents = vi.fn(() => new Response(''));
    const bySession = (id: string) => (id === 'kid' ? 'c2' : undefined);
    await call('GET', '/api/events?session=root', undefined, { bySession, openEvents } as Partial<RouteDeps>);
    const [, url, id, found] = openEvents.mock.calls[0] as unknown as [Request, URL, string, boolean];
    expect([url.searchParams.get('session'), id, found]).toEqual(['kid', 'c2', true]);
  });

  it('archives and restores every session of a sub-chat group', async () => {
    mocks.groupOf.mockResolvedValue(['root', 'kid']);
    mocks.removeChat.mockResolvedValue({ purged: false });
    const closeByUser = vi.fn();
    const live = { id: 'k' } as LiveChat;
    const bySession = (id: string) => (id === 'kid' ? live : undefined);
    expect((await call('DELETE', '/api/sessions?id=kid&archive', undefined, { bySession, closeByUser } as Partial<RouteDeps>)).json).toEqual({ purged: false });
    expect(mocks.removeChat.mock.calls).toEqual([['root', false, true], ['kid', false, true]]);
    expect(closeByUser).toHaveBeenCalledWith(live);
    await call('POST', '/api/sessions/restore?id=root');
    expect(mocks.restoreSession.mock.calls).toEqual([['root'], ['kid']]);
  });

  it('returns sub-chat links with saved sessions and search hits', async () => {
    mocks.listSessions.mockResolvedValue([{ sessionId: 'root', lastModified: 1, summary: 'Root', cwd: '/r' }, { sessionId: 'kid', lastModified: 2, summary: 'Kid', cwd: '/r' }]);
    mocks.listBin.mockResolvedValue([]);
    mocks.listLinks.mockResolvedValue({ kid: { parent: 'root', via: 'build', at: 5 } });
    mocks.listSpawned.mockResolvedValue({ kid: { parent: 'other', kind: 'build', at: 6 } });
    expect((await call('GET', '/api/sessions')).json).toEqual([
      { sessionId: 'kid', lastModified: 2, summary: 'Kid', cwd: '/r', parentId: 'root', via: 'build', startedAt: 5, spawnedBy: 'other' },
      { sessionId: 'root', lastModified: 1, summary: 'Root', cwd: '/r' },
    ]);
    mocks.listSpawned.mockResolvedValue({});
    expect(mocks.listSessions).toHaveBeenCalledWith({ limit: 1000 });
    mocks.searchMessages.mockResolvedValue([{ sessionId: 'kid', role: 'user', text: 'x', at: '' }, { sessionId: 'root', role: 'user', text: 'y', at: '' }]);
    expect((await call('GET', '/api/sessions/search?q=x')).json).toEqual([
      { sessionId: 'kid', role: 'user', text: 'x', at: '', title: 'Kid', cwd: '/r', parentId: 'root' },
      { sessionId: 'root', role: 'user', text: 'y', at: '', title: 'Root', cwd: '/r' },
    ]);
  });

  it('lists the earlier sub-chats of a chat with their round and commit', async () => {
    mocks.groupOf.mockResolvedValue(['root', 'kid', 'now']);
    mocks.listSessions.mockResolvedValue([
      { sessionId: 'root', summary: 'Root', firstPrompt: 'Build run, task 1 of 3.', createdAt: 1, lastModified: 9 },
      { sessionId: 'kid', summary: 'Kid', firstPrompt: 'Build run, task 2 of 3.', lastModified: 19 },
    ]);
    mocks.listLinks.mockResolvedValue({ kid: { parent: 'root', via: 'build', at: 10 }, now: { parent: 'root', via: 'build', at: 20 } });
    mocks.firstCommit.mockImplementation(async (id: string) => (id === 'kid' ? { hash: 'a1b2c3d', subject: 'Add the store' } : null) as never);
    const rounds = [{ n: 1, at: 8, outcome: 'done', line: 'one', costUsd: 0 }, { n: 2, at: 18, outcome: 'done', line: 'two', costUsd: 0, sessionId: 'kid' }];
    const r = await call('GET', '/api/chat/subchats?session=now', undefined, { runs: () => [{ sessionId: 'root', rounds }, { sessionId: 'other', rounds: [{ n: 9, at: 9 }] }] } as unknown as Partial<RouteDeps>);
    expect(r.json).toEqual([
      { sessionId: 'root', title: 'Build run, task 1 of 3.', startedAt: 1, round: rounds[0] },
      { sessionId: 'kid', title: 'Build run, task 2 of 3.', startedAt: 10, round: rounds[1], commit: { hash: 'a1b2c3d', subject: 'Add the store' } },
    ]);
  });

  it('lists the builds a chat started with their state, task counts and last round', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'spawned-'));
    await Bun.write(path.join(dir, '.claude/specs/x.md'), '- [x] one\n- [ ] two\n- [ ] three\n');
    mocks.groupOf.mockImplementation(async (id: string) => (id === 'now' ? ['root', 'now'] : id === 'b1' ? ['b1', 'b1b'] : [id]));
    mocks.listSessions.mockResolvedValue([{ sessionId: 'b1', title: 'Build one' }]);
    mocks.listSpawned.mockResolvedValue({ b2: { parent: 'now', kind: 'build', at: 9 }, b1: { parent: 'root', kind: 'build', at: 5 }, b3: { parent: 'other', kind: 'build', at: 1 } });
    const runs = [
      { kind: 'build', sessionId: 'b1b', chatId: 'c1', title: 'Build: x', state: 'running', why: '', phase: 'task', spec: '.claude/specs/x.md', cwd: dir, rounds: [{ line: 'Added it' }], needsYou: false },
      { kind: 'build', sessionId: 'b2', chatId: 'gone', title: 'Build: y', state: 'done', why: 'you stopped it', rounds: [], needsYou: false },
    ];
    const r = await call('GET', '/api/chat/spawned?session=now', undefined, { runs: () => runs } as unknown as Partial<RouteDeps>);
    mocks.listSpawned.mockResolvedValue({});
    rmSync(dir, { recursive: true });
    expect(r.json).toEqual([
      { chatId: 'c1', sessionId: 'b1', title: 'Build one', state: 'running', done: 1, total: 3, round: 'Added it' },
      { sessionId: 'b2', title: 'Build: y', state: 'stopped', done: 0, total: 0 },
    ]);
  });

  it('maps a build run to the card state', async () => {
    const { buildCardState } = await import('./openRoutes.js');
    const run = (p: object) => ({ state: 'running', why: '', needsYou: false, ...p }) as never;
    expect(buildCardState(undefined)).toBe('spec');
    expect(buildCardState(run({ phase: 'spec' }))).toBe('spec');
    expect(buildCardState(run({ phase: 'task' }))).toBe('running');
    expect(buildCardState(run({ state: 'paused', why: 'Approve the spec: Build all', needsYou: true }))).toBe('approval');
    expect(buildCardState(run({ state: 'paused', why: 'Needs you: a task is blocked', needsYou: true }))).toBe('needs');
    expect(buildCardState(run({ state: 'paused', why: 'Paused by you' }))).toBe('paused');
    expect(buildCardState(run({ state: 'done', why: 'all tasks done' }))).toBe('done');
  });

  it('pages a saved sub-chat\'s events and answers 404 without a transcript', async () => {
    mocks.savedEvents.mockResolvedValue(['a', 'b', 'c', 'd'].map((id) => ({ id, kind: 'user', text: id, at: 0 })));
    expect((await call('GET', '/api/chat/subchat-events?session=kid&limit=2')).json).toEqual({ events: [{ id: 'c', kind: 'user', text: 'c', at: 0 }, { id: 'd', kind: 'user', text: 'd', at: 0 }], earlier: 2 });
    expect((await call('GET', '/api/chat/subchat-events?session=kid&before=c&limit=5')).json.events.map((e: { id: string }) => e.id)).toEqual(['a', 'b']);
    expect((await call('GET', '/api/chat/subchat-events?session=kid&before=zz')).code).toBe(404);
    mocks.savedEvents.mockResolvedValue(null);
    expect((await call('GET', '/api/chat/subchat-events?session=gone')).code).toBe(404);
  });

  it('answers 404 for an unknown /api path, falls to the web fallback otherwise, and 503 for /api with no chat', async () => {
    const api = await call('GET', '/api/builds');
    expect([api.code, api.json, api.serveWeb.mock.calls.length]).toEqual([404, { error: 'Not found' }, 0]);
    const r = await call('GET', '/nope');
    expect(r.serveWeb).toHaveBeenCalled();
    expect([r.code, r.json.error]).toEqual([404, 'web client not built, run bun run dev or bun run build']);
    const none = await call('GET', '/api/git/status', undefined, { chats: () => new Map() });
    expect([none.code, none.json, none.serveWeb.mock.calls.length]).toEqual([503, { error: 'The agent host is starting' }, 0]);
    const page = await call('GET', '/', undefined, { chats: () => new Map() });
    expect(page.serveWeb).toHaveBeenCalled();
  });

  it('takes a command with no chat open, so a new chat can start', async () => {
    const handleCommand = vi.fn();
    const client = { send: vi.fn(), sendRaw: vi.fn(), view: 'gone' };
    const r = await call('POST', '/api/cmd?cid=t&chat=gone', '{"type":"new_session"}', { chats: () => new Map(), lastViewed: () => '', streams: { get: () => client }, handleCommand });
    expect([r.code, r.json]).toEqual([200, { ok: true }]);
    expect(handleCommand).toHaveBeenCalledWith(client, { type: 'new_session' }, 'gone');
  });

  it('turns a thrown error into a 500 and a body that is not a JSON object into a 400', async () => {
    mocks.listRepos.mockRejectedValueOnce(new Error('boom'));
    const thrown = await call('GET', '/api/repos');
    expect([thrown.code, thrown.json]).toEqual([500, { error: 'boom' }]);
    for (const body of ['{bad', 'null', '[1]']) expect((await call('POST', '/api/focus', body)).code).toBe(400);
  });

  describe('POST /api/jobs/start', () => {
    const start = (deps: Partial<RouteDeps> = {}, repo = '/tmp/none') => call('POST', '/api/jobs/start', JSON.stringify({ jobId: 'j1', title: 'Fix the flaky test', repo, prompt: 'do it' }), deps);

    describe('with a repo', () => {
      beforeEach(() => {
        mocks.createWorktree.mockRejectedValue(new Error('paseo is not installed'));
      });

      it('answers 400 for an unknown account', async () => {
        mocks.isWorkspaceRepo.mockReturnValue(true);
        const r = await call('POST', '/api/jobs/start', JSON.stringify({ jobId: 'j1', title: 't', repo: '/tmp/none', prompt: 'do it', account: 'x' }));
        expect([r.code, r.json]).toEqual([400, { error: 'Unknown account' }]);
      });

      it('answers 400 for a picked account that is not logged in', async () => {
        mocks.isWorkspaceRepo.mockReturnValue(true);
        const logged = vi.spyOn(accounts, 'loggedInAccounts').mockReturnValue(['main']);
        const req = vi.fn(async () => 'chat9');
        const r = await call('POST', '/api/jobs/start', JSON.stringify({ jobId: 'j1', title: 't', repo: '/tmp/none', prompt: 'do it', account: 'alt' }), { host: { req }, runs: () => [] } as unknown as Partial<RouteDeps>);
        logged.mockRestore();
        expect([r.code, r.json]).toEqual([400, { error: 'Account not logged in' }]);
        expect(req).not.toHaveBeenCalled();
      });

      it('answers 400 for a repo that is not a workspace repo', async () => {
        mocks.isWorkspaceRepo.mockReturnValue(false);
        const r = await start();
        expect([r.code, r.json]).toEqual([400, { error: 'Not a workspace repo' }]);
      });

      it('answers 409 while the job has an open run', async () => {
        mocks.isWorkspaceRepo.mockReturnValue(true);
        const r = await start({ runs: () => [{ kind: 'job', jobId: 'j1', state: 'running' }] } as unknown as Partial<RouteDeps>);
        expect([r.code, r.json]).toEqual([409, { error: 'The last run is still open' }]);
      });

      it('makes a jobs/ git worktree and starts the job op', async () => {
        const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'jobs-')));
        const repo = path.join(root, 'repo');
        execFileSync('git', ['init', '-q', '-b', 'main', repo]);
        execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
        mocks.isWorkspaceRepo.mockReturnValue(true);
        const req = vi.fn(async () => 'chat9');
        const r = await start({ host: { req }, runs: () => [] } as unknown as Partial<RouteDeps>, repo);
        expect(r.json.chatId).toBe('chat9');
        expect(r.json.branch).toMatch(/^jobs\/fix-the-flaky-test-\d{8}$/);
        const dir = path.join(root, '.tries', `repo-${r.json.branch.split('/')[1]}`);
        expect(existsSync(dir)).toBe(true);
        expect(execFileSync('git', ['-C', dir, 'branch', '--show-current']).toString().trim()).toBe(r.json.branch);
        expect(req).toHaveBeenCalledWith({ op: 'job', cwd: dir, title: 'Fix the flaky test', prompt: 'do it', jobId: 'j1', branch: r.json.branch, repo, paseo: false });
        vi.spyOn(accounts, 'loggedInAccounts').mockReturnValueOnce(['main', 'alt']);
        const picked = await call('POST', '/api/jobs/start', JSON.stringify({ jobId: 'j2', title: 'Other job', repo, prompt: 'do it', account: 'alt' }), { host: { req }, runs: () => [] } as unknown as Partial<RouteDeps>);
        expect(req).toHaveBeenLastCalledWith(expect.objectContaining({ jobId: 'j2', account: 'alt' }));
        expect(picked.json.chatId).toBe('chat9');
        rmSync(root, { recursive: true, force: true });
      });
    });
  });

  it('rejects a bad agents count for helper advice', async () => {
    expect((await call('GET', '/api/helpers?agents=0')).code).toBe(400);
  });

  it('serves the usage report for logged-in accounts', async () => {
    const logged = vi.spyOn(accounts, 'loggedInAccounts').mockReturnValue(['main']);
    const r = await call('GET', '/api/usage?days=3');
    const bad = await call('GET', '/api/usage?days=0');
    logged.mockRestore();
    expect(r.code).toBe(200);
    expect(r.json.accounts.map((a: { account: string; name: string; days: unknown[] }) => [a.account, a.name, a.days.length])).toEqual([['main', 'Personal', 3]]);
    expect(bad.code).toBe(400);
  });
});
