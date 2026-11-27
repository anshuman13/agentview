import { OPEN, type Peer } from '../http/peer.js';
import { call } from './cdp.js';
import { tabs, view } from './tabs.js';

const HIGHLIGHT = {
  showInfo: true,
  contentColor: { r: 111, g: 168, b: 220, a: 0.3 },
  borderColor: { r: 31, g: 111, b: 235, a: 0.9 },
};

// Runs on the picked node in the page: the tag, a short CSS selector, the text, the outer HTML and the box in page pixels.
const DESCRIBE = `function () {
  const el = this.nodeType === 1 ? this : this.parentElement;
  const part = (e) => {
    if (e.id) return '#' + CSS.escape(e.id);
    let p = e.tagName.toLowerCase() + [...e.classList].slice(0, 2).map((c) => '.' + CSS.escape(c)).join('');
    const same = e.parentElement ? [...e.parentElement.children].filter((c) => c.tagName === e.tagName) : [];
    if (same.length > 1) p += ':nth-of-type(' + (same.indexOf(e) + 1) + ')';
    return p;
  };
  const parts = [];
  for (let e = el; e && e.nodeType === 1 && parts.length < 5; e = e.parentElement) {
    parts.unshift(part(e));
    if (e.id || e === document.body) break;
  }
  const r = el.getBoundingClientRect();
  return {
    tag: el.tagName.toLowerCase(),
    selector: parts.join(' > '),
    text: (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 2000),
    html: el.outerHTML.slice(0, 4000),
    rect: { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height },
  };
}`;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0);

async function nodeAt(s: string, x: number, y: number) {
  const { backendNodeId } = await call('DOM.getNodeForLocation', { x, y, ignorePointerEventsNone: true }, s, 3000);
  return backendNodeId as number;
}

// Hover steps that arrive while a highlight is drawn go as one, the latest point.
const hovers = new Map<string, { x: number; y: number; busy: boolean }>();
async function hover(s: string, x: number, y: number) {
  const h = hovers.get(s) ?? { x, y, busy: false };
  hovers.set(s, Object.assign(h, { x, y }));
  if (h.busy) return;
  h.busy = true;
  let last = { x: NaN, y: NaN };
  while (h.x !== last.x || h.y !== last.y) {
    last = { x: h.x, y: h.y };
    try {
      await call('Overlay.highlightNode', { highlightConfig: HIGHLIGHT, backendNodeId: await nodeAt(s, last.x, last.y) }, s, 3000);
    } catch {}
  }
  hovers.delete(s);
}

async function crop(s: string, r: { x: number; y: number; w: number; h: number }) {
  if (r.w < 1 || r.h < 1) return '';
  const pad = 8;
  const w = Math.min(r.w + pad * 2, 2000);
  const h = Math.min(r.h + pad * 2, 1200);
  const clip = { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: w, height: h, scale: Math.min(1, 480 / w) };
  const shot = await call('Page.captureScreenshot', { format: 'jpeg', quality: 70, clip }, s, 5000).catch(() => null);
  return (shot?.data as string) ?? '';
}

async function pickAt(ws: Peer, s: string, x: number, y: number) {
  const backendNodeId = await nodeAt(s, x, y);
  await call('Overlay.hideHighlight', {}, s).catch(() => {});
  const { object } = await call('DOM.resolveNode', { backendNodeId }, s, 3000);
  const { result } = await call('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: DESCRIBE, returnByValue: true }, s, 3000);
  void call('Runtime.releaseObject', { objectId: object.objectId }, s).catch(() => {});
  const el = result?.value;
  if (!el?.tag) return;
  const url = (view.watching && tabs.get(view.watching.target)?.url) ?? '';
  const shot = await crop(s, el.rect);
  if (ws.readyState === OPEN) ws.send(JSON.stringify({ t: 'picked', el: { url, tag: el.tag, selector: el.selector, text: el.text, html: el.html, shot } }));
}

// Pick mode: the viewer's pointer outlines the element under it with its tag, and a click sends the element back.
export async function inspect(m: any, ws: Peer, s: string) {
  switch (m.t) {
    case 'pick':
      if (m.on === true) {
        await call('DOM.enable', {}, s);
        return call('Overlay.enable', {}, s);
      }
      await call('Overlay.hideHighlight', {}, s).catch(() => {});
      return call('Overlay.disable', {}, s).catch(() => {});
    case 'pickHover':
      return hover(s, num(m.x), num(m.y));
    case 'pickAt':
      return pickAt(ws, s, num(m.x), num(m.y));
  }
}
