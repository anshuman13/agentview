import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const files = vi.hoisted(() => ({ observe: '', tmp: '' }));
vi.mock('node:fs/promises', async (orig) => ({
  ...(await orig<typeof import('node:fs/promises')>()),
  readFile: vi.fn(async () => {
    if (!files.observe) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return files.observe;
  }),
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async (_p: string, data: string) => void (files.tmp = data)),
  rename: vi.fn(async () => void (files.observe = files.tmp)),
}));
import { pushNtfy, stallWatch } from './notify.js';

describe('pushNtfy', () => {
  const sent = vi.fn(async () => new Response(''));
  beforeEach(() => {
    vi.stubGlobal('fetch', sent);
    delete process.env.AGENTVIEW_NTFY;
    files.observe = '';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
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

  it('sends nothing without a topic', async () => {
    files.observe = '{"sentryToken":"secret"}';
    expect(await pushNtfy('t', 's', 'b', 'http://x')).toBe(false);
    expect(files.observe).toBe('{"sentryToken":"secret"}');
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
