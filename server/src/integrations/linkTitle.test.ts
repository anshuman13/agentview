import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLinkTitles, linkTitleRoute, privateAddress, type Deps } from './linkTitle.js';
import { advanceTimersByTimeAsync } from '../../../testing.js';

const page = (body: string, status = 200, location?: string) => ({ status, body, location });
const ask = (url: string | null, deps: Deps) => linkTitleRoute(new URL(`http://x/api/link-title${url == null ? '' : `?url=${encodeURIComponent(url)}`}`), deps);
const deps = (get: Deps['get'], resolve: Deps['resolve'] = async () => ['93.184.216.34']): Deps => ({ resolve, get });

beforeEach(() => clearLinkTitles());
afterEach(() => vi.useRealTimers());

describe('link title route', () => {
  it('prefers og:title, else title, collapsing whitespace and capping length', async () => {
    const og = await ask('https://a.test/1', deps(async () => page('<title>Plain</title><meta property="og:title" content="Shared &amp; sound">')));
    expect(og.body).toEqual({ title: 'Shared & sound' });
    const t = await ask('https://a.test/2', deps(async () => page('<title>\n  Two   words\n</title>')));
    expect(t.body).toEqual({ title: 'Two words' });
    const long = await ask('https://a.test/3', deps(async () => page(`<title>${'x'.repeat(300)}</title>`)));
    expect((long.body as { title: string }).title).toHaveLength(120);
  });

  it('rejects a missing or non-http url with 400', async () => {
    expect((await ask(null, deps(async () => page('')))).status).toBe(400);
    expect((await ask('ftp://a.test/f', deps(async () => page('')))).status).toBe(400);
  });

  it('returns null for loopback, a private redirect and a timeout without fetching', async () => {
    const get = vi.fn(async () => page('<title>x</title>'));
    expect((await ask('http://127.0.0.1/', deps(get, async (h) => [h]))).body).toEqual({ title: null });
    expect((await ask('http://localhost/', deps(get))).body).toEqual({ title: null });
    expect(get).not.toHaveBeenCalled();
    const hop = deps(async (u) => (u.hostname === 'a.test' ? page('', 302, 'http://internal.test/') : page('<title>secret</title>')), async (h) => [h === 'internal.test' ? '10.0.0.5' : '93.184.216.34']);
    expect((await ask('https://a.test/r', hop)).body).toEqual({ title: null });
    vi.useFakeTimers();
    const slow = ask('https://slow.test/', deps((_u, _ip, signal) => new Promise((_r, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))));
    await advanceTimersByTimeAsync(4000);
    expect((await slow).body).toEqual({ title: null });
  });

  it('follows at most 3 redirects', async () => {
    const get = vi.fn(async () => page('', 302, '/next'));
    expect((await ask('https://a.test/', deps(get))).body).toEqual({ title: null });
    expect(get).toHaveBeenCalledTimes(4);
  });

  it('caches a repeat, including null', async () => {
    const get = vi.fn(async () => page('<title>Once</title>'));
    await ask('https://a.test/c', deps(get));
    expect((await ask('https://a.test/c', deps(get))).body).toEqual({ title: 'Once' });
    const miss = vi.fn(async () => page('', 500));
    await ask('https://a.test/m', deps(miss));
    await ask('https://a.test/m', deps(miss));
    expect(get).toHaveBeenCalledTimes(1);
    expect(miss).toHaveBeenCalledTimes(1);
  });
});

describe('privateAddress', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.9.9', '192.168.1.1', '169.254.169.254', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a00:1'])('refuses %s', (ip) => {
    expect(privateAddress(ip)).toBe(true);
  });
  it.each(['93.184.216.34', '172.32.0.1', '2606:2800:220:1:248:1893:25c8:1946', '::ffff:5db8:d822'])('allows %s', (ip) => {
    expect(privateAddress(ip)).toBe(false);
  });
});
