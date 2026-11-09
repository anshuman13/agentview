import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const TIMEOUT_MS = 4000;
const MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;
const MAX_TITLE = 120;
const CACHE_SIZE = 500;

type Page = { status: number; location?: string; body: string };
export type Deps = {
  resolve: (host: string) => Promise<string[]>;
  get: (url: URL, ip: string, signal: AbortSignal) => Promise<Page>;
};

const cache = new Map<string, string | null>();

export const clearLinkTitles = () => cache.clear();

function v4Private(ip: string) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168);
}

export function privateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return v4Private(ip);
  if (!net.isIPv6(ip)) return true;
  const a = ip.toLowerCase();
  const mapped = a.match(/^(?:0+:)*:?:ffff:(.+)$/);
  if (mapped) {
    if (net.isIPv4(mapped[1])) return v4Private(mapped[1]);
    const [hi, lo, ...more] = mapped[1].split(':').map((h) => parseInt(h, 16));
    return more.length > 0 || !(hi >= 0 && hi <= 0xffff && lo >= 0 && lo <= 0xffff) || v4Private(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return a === '::' || a === '::1' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || a.startsWith('ff');
}

const defaults: Deps = {
  resolve: async (host) => (await dns.lookup(host, { all: true })).map((r) => r.address),
  get: (url, ip, signal) => new Promise((resolve, reject) => {
    const family = net.isIPv6(ip) ? 6 : 4;
    const req = (url.protocol === 'https:' ? https : http).request(url, {
      signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; AgentView)', accept: 'text/html' },
      lookup: ((_host: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => (opts.all ? cb(null, [{ address: ip, family }]) : cb(null, ip, family))) as never,
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const done = () => {
        req.destroy();
        resolve({ status: res.statusCode ?? 0, location: res.headers.location, body: Buffer.concat(chunks).toString('utf8') });
      };
      res.on('data', (c: Buffer) => {
        chunks.push(c);
        size += c.length;
        if (size >= MAX_BYTES) done();
      });
      res.on('end', done);
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  }),
};

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(?:#(\d+)|#x([\da-f]+)|(\w+));/gi, (m, d, h, n) => {
  if (n) return entities[n.toLowerCase()] ?? m;
  const code = d ? Number(d) : parseInt(h, 16);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
});

function titleOf(html: string): string | null {
  const head = html.slice(0, MAX_BYTES);
  const value = (tag: string, name: string) => {
    const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    return m?.[1] ?? m?.[2] ?? m?.[3];
  };
  let found: string | undefined;
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    if ((value(tag, 'property') ?? value(tag, 'name'))?.toLowerCase() === 'og:title') found ||= value(tag, 'content');
  }
  found ||= head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return (found && decode(found).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE)) || null;
}

async function fetchTitle(start: URL, deps: Deps, signal: AbortSignal): Promise<string | null> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!/^https?:$/.test(url.protocol)) return null;
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost')) return null;
    const ips = await deps.resolve(host);
    if (!ips.length || ips.some(privateAddress)) return null;
    const page = await deps.get(url, ips[0], signal);
    if (page.status >= 300 && page.status < 400 && page.location) {
      url = new URL(page.location, url);
      continue;
    }
    return page.status >= 200 && page.status < 300 ? titleOf(page.body) : null;
  }
  return null;
}

async function linkTitle(target: URL, deps: Deps) {
  if (cache.has(target.href)) return cache.get(target.href)!;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  const title = await Promise.race([
    fetchTitle(target, deps, abort.signal),
    new Promise<null>((r) => abort.signal.addEventListener('abort', () => r(null))),
  ]).catch(() => null).finally(() => clearTimeout(timer));
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
  cache.set(target.href, title);
  return title;
}

export async function linkTitleRoute(url: URL, deps: Deps = defaults): Promise<{ status: number; body: { title: string | null } | { error: string } }> {
  let target: URL;
  try {
    target = new URL(url.searchParams.get('url') ?? '');
  } catch {
    return { status: 400, body: { error: 'A url is required' } };
  }
  if (!/^https?:$/.test(target.protocol)) return { status: 400, body: { error: 'Only http and https links' } };
  return { status: 200, body: { title: await linkTitle(target, deps) } };
}
