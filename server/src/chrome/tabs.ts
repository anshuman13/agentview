import { broadcast } from './cdp.js';

type Tab = { id: string; title: string; url: string; at: number };

export const tabs = new Map<string, Tab>();
export const view: { pinned: string | null; watching: { target: string; session: string } | null } = { pinned: null, watching: null };
const selfOrigins = new Set<string>();

export const trustOrigin = (origin: string) => selfOrigins.add(origin);

function isPage(t: any) {
  return t.type === 'page' && !/^(devtools|chrome-extension):/.test(t.url);
}

function isSelf(url: string) {
  try {
    return selfOrigins.has(new URL(url).origin);
  } catch {
    return false;
  }
}

export const otherTabs = () => [...tabs.values()].filter((t) => !isSelf(t.url));

export function track(t: any, live: boolean) {
  if (!isPage(t)) return;
  const prev = tabs.get(t.targetId);
  const moved = live && (!prev || prev.url !== t.url);
  tabs.set(t.targetId, { id: t.targetId, title: t.title, url: t.url, at: moved ? Date.now() : (prev?.at ?? 0) });
  return moved;
}

export function sendTabs() {
  const list = otherTabs().map(({ id, title, url }) => ({ id, title, url }));
  broadcast({ t: 'tabs', tabs: list, current: view.watching?.target ?? null, pinned: view.pinned });
}
