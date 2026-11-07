import { afterEach, describe, expect, it, vi } from 'vitest';
import { hub, QUICK_TIMEOUT } from './hubFetch';

const reply = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe('hub', () => {
  it('posts a json body and returns parsed data', async () => {
    const f = vi.fn().mockResolvedValue(reply(200, { ok: 1 }));
    vi.stubGlobal('fetch', f);
    expect(await hub('/x', { a: 1 }, QUICK_TIMEOUT)).toEqual({ ok: 1 });
    const init = f.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('gets without a body and honours an explicit method', async () => {
    const f = vi.fn().mockImplementation(async () => reply(200, {}));
    vi.stubGlobal('fetch', f);
    await hub('/x');
    await hub('/y', undefined, QUICK_TIMEOUT, 'POST');
    expect(f.mock.calls[0][1]).toMatchObject({ method: 'GET' });
    expect(f.mock.calls[0][1].body).toBeUndefined();
    expect(f.mock.calls[1][1]).toMatchObject({ method: 'POST' });
  });

  it('throws the error field of a failed reply', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(400, { error: 'bad input' })));
    await expect(hub('/x', {})).rejects.toThrow('bad input');
  });

  it('falls back to the status when the body is not json', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(502, 'oops')));
    await expect(hub('/x')).rejects.toThrow('Hub returned HTTP 502');
  });

  it('aborts when the timeout passes', async () => {
    vi.stubGlobal('fetch', vi.fn((_: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
    })));
    await expect(hub('/x', undefined, 10)).rejects.toThrow();
  });
});
