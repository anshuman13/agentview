import { apiUrl, fetchJson } from '../../../app/api';

export const LINK_LIMIT = 8;
const CONCURRENT = 3;

export function linksIn(notes: string, limit = LINK_LIMIT): string[] {
  const urls = (notes.match(/https?:\/\/[^\s<>"'[\]]+/g) ?? []).map((u) => u.replace(/[.,;:)]+$/, '')).filter((u) => /^https?:\/\/[^/?#]/.test(u));
  return [...new Set(urls)].slice(0, limit);
}

export function linkDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function linkPath(url: string) {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : `${u.pathname}${u.search}`;
    return path.length > 40 ? `${path.slice(0, 40)}...` : path;
  } catch {
    return '';
  }
}

const titles = new Map<string, Promise<string | null>>();
const waiting: (() => void)[] = [];
let running = 0;

const next = () => {
  while (running < CONCURRENT && waiting.length) {
    running++;
    waiting.shift()!();
  }
};

// One request per URL until reload, at most 3 at once; a failed request stays null.
export function linkTitle(url: string): Promise<string | null> {
  let p = titles.get(url);
  if (!p) {
    p = new Promise<void>((go) => { waiting.push(go); next(); })
      .then(() => fetchJson<{ title: string | null }>(apiUrl(`/api/link-title?url=${encodeURIComponent(url)}`)))
      .then((r) => r.title || null, () => null)
      .finally(() => { running--; next(); });
    titles.set(url, p);
  }
  return p;
}

export const resetLinkTitles = () => titles.clear();
