import { Readable } from 'node:stream';
import type http from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveChat } from '../../../shared/protocol.js';

const mocks = vi.hoisted(() => ({
  scheduleFocus: vi.fn(),
  cancelFocus: vi.fn(),
  listRepos: vi.fn(),
  listSessions: vi.fn(),
  removeChat: vi.fn(),
  listBin: vi.fn(),
  listTerminals: vi.fn(),
}));

vi.mock('../integrations/focus.js', () => ({ scheduleFocus: mocks.scheduleFocus, cancelFocus: mocks.cancelFocus }));
vi.mock('../workspace/worktrees.js', () => ({ listRepos: mocks.listRepos, listWorktrees: vi.fn(), createWorktree: vi.fn(), createFolder: vi.fn(), removeWorktree: vi.fn() }));
vi.mock('../agent/claude/sessions.js', () => ({ listSessions: mocks.listSessions, savedSession: (x: unknown) => x, renameRoute: vi.fn() }));
vi.mock('../agent/claude/pins.js', () => ({ removeChat: mocks.removeChat, pinsRoute: vi.fn() }));
vi.mock('../agent/claude/bin.js', () => ({ listBin: mocks.listBin, emptyBin: vi.fn(), restoreSession: vi.fn() }));
vi.mock('../workspace/terminal.js', () => ({ listTerminals: mocks.listTerminals, createTerminal: vi.fn(), closeTerminal: vi.fn() }));

import { createRoutes, type RouteDeps } from './routes.js';

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
  it('POST /api/focus parses the body and answers 400 on an error', async () => {
    mocks.scheduleFocus.mockReturnValueOnce({ error: 'bad end' }).mockReturnValueOnce({ ok: true });
    const bad = await call('POST', '/api/focus', '{"title":"t","end":"x"}');
    expect(mocks.scheduleFocus).toHaveBeenCalledWith('t', 'x');
    expect([bad.code, bad.json]).toEqual([400, { error: 'bad end' }]);
    const ok = await call('POST', '/api/focus', '{"title":"t"}');
    expect([ok.code, ok.json]).toEqual([200, { ok: true }]);
  });

  it('DELETE /api/focus does not parse a body', async () => {
    const r = await call('DELETE', '/api/focus');
    expect([r.code, r.json]).toEqual([200, { ok: true }]);
    expect(mocks.cancelFocus).toHaveBeenCalled();
  });

  it('ANY routes answer every method', async () => {
    mocks.listRepos.mockResolvedValue(['r']);
    for (const m of ['GET', 'POST']) expect((await call(m, '/api/repos')).json).toEqual(['r']);
  });

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
});
