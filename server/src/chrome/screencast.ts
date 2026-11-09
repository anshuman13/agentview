import { WebSocket } from 'ws';
import { call } from './cdp.js';
import { frame, viewport } from './frames.js';
import { sendTabs, view } from './tabs.js';

export type Dims = { cssW: number; cssH: number; dpr: number; mobile: boolean };

let size = { w: 1600, h: 1200 };
const sizes = new Map<WebSocket, Dims>();
let emulated: { session: string; key: string } | null = null;
let watchSeq = 0;

export const isEmulating = (session: string) => emulated?.session === session && Boolean(emulated.key);

export function dropEmulation() {
  emulated = null;
}

export async function watch(target: string) {
  const seq = ++watchSeq;
  const prev = view.watching;
  view.watching = null;
  if (prev) release(prev.session);
  try {
    const { sessionId } = await call('Target.attachToTarget', { targetId: target, flatten: true });
    if (seq !== watchSeq) return void call('Target.detachFromTarget', { sessionId }).catch(() => {});
    view.watching = { target, session: sessionId };
    sendTabs();
    await call('Page.enable', {}, sessionId);
    await emulate(false);
    const { cssVisualViewport: v } = await call('Page.getLayoutMetrics', {}, sessionId);
    Object.assign(viewport, { w: v.clientWidth, h: v.clientHeight });
    await screencast();
    await snapshot();
  } catch (err) {
    console.error('chrome watch:', err);
    if (seq === watchSeq && view.watching) {
      release(view.watching.session);
      view.watching = null;
    }
  }
}

export async function snapshot() {
  const session = view.watching?.session;
  if (!session) return;
  const shot = await call('Page.captureScreenshot', { format: 'jpeg', quality: 70 }, session);
  if (view.watching?.session === session) frame(shot.data);
}

async function screencast() {
  if (!view.watching) return;
  await call('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: size.w, maxHeight: size.h }, view.watching.session);
}

function release(session: string) {
  if (emulated?.session === session && emulated.key) {
    void call('Emulation.clearDeviceMetricsOverride', {}, session).catch(() => {});
    void call('Emulation.setTouchEmulationEnabled', { enabled: false }, session).catch(() => {});
  }
  if (emulated?.session === session) emulated = null;
  void call('Target.detachFromTarget', { sessionId: session }).catch(() => {});
}

export async function emulate(restart = true) {
  if (!view.watching) return;
  const m = [...sizes.values()].reverse().find((d) => d.mobile);
  const key = m ? `${m.cssW}x${m.cssH}@${m.dpr}` : '';
  const { session } = view.watching;
  if ((emulated?.session === session ? emulated.key : '') === key) return;
  emulated = { session, key };
  try {
    if (m) {
      await call('Emulation.setDeviceMetricsOverride', { width: m.cssW, height: m.cssH, deviceScaleFactor: m.dpr, mobile: true }, session);
      await call('Emulation.setTouchEmulationEnabled', { enabled: true }, session);
    } else {
      await call('Emulation.clearDeviceMetricsOverride', {}, session);
      await call('Emulation.setTouchEmulationEnabled', { enabled: false }, session);
    }
    if (restart) await screencast();
  } catch {}
}

export async function resize(ws: WebSocket, next: typeof size, dims: Dims) {
  size = next;
  sizes.delete(ws);
  sizes.set(ws, dims);
  await emulate(false);
  return screencast().catch(() => {});
}

export function forgetSize(ws: WebSocket) {
  return sizes.delete(ws);
}

export function stopWatching() {
  // Also cancels a watch() still attaching, which would otherwise screencast to no one.
  watchSeq++;
  if (!view.watching) return;
  release(view.watching.session);
  view.watching = null;
}
