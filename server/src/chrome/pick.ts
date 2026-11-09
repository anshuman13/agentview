import { call, connected } from './cdp.js';
import { viewers } from './frames.js';
import { watch } from './screencast.js';
import { otherTabs, sendTabs, tabs, view } from './tabs.js';

let picking = 0;
let settled = 0;
let shown = true;
let pickTimer: NodeJS.Timeout | null = null;

async function isVisible(targetId: string) {
  const own = view.watching?.target === targetId ? view.watching.session : null;
  let session = own;
  try {
    session ??= (await call('Target.attachToTarget', { targetId, flatten: true }, undefined, 3000)).sessionId as string;
    const { result } = await call('Runtime.evaluate', { expression: 'document.visibilityState', returnByValue: true }, session, 3000);
    return result?.value === 'visible';
  } catch {
    return false;
  } finally {
    if (session && !own) void call('Target.detachFromTarget', { sessionId: session }).catch(() => {});
  }
}

export function pick() {
  sendTabs();
  if (pickTimer) clearTimeout(pickTimer);
  pickTimer = setTimeout(() => void choose(), 250);
}

async function choose() {
  if (!viewers.size || !connected()) return;
  const seq = ++picking;
  const list = otherTabs().sort((a, b) => b.at - a.at);
  let target = view.pinned && tabs.has(view.pinned) ? view.pinned : null;
  for (const t of target ? [] : list) {
    if (await isVisible(t.id)) {
      target = t.id;
      break;
    }
    if (seq !== picking) return;
  }
  if (!target && view.watching && tabs.has(view.watching.target) && !view.pinned) target = view.watching.target;
  target ??= list[0]?.id ?? null;
  if (seq !== picking) return;
  if (target && target !== view.watching?.target) await watch(target);
  if (seq === picking) settled = seq;
  sendTabs();
}

export async function selectTab(id: unknown) {
  view.pinned = typeof id === 'string' && tabs.has(id) ? id : null;
  if (view.pinned) await call('Target.activateTarget', { targetId: view.pinned }).catch(() => {});
  return pick();
}

setInterval(async () => {
  if (!viewers.size || !connected() || picking !== settled) return;
  if (!view.watching) return tabs.size && pick();
  const was = shown;
  shown = await isVisible(view.watching.target);
  if (!view.pinned && was && !shown) pick();
}, 2000).unref();
