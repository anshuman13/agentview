import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// A server's logo, like Claude's connector list: the favicon from the service's own site, cached on disk.
const DIR = path.join(os.homedir(), '.agentview', 'mcp-icons');

const DOMAINS: [RegExp, string][] = [
  [/gmail/i, 'mail.google.com'],
  [/google calendar/i, 'calendar.google.com'],
  [/google drive/i, 'drive.google.com'],
  [/google docs/i, 'docs.google.com'],
  [/google sheets/i, 'sheets.google.com'],
  [/google slides/i, 'slides.google.com'],
  [/^(claude|meetings)\b/i, 'claude.ai'],
  [/atlassian|jira|confluence/i, 'atlassian.com'],
  [/notion/i, 'notion.so'],
  [/linear/i, 'linear.app'],
  [/sentry/i, 'sentry.io'],
  [/grafana/i, 'grafana.com'],
  [/kiwi/i, 'kiwi.com'],
  [/monday/i, 'monday.com'],
  [/adobe/i, 'adobe.com'],
];

// The site to take the logo from: a known name, else the server URL's site, else none.
export function iconDomain(name: string, url?: string): string | null {
  const bare = name.replace(/^claude\.ai /i, '').replace(/\s*\(\d+\)$/, '');
  const known = DOMAINS.find(([re]) => re.test(bare))?.[1];
  if (known) return known;
  if (url?.startsWith('http')) {
    const host = new URL(url).hostname.split('.');
    return host.slice(-2).join('.');
  }
  return /^[\w.-]+$/.test(bare) && name.toLowerCase().startsWith('claude.ai ') ? `${bare.toLowerCase().replace(/\.com$/, '')}.com` : null;
}

const pending = new Map<string, Promise<{ type: string; data: Uint8Array } | null>>();

async function fetchIcon(domain: string): Promise<{ type: string; data: Uint8Array } | null> {
  const get = (u: string) => fetch(u, { signal: AbortSignal.timeout(6000), redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 AgentView' } });
  const candidates: string[] = [];
  try {
    const page = await get(`https://${domain}/`);
    const html = (await page.text()).slice(0, 200_000);
    const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
    const rank = (l: string) => (/apple-touch-icon/i.test(l) ? 0 : /rel=["'][^"']*icon/i.test(l) ? (/\.svg/i.test(l) ? 2 : 1) : 9);
    for (const l of links.filter((l) => rank(l) < 9).sort((a, b) => rank(a) - rank(b))) {
      const href = l.match(/href=["']([^"']+)["']/i)?.[1];
      if (href && !href.startsWith('data:')) candidates.push(new URL(href, page.url).href);
    }
  } catch { /* the site may block page fetches; try the favicon */ }
  candidates.push(`https://${domain}/favicon.ico`);
  for (const u of candidates) {
    try {
      const r = await get(u);
      const type = r.headers.get('content-type') ?? '';
      if (!r.ok || !/^image\//.test(type)) continue;
      const data = new Uint8Array(await r.arrayBuffer());
      if (data.length > 100) return { type, data };
    } catch { /* next candidate */ }
  }
  return null;
}

export async function mcpIcon(domain: string): Promise<{ type: string; data: Uint8Array } | null> {
  const file = path.join(DIR, domain.replace(/[^\w.-]/g, '_'));
  try {
    const meta = JSON.parse(await readFile(`${file}.json`, 'utf8')) as { type: string | null; at: number };
    if (!meta.type) return Date.now() - meta.at < 86_400_000 ? null : refetch();
    return { type: meta.type, data: new Uint8Array(await readFile(file)) };
  } catch {
    return refetch();
  }
  function refetch() {
    let p = pending.get(domain);
    if (!p) {
      p = fetchIcon(domain).then(async (icon) => {
        await mkdir(DIR, { recursive: true });
        if (icon) await writeFile(file, icon.data);
        await writeFile(`${file}.json`, JSON.stringify({ type: icon?.type ?? null, at: Date.now() }));
        return icon;
      }).finally(() => pending.delete(domain));
      pending.set(domain, p);
    }
    return p;
  }
}

export async function mcpIconRoute(url: URL): Promise<Response> {
  const domain = iconDomain(url.searchParams.get('name') ?? '', url.searchParams.get('url') ?? undefined);
  const icon = domain ? await mcpIcon(domain) : null;
  if (!icon) return new Response(null, { status: 404, headers: { 'cache-control': 'max-age=3600' } });
  return new Response(Buffer.from(icon.data), { headers: { 'content-type': icon.type, 'cache-control': 'max-age=86400' } });
}
