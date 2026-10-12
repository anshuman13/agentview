import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { WebSocket } from 'ws';

type Tab = { id: string; title: string; url: string; at: number };
type State = 'off' | 'connecting' | 'on';
type Msg = { id?: number; method?: string; params?: any; result?: any; error?: { message: string }; sessionId?: string };

const PORT_FILE = path.join(os.homedir(), 'Library/Application Support/Google/Chrome/DevToolsActivePort');

let cdp: WebSocket | null = null;
let state: State = 'off';
let reason = '';
let nextId = 1;
const calls = new Map<number, { resolve: (r: any) => void; reject: (e: Error) => void }>();
const tabs = new Map<string, Tab>();
const viewers = new Set<WebSocket>();
const selfOrigins = new Set<string>();
let pinned: string | null = null;
let watching: { target: string; session: string } | null = null;
let watchSeq = 0;
let size = { w: 1600, h: 1200 };
let viewport = { w: 0, h: 0 };

async function endpoint(): Promise<string | null> {
  if (process.env.CHROME_CDP) return process.env.CHROME_CDP;
  try {
    const [port, p] = (await readFile(PORT_FILE, 'utf8')).trim().split('\n');
    return `ws://127.0.0.1:${port}${p}`;
  } catch {}
  try {
    const r = await fetch('http://127.0.0.1:9222/json/version');
    return (await r.json()).webSocketDebuggerUrl ?? null;
  } catch {}
  return null;
}

function broadcast(m: object) {
  const s = JSON.stringify(m);
  viewers.forEach((v) => v.readyState === WebSocket.OPEN && v.send(s));
}

function setState(s: State, why = '') {
  state = s;
  reason = why;
  broadcast({ t: 'state', state, reason });
}

function call(method: string, params: object = {}, sessionId?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!cdp || cdp.readyState !== WebSocket.OPEN) return reject(new Error('Chrome is not connected'));
    const id = nextId++;
    calls.set(id, { resolve, reject });
    cdp.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

async function connect() {
  if (cdp || state === 'connecting') return;
  setState('connecting');
  const url = await endpoint();
  if (!url) return setState('off', 'disabled');
  const ws = new WebSocket(url, { maxPayload: 512 * 1024 * 1024 });
  let failure = '';
  ws.on('open', async () => {
    cdp = ws;
    setState('on');
    try {
      await call('Target.setDiscoverTargets', { discover: true });
      const { targetInfos } = await call('Target.getTargets');
      targetInfos.forEach((t: any) => track(t, false));
      pick();
    } catch (err) {
      console.error('chrome:', err);
    }
  });
  ws.on('message', (raw) => onMessage(JSON.parse(String(raw))));
  ws.on('error', (err: NodeJS.ErrnoException) => {
    failure = err.code === 'ECONNREFUSED' ? 'disabled' : err.message;
  });
  ws.on('close', () => {
    cdp = null;
    watching = null;
    tabs.clear();
    calls.forEach((c) => c.reject(new Error('Chrome disconnected')));
    calls.clear();
    setState('off', failure || 'closed');
    sendTabs();
  });
}

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

function track(t: any, live: boolean) {
  if (!isPage(t)) return;
  const prev = tabs.get(t.targetId);
  const moved = live && (!prev || prev.url !== t.url);
  tabs.set(t.targetId, { id: t.targetId, title: t.title, url: t.url, at: moved ? Date.now() : (prev?.at ?? 0) });
  return moved;
}

function onMessage(m: Msg) {
  if (m.id) {
    const c = calls.get(m.id);
    calls.delete(m.id);
    if (m.error) c?.reject(new Error(m.error.message));
    else c?.resolve(m.result);
    return;
  }
  switch (m.method) {
    case 'Target.targetCreated':
    case 'Target.targetInfoChanged':
      if (track(m.params.targetInfo, true)) pick();
      else sendTabs();
      break;
    case 'Target.targetDestroyed':
      tabs.delete(m.params.targetId);
      if (pinned === m.params.targetId) pinned = null;
      if (watching?.target === m.params.targetId) watching = null;
      pick();
      break;
    case 'Page.screencastFrame':
      if (m.sessionId !== watching?.session) return;
      void call('Page.screencastFrameAck', { sessionId: m.params.sessionId }, m.sessionId).catch(() => {});
      viewport = { w: m.params.metadata.deviceWidth, h: m.params.metadata.deviceHeight };
      frame(m.params.data);
      break;
  }
}

function frame(data: string) {
  const s = JSON.stringify({ t: 'frame', data, w: viewport.w, h: viewport.h });
  viewers.forEach((v) => v.readyState === WebSocket.OPEN && v.bufferedAmount < 2_000_000 && v.send(s));
}

