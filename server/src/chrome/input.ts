import { WebSocket } from 'ws';
import { call } from './cdp.js';
import { isEmulating, type Dims } from './screencast.js';

const BUTTONS = new Set(['left', 'right', 'middle', 'none']);
const EDITABLE = "(() => { const a = document.activeElement; return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA)$/.test(a.tagName)); })()";
const touches = new Map<WebSocket, { x: number; y: number; moved: boolean }>();

export const forgetTouch = (ws: WebSocket) => touches.delete(ws);

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function viewerSize(m: any) {
  const size = { w: Math.min(2400, Math.max(200, num(m.w))), h: Math.min(2400, Math.max(200, num(m.h))) };
  const dims: Dims = {
    cssW: Math.min(2400, Math.max(100, Math.round(num(m.cssW)))),
    cssH: Math.min(2400, Math.max(100, Math.round(num(m.cssH)))),
    dpr: Math.min(4, Math.max(1, num(m.dpr) || 1)),
    mobile: m.mobile === true,
  };
  return { size, dims };
}

// The phone opened its keyboard on the tap; it closes again unless the tap landed in a text field.
async function editable(ws: WebSocket, s: string) {
  const { result } = await call('Runtime.evaluate', { expression: EDITABLE, returnByValue: true }, s, 3000).catch(() => ({ result: { value: false } }));
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'editable', on: result?.value === true }));
}

function navigate(m: any, s: string) {
  if (typeof m.url !== 'string' || !m.url.trim()) return;
  const url = /^[a-z][a-z0-9+.-]*:/i.test(m.url) ? m.url : `https://${m.url}`;
  return call('Page.navigate', { url }, s);
}

async function stepHistory(step: -1 | 1, s: string) {
  const { currentIndex, entries } = await call('Page.getNavigationHistory', {}, s);
  const entry = entries[currentIndex + step];
  return entry && call('Page.navigateToHistoryEntry', { entryId: entry.id }, s);
}

function mouse(m: any, s: string) {
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
}

async function key(m: any, s: string) {
  if (typeof m.key !== 'string') return;
  const base = { key: m.key, code: String(m.code ?? ''), windowsVirtualKeyCode: num(m.keyCode), modifiers: num(m.modifiers) };
  await call('Input.dispatchKeyEvent', { ...base, type: m.key === 'Enter' ? 'keyDown' : 'rawKeyDown', text: m.key === 'Enter' ? '\r' : undefined }, s);
  return call('Input.dispatchKeyEvent', { ...base, type: 'keyUp' }, s);
}

async function touch(m: any, ws: WebSocket, s: string) {
  if (!['touchStart', 'touchMove', 'touchEnd', 'touchCancel'].includes(m.type)) return;
  const x = num(m.x);
  const y = num(m.y);
  const ends = m.type === 'touchEnd' || m.type === 'touchCancel';
  if (isEmulating(s)) {
    await call('Input.dispatchTouchEvent', { type: m.type, touchPoints: ends ? [] : [{ x, y }] }, s);
    return m.type === 'touchEnd' ? editable(ws, s) : undefined;
  }
  const t = touches.get(ws);
  if (m.type === 'touchStart') return void touches.set(ws, { x, y, moved: false });
  if (!t) return;
  if (!ends) {
    if (!t.moved && Math.hypot(t.x - x, t.y - y) < 8) return;
    touches.set(ws, { x, y, moved: true });
    return call('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: t.x - x, deltaY: t.y - y }, s);
  }
  touches.delete(ws);
  if (m.type === 'touchCancel' || t.moved) return;
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }, s);
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }, s);
  return editable(ws, s);
}

export function pageInput(m: any, ws: WebSocket, s: string) {
  switch (m.t) {
    case 'nav':
      return navigate(m, s);
    case 'reload':
      return call('Page.reload', {}, s);
    case 'back':
      return stepHistory(-1, s);
    case 'forward':
      return stepHistory(1, s);
    case 'mouse':
      return mouse(m, s);
    case 'wheel':
      return call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: num(m.x), y: num(m.y), deltaX: num(m.dx), deltaY: num(m.dy) }, s);
    case 'key':
      return key(m, s);
    case 'text':
      if (typeof m.text === 'string' && m.text) return call('Input.insertText', { text: m.text }, s);
      return;
    case 'touch':
      return touch(m, ws, s);
  }
}
