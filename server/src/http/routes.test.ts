import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type http from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import type { LiveChat } from '../../../shared/protocol.js';

const mocks = {
  scheduleFocus: vi.fn(),
  cancelFocus: vi.fn(),
  listRepos: vi.fn(),
  createWorktree: vi.fn(),
  listSessions: vi.fn(),
  removeChat: vi.fn(),
  listBin: vi.fn(),
  listTerminals: vi.fn(),
};

vi.mock('../integrations/focus.js', () => ({ scheduleFocus: mocks.scheduleFocus, cancelFocus: mocks.cancelFocus }));
vi.mock('../workspace/worktrees.js', () => ({ listRepos: mocks.listRepos, listWorktrees: vi.fn(), createWorktree: mocks.createWorktree, createFolder: vi.fn(), removeWorktree: vi.fn(), removeRunWorktree: vi.fn() }));
vi.mock('../agent/claude/sessions.js', () => ({ listSessions: mocks.listSessions, savedSession: (x: unknown) => x, renameRoute: vi.fn() }));
vi.mock('../agent/claude/pins.js', () => ({ removeChat: mocks.removeChat, pinsRoute: vi.fn() }));
vi.mock('../agent/claude/bin.js', () => ({ listBin: mocks.listBin, emptyBin: vi.fn(), restoreSession: vi.fn() }));
vi.mock('../workspace/terminal.js', () => ({ listTerminals: mocks.listTerminals, createTerminal: vi.fn(), closeTerminal: vi.fn() }));

import type { RouteDeps } from './routes.js';
const { createRoutes } = await import('./routes.js');

const chat = { id: 'c1', cwd: '/tmp/x' } as LiveChat;

async function call(method: string, path: string, body?: string, deps: Partial<RouteDeps> = {}) {
  const serveWeb = vi.fn(async () => false);
  const { dispatch } = createRoutes({ chats: () => new Map([['c1', chat]]), lastViewed: () => 'c1', bySession: () => undefined, serveWeb, ...deps } as unknown as RouteDeps);
  const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(body)]), { method, headers: {} }) as unknown as http.IncomingMessage;
  const out = { code: 0, text: '' };
  const res = {
    writeHead: (code: number) => (out.code = code),
    end: (text: string) => (out.text = text),
  } as unknown as http.ServerResponse;
  await dispatch(req, res, new URL(path, 'http://x'));
  return { ...out, serveWeb, json: out.text ? JSON.parse(out.text) : undefined };
}

beforeEach(() => vi.clearAllMocks());

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

  it('falls to the web fallback 404, and answers 503 with no chat', async () => {
    const r = await call('GET', '/nope');
    expect(r.serveWeb).toHaveBeenCalled();
    expect([r.code, r.json.error]).toEqual([404, 'web client not built, run npm run dev or npm run build']);
    const none = await call('GET', '/nope', undefined, { chats: () => new Map() });
    expect([none.code, none.json, none.serveWeb.mock.calls.length]).toEqual([503, { error: 'The agent host is starting' }, 0]);
  });

  it('turns a thrown error or malformed JSON into a 500', async () => {
    mocks.listRepos.mockRejectedValueOnce(new Error('boom'));
    const thrown = await call('GET', '/api/repos');
    expect([thrown.code, thrown.json]).toEqual([500, { error: 'boom' }]);
    for (const body of ['{bad', '']) expect((await call('POST', '/api/focus', body)).code).toBe(500);
  });

  describe('POST /api/jobs/start', () => {
    const start = (deps: Partial<RouteDeps> = {}, repo = '/tmp/none') => call('POST', '/api/jobs/start', JSON.stringify({ jobId: 'j1', title: 'Fix the flaky test', repo, prompt: 'do it' }), deps);

    describe('with a repo', () => {
      beforeEach(() => {
        mocks.createWorktree.mockRejectedValue(new Error('paseo is not installed'));
      });

      it('answers 400 for a repo that is not a workspace repo', async () => {
        mocks.listRepos.mockResolvedValue([{ cwd: '/tmp/other' }]);
        const r = await start();
        expect([r.code, r.json]).toEqual([400, { error: 'Not a workspace repo' }]);
      });

      it('answers 409 while the job has an open run', async () => {
        mocks.listRepos.mockResolvedValue([{ cwd: '/tmp/none' }]);
        const r = await start({ runs: () => [{ kind: 'job', jobId: 'j1', state: 'running' }] } as unknown as Partial<RouteDeps>);
        expect([r.code, r.json]).toEqual([409, { error: 'The last run is still open' }]);
      });

      it('makes a jobs/ git worktree and starts the job op', async () => {
        const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'jobs-')));
        const repo = path.join(root, 'repo');
        execFileSync('git', ['init', '-q', '-b', 'main', repo]);
        execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
        mocks.listRepos.mockResolvedValue([{ cwd: repo }]);
        const req = vi.fn(async () => 'chat9');
        const r = await start({ host: { req }, runs: () => [] } as unknown as Partial<RouteDeps>, repo);
        expect(r.json.chatId).toBe('chat9');
        expect(r.json.branch).toMatch(/^jobs\/fix-the-flaky-test-\d{8}$/);
        const dir = path.join(root, '.tries', `repo-${r.json.branch.split('/')[1]}`);
        expect(existsSync(dir)).toBe(true);
        expect(execFileSync('git', ['-C', dir, 'branch', '--show-current']).toString().trim()).toBe(r.json.branch);
        expect(req).toHaveBeenCalledWith({ op: 'job', cwd: dir, title: 'Fix the flaky test', prompt: 'do it', jobId: 'j1', branch: r.json.branch, repo, paseo: false });
        rmSync(root, { recursive: true, force: true });
      });
    });
  });
});