function sendTabs() {
  const list = [...tabs.values()].filter((t) => !isSelf(t.url)).map(({ id, title, url }) => ({ id, title, url }));
  broadcast({ t: 'tabs', tabs: list, current: watching?.target ?? null, pinned });
}

function pick() {
  if (!viewers.size || !cdp) return sendTabs();
  const list = [...tabs.values()].filter((t) => !isSelf(t.url)).sort((a, b) => b.at - a.at);
  const target = pinned && tabs.has(pinned) ? pinned : list[0]?.id;
  if (target && target !== watching?.target) void watch(target);
  sendTabs();
}

async function watch(target: string) {
  const seq = ++watchSeq;
  const prev = watching;
  watching = null;
  if (prev) void call('Target.detachFromTarget', { sessionId: prev.session }).catch(() => {});
  try {
    const { sessionId } = await call('Target.attachToTarget', { targetId: target, flatten: true });
    if (seq !== watchSeq) return void call('Target.detachFromTarget', { sessionId }).catch(() => {});
    watching = { target, session: sessionId };
    sendTabs();
    await call('Page.enable', {}, sessionId);
    const { cssVisualViewport: v } = await call('Page.getLayoutMetrics', {}, sessionId);
    viewport = { w: v.clientWidth, h: v.clientHeight };
    await screencast();
    const shot = await call('Page.captureScreenshot', { format: 'jpeg', quality: 70 }, sessionId);
    if (watching?.session === sessionId) frame(shot.data);
  } catch (err) {
    console.error('chrome watch:', err);
  }
}

async function screencast() {
  if (!watching) return;
  await call('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: size.w, maxHeight: size.h }, watching.session);
}

function stop() {
  if (!watching) return;
  void call('Target.detachFromTarget', { sessionId: watching.session }).catch(() => {});
  watching = null;
  watchSeq++;
}

const BUTTONS = new Set(['left', 'right', 'middle', 'none']);

async function input(m: any) {
  const s = watching?.session;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  switch (m.t) {
    case 'connect':
      return connect();
    case 'tab':
      pinned = typeof m.id === 'string' && tabs.has(m.id) ? m.id : null;
      if (pinned) await call('Target.activateTarget', { targetId: pinned }).catch(() => {});
      return pick();
    case 'size':
      size = { w: Math.min(2400, Math.max(200, num(m.w))), h: Math.min(2400, Math.max(200, num(m.h))) };
      return screencast().catch(() => {});
  }
  if (!s) return;
  switch (m.t) {
    case 'nav': {
      if (typeof m.url !== 'string' || !m.url.trim()) return;
      const url = /^[a-z][a-z0-9+.-]*:/i.test(m.url) ? m.url : `https://${m.url}`;
      return call('Page.navigate', { url }, s);
    }
    case 'reload':
      return call('Page.reload', {}, s);
    case 'back':
    case 'forward': {
      const { currentIndex, entries } = await call('Page.getNavigationHistory', {}, s);
      const entry = entries[currentIndex + (m.t === 'back' ? -1 : 1)];
      return entry && call('Page.navigateToHistoryEntry', { entryId: entry.id }, s);
    }
    case 'mouse':
      if (!['mousePressed', 'mouseReleased', 'mouseMoved'].includes(m.type)) return;
      return call('Input.dispatchMouseEvent', {
        type: m.type,
        x: num(m.x),
        y: num(m.y),
        button: BUTTONS.has(m.button) ? m.button : 'none',
        buttons: num(m.buttons),
        clickCount: num(m.clickCount),
        modifiers: num(m.modifiers),
      }, s);
    case 'wheel':
      return call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: num(m.x), y: num(m.y), deltaX: num(m.dx), deltaY: num(m.dy) }, s);
    case 'key': {
      if (typeof m.key !== 'string') return;
      const base = { key: m.key, code: String(m.code ?? ''), windowsVirtualKeyCode: num(m.keyCode), modifiers: num(m.modifiers) };
      await call('Input.dispatchKeyEvent', { ...base, type: m.key === 'Enter' ? 'keyDown' : 'rawKeyDown', text: m.key === 'Enter' ? '\r' : undefined }, s);
      return call('Input.dispatchKeyEvent', { ...base, type: 'keyUp' }, s);
    }
    case 'text':
      if (typeof m.text === 'string' && m.text) return call('Input.insertText', { text: m.text }, s);
  }
}

export function openChrome(ws: WebSocket, origin: string | undefined) {
  if (origin) selfOrigins.add(origin);
  viewers.add(ws);
  ws.send(JSON.stringify({ t: 'state', state, reason }));
  if (cdp) pick();
  else void connect();
  ws.on('message', (raw) => {
    let m: unknown;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    input(m).catch((err) => console.error('chrome input:', err.message));
  });
  ws.on('close', () => {
    viewers.delete(ws);
    if (!viewers.size) stop();
  });
}
