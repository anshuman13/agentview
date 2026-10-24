import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const files = vi.hoisted(() => ({ observe: '' }));
vi.mock('node:fs/promises', async (orig) => ({
  ...(await orig<typeof import('node:fs/promises')>()),
  readFile: vi.fn(async () => {
    if (!files.observe) throw new Error('ENOENT');
    return files.observe;
  }),
}));
import { pushNtfy } from './notify.js';

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
    expect(await pushNtfy('t', 's', 'b', 'http://x')).toBe(false);
    files.observe = '{"sentryToken":""}';
    expect(await pushNtfy('t', 's', 'b', 'http://x')).toBe(false);
    expect(sent).not.toHaveBeenCalled();
  });
});
