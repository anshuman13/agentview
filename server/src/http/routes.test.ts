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
  groupOf: vi.fn(async (id: string) => [id]),
  restoreSession: vi.fn(),
  searchMessages: vi.fn(),
};

vi.mock('../integrations/focus.js', () => ({ scheduleFocus: mocks.scheduleFocus, cancelFocus: mocks.cancelFocus }));
vi.mock('../workspace/worktrees.js', () => ({ listRepos: mocks.listRepos, isWorkspaceRepo: mocks.isWorkspaceRepo, listWorktrees: vi.fn(), createWorktree: mocks.createWorktree, createFolder: vi.fn(), removeWorktree: vi.fn(), removeRunWorktree: vi.fn(), worktreeBase: async () => { throw new Error('paseo is not installed'); } }));
vi.mock('../agent/claude/sessions.js', () => ({ listSessions: mocks.listSessions, savedSession: (x: unknown) => x, renameRoute: vi.fn() }));
vi.mock('../agent/claude/pins.js', () => ({ removeChat: mocks.removeChat, pinsRoute: vi.fn() }));
vi.mock('../agent/claude/bin.js', () => ({ listBin: mocks.listBin, emptyBin: vi.fn(), restoreSession: mocks.restoreSession }));
vi.mock('../session/subChats.js', () => ({ listLinks: mocks.listLinks, groupOf: mocks.groupOf }));
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
    expect((await call('GET', '/api/sessions')).json).toEqual([
      { sessionId: 'kid', lastModified: 2, summary: 'Kid', cwd: '/r', parentId: 'root', via: 'build', startedAt: 5 },
      { sessionId: 'root', lastModified: 1, summary: 'Root', cwd: '/r' },
    ]);
    expect(mocks.listSessions).toHaveBeenCalledWith({ limit: 1000 });
    mocks.searchMessages.mockResolvedValue([{ sessionId: 'kid', role: 'user', text: 'x', at: '' }, { sessionId: 'root', role: 'user', text: 'y', at: '' }]);
    expect((await call('GET', '/api/sessions/search?q=x')).json).toEqual([
      { sessionId: 'kid', role: 'user', text: 'x', at: '', title: 'Kid', cwd: '/r', parentId: 'root' },
      { sessionId: 'root', role: 'user', text: 'y', at: '', title: 'Root', cwd: '/r' },
    ]);
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
});
