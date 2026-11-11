import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { promises as realFs } from 'node:fs';
import { advanceTimersByTimeAsync, stubGlobal, unstubAllGlobals } from '../../../testing.js';

const files = { observe: '', tmp: '' };
vi.mock('node:fs/promises', () => ({
  ...realFs,
  readFile: vi.fn(async () => {
    if (!files.observe) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return files.observe;
  }),
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async (_p: string, data: string) => void (files.tmp = data)),
  rename: vi.fn(async () => void (files.observe = files.tmp)),
}));
const { notifyAway, pushNtfy, stallWatch } = await import('./notify.js');

describe('pushNtfy', () => {
  const sent = vi.fn(async () => new Response(''));
  beforeEach(() => {
    stubGlobal('fetch', sent);
    delete process.env.AGENTVIEW_NTFY;
    files.observe = '';
  });
  afterEach(() => {
    unstubAllGlobals();
    sent.mockClear();
  });

  it('posts title, body and a click link to the topic from the environment', async () => {
    process.env.AGENTVIEW_NTFY = 'my topic';
    expect(await pushNtfy('Claude finished in repo', 'Fix the thing', 'Done', 'http://localhost:5173/?chat=c1')).toBe(true);
    expect(sent).toHaveBeenCalledWith('https://ntfy.sh/my%20topic', {
      method: 'POST',
      headers: { Title: 'Claude finished in repo', Click: 'http://localhost:5173/?chat=c1' },
      body: 'Fix the thing\nDone',
      signal: expect.any(AbortSignal),
    });
  });

  it('takes a full URL from observe.json and encodes non-ASCII titles', async () => {
    files.observe = JSON.stringify({ ntfy: 'https://ntfy.example.com/agents' });
    await pushNtfy('Claude needs you in café', '', 'Allow?', 'http://x');
    const [url, init] = sent.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ntfy.example.com/agents');
    expect((init.headers as Record<string, string>).Title).toBe(`=?UTF-8?B?${Buffer.from('Claude needs you in café').toString('base64')}?=`);
    expect(init.body).toBe('Allow?');
  });

  it('counts a timeout and a network error as failed', async () => {
    files.observe = '{"ntfy":"topic"}';
    sent.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    expect(await pushNtfy('t', 's', 'b', 'http://x')).toBe(false);
    sent.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await pushNtfy('t', 's', 'b', 'http://x')).toBe(false);
  });

  it('sends nothing without a topic', async () => {
    files.observe = '{"repos":{}}';
    expect(await pushNtfy('t', 's', 'b', 'http://x')).toBe(false);
    expect(files.observe).toBe('{"repos":{}}');
    expect(sent).not.toHaveBeenCalled();
  });

  it('sends nothing when the topic is off', async () => {
    files.observe = '{"ntfy":"off"}';
    expect(await pushNtfy('t', 's', 'b', 'http://x')).toBe(false);
    expect(sent).not.toHaveBeenCalled();
  });
});

describe('stallWatch', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports a running chat once after 15 quiet minutes and clears it on the next message', () => {
    const onStall = vi.fn();
    const w = stallWatch(onStall);
    w.seen('a', true);
    w.seen('b', false);
    vi.advanceTimersByTime(14 * 60_000);
    expect(onStall).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2 * 60_000);
    expect(onStall).toHaveBeenCalledTimes(1);
    expect(onStall).toHaveBeenCalledWith('a');
    expect(w.stalled('a')).toBe(true);
    vi.advanceTimersByTime(30 * 60_000);
    expect(onStall).toHaveBeenCalledTimes(1);
    expect(w.seen('a', true)).toBe(true);
    expect(w.stalled('a')).toBe(false);
    vi.advanceTimersByTime(16 * 60_000);
    expect(onStall).toHaveBeenCalledTimes(2);
  });

  it('forgets a chat that stopped running', () => {
    const onStall = vi.fn();
    const w = stallWatch(onStall);
    w.seen('a', true);
    vi.advanceTimersByTime(10 * 60_000);
    expect(w.seen('a', false)).toBe(false);
    vi.advanceTimersByTime(10 * 60_000);
    expect(onStall).not.toHaveBeenCalled();
  });
});

describe('notifyAway', () => {
  const sent = vi.fn(async () => new Response(''));
  beforeEach(() => {
    vi.useFakeTimers();
    stubGlobal('fetch', sent);
    process.env.AGENTVIEW_NTFY = 'topic';
  });
  afterEach(() => {
    vi.useRealTimers();
    unstubAllGlobals();
    delete process.env.AGENTVIEW_NTFY;
    sent.mockClear();
  });

  it('sends a needs-you push 5 s after a finished push', async () => {
    const chat = { id: 'c1', cwd: '/x/repo', title: 'T' } as any;
    const away = () => chat;
    notifyAway({ type: 'event', event: { kind: 'result', text: 'Done' } } as any, away);
    vi.advanceTimersByTime(5_000);
    notifyAway({ type: 'pending', request: { id: 'p1', kind: 'permission', title: 'Allow?' } } as any, away);
    await advanceTimersByTimeAsync(0);
    expect(sent).toHaveBeenCalledTimes(2);
  });

  it('pushes a loop round only for done, blocked, question or failed, and other turns as before', async () => {
    const done = (text: string) => ({ type: 'event', event: { kind: 'result', text } }) as any;
    const chat = (id: string) => ({ id, cwd: '/x/repo', title: 'T' }) as any;
    notifyAway(done('Nothing new.\nROUND: nothing'), () => chat('q'), () => false, { outcome: 'quiet', line: '' });
    notifyAway(done('Fixed a test.\nROUND: progress fixed'), () => chat('p'), () => false, { outcome: 'progress', line: 'fixed' });
    await advanceTimersByTimeAsync(0);
    expect(sent).not.toHaveBeenCalled();
    notifyAway(done('Needs a token.\nROUND: blocked needs a token'), () => chat('b'), () => false, { outcome: 'blocked', line: 'needs a token' });
    await advanceTimersByTimeAsync(0);
    expect(sent).toHaveBeenCalledTimes(1);
    const [, init] = sent.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Title).toBe('Loop in repo: blocked');
    expect(init.body).toBe('T\nneeds a token');
    notifyAway(done('GOAL MET'), () => chat('e'), () => false, { outcome: 'done', line: 'Goal met', ends: true });
    await advanceTimersByTimeAsync(0);
    expect(sent).toHaveBeenCalledTimes(1);
    notifyAway(done('Plain reply.\nROUND: done x'), () => chat('n'));
    await advanceTimersByTimeAsync(0);
    const [, plain] = sent.mock.calls[1] as unknown as [string, RequestInit];
    expect((plain.headers as Record<string, string>).Title).toBe('Claude finished in repo');
    expect(plain.body).toBe('T\nPlain reply.');
  });

  it('skips the ntfy push while a desktop client is active', async () => {
    const chat = { id: 'c1', cwd: '/x/repo', title: 'T' } as any;
    notifyAway({ type: 'event', event: { kind: 'result', text: 'Done' } } as any, () => chat, () => true);
    await advanceTimersByTimeAsync(0);
    expect(sent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    notifyAway({ type: 'event', event: { kind: 'result', text: 'Done again' } } as any, () => chat, () => false);
    await advanceTimersByTimeAsync(0);
    expect(sent).toHaveBeenCalledTimes(1);
  });
});
