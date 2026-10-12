import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';

type Tab = { id: string; title: string; url: string };
type State = { state: 'off' | 'connecting' | 'on'; reason: string };

const BUTTON = ['left', 'middle', 'right'];
const mods = (e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) =>
  (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);

export function BrowserPane() {
  const ws = useRef<WebSocket | null>(null);
  const img = useRef<HTMLImageElement>(null);
  const kbd = useRef<HTMLTextAreaElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const vp = useRef({ w: 0, h: 0 });
  const touch = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [state, setState] = useState<State>({ state: 'connecting', reason: '' });
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const [url, setUrl] = useState('');
  const [editing, setEditing] = useState(false);

  const send = (m: object) => ws.current?.readyState === WebSocket.OPEN && ws.current.send(JSON.stringify(m));
  const tab = tabs.find((t) => t.id === current);

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const s = new WebSocket(`${proto}://${location.host}/ws?chrome`);
    ws.current = s;
    s.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === 'state') setState(m);
      if (m.t === 'tabs') {
        setTabs(m.tabs);
        setCurrent(m.current);
        setPinned(m.pinned);
      }
      if (m.t === 'frame' && img.current) {
        vp.current = { w: m.w, h: m.h };
        img.current.src = `data:image/jpeg;base64,${m.data}`;
        setHasFrame(true);
      }
    };
    s.onclose = () => setState({ state: 'off', reason: 'AgentView server disconnected' });
    return () => s.close();
  }, []);

  useEffect(() => {
    if (!editing) setUrl(tab?.url ?? '');
  }, [tab?.url, editing]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      send({ t: 'size', w: Math.round(r.width * dpr), h: Math.round(r.height * dpr) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [state.state]);

  const pos = (e: { clientX: number; clientY: number }) => {
    const r = img.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * vp.current.w, y: ((e.clientY - r.top) / r.height) * vp.current.h };
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') {
      touch.current = { x: e.clientX, y: e.clientY, moved: false };
      return;
    }
    e.preventDefault();
    kbd.current?.focus({ preventScroll: true });
    send({ t: 'mouse', type: 'mousePressed', ...pos(e), button: BUTTON[e.button] ?? 'left', buttons: e.buttons, clickCount: e.detail || 1, modifiers: mods(e) });
  };
  const onMove = (e: React.PointerEvent) => {
    const t = touch.current;
    if (e.pointerType !== 'mouse') {
      if (!t) return;
      const dx = t.x - e.clientX;
      const dy = t.y - e.clientY;
      if (!t.moved && Math.hypot(dx, dy) < 8) return;
      const r = img.current!.getBoundingClientRect();
      const k = vp.current.w / r.width;
      send({ t: 'wheel', ...pos(e), dx: dx * k, dy: dy * k });
      touch.current = { x: e.clientX, y: e.clientY, moved: true };
      return;
    }
    send({ t: 'mouse', type: 'mouseMoved', ...pos(e), button: 'none', buttons: e.buttons, modifiers: mods(e) });
  };
  const onUp = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') {
      if (touch.current && !touch.current.moved) {
        send({ t: 'mouse', type: 'mousePressed', ...pos(e), button: 'left', buttons: 1, clickCount: 1 });
        send({ t: 'mouse', type: 'mouseReleased', ...pos(e), button: 'left', buttons: 0, clickCount: 1 });
      }
      touch.current = null;
      return;
    }
    send({ t: 'mouse', type: 'mouseReleased', ...pos(e), button: BUTTON[e.button] ?? 'left', buttons: e.buttons, clickCount: e.detail || 1, modifiers: mods(e) });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) return;
    if (e.key === 'Unidentified' || e.key === 'Process') return;
    if (e.metaKey && e.key === 'v') return;
    e.preventDefault();
    send({ t: 'key', key: e.key, code: e.code, keyCode: e.keyCode, modifiers: mods(e) });
  };
  const onText = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const text = e.currentTarget.value;
    e.currentTarget.value = '';
    if (text) send({ t: 'text', text });
  };

  const go = () => {
    setEditing(false);
    if (url.trim()) send({ t: 'nav', url: url.trim() });
  };

  if (state.state !== 'on') return <Connect state={state} onConnect={() => send({ t: 'connect' })} />;

  return (
    <div className="browser-pane">
      <div className="pane-bar browser-bar">
        <button className="icon-btn" title="Back" onClick={() => send({ t: 'back' })}><Icon name="arrow-left" /></button>
        <button className="icon-btn desktop-only" title="Forward" onClick={() => send({ t: 'forward' })}><Icon name="arrow-right" /></button>
        <button className="icon-btn" title="Reload" onClick={() => send({ t: 'reload' })}><Icon name="refresh" /></button>
        <input
          className="url"
          placeholder="Address"
          value={url}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { go(); e.currentTarget.blur(); }
            if (e.key === 'Escape') e.currentTarget.blur();
          }}
        />
        <select className="tab-pick" value={pinned ?? ''} onChange={(e) => send({ t: 'tab', id: e.target.value || null })} title="Which Chrome tab to show">
          <option value="">Follow Claude</option>
          {tabs.map((t) => <option key={t.id} value={t.id}>{t.title || t.url}</option>)}
        </select>
        <button className="icon-btn phone-only" title="Keyboard" onClick={() => kbd.current?.focus()}><Icon name="keyboard" /></button>
      </div>
      <div className="frame-host" ref={host}>
        <img
          ref={img}
          className="chrome-frame"
          alt=""
          hidden={!hasFrame}
          draggable={false}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => { touch.current = null; }}
          onWheel={(e) => send({ t: 'wheel', ...pos(e), dx: e.deltaX, dy: e.deltaY })}
          onContextMenu={(e) => e.preventDefault()}
        />
        {!hasFrame && (
          <div className="empty-state">
            <Icon name="globe" />
            <div className="empty-title">{tabs.length ? 'Waiting for the tab to draw' : 'No tab open in Chrome'}</div>
            <div className="muted small">Chrome only draws the tab that is in front. Pick a tab above to bring it forward.</div>
          </div>
        )}
        <textarea ref={kbd} className="chrome-kbd" aria-label="Type into the page" autoCapitalize="off" autoComplete="off" spellCheck={false} onKeyDown={onKey} onInput={onText} onPaste={(e) => { e.preventDefault(); send({ t: 'text', text: e.clipboardData.getData('text') }); }} />
      </div>
    </div>
  );
}

function Connect({ state, onConnect }: { state: State; onConnect: () => void }) {
  const [copied, setCopied] = useState(false);
  const [tried, setTried] = useState(false);
  const address = 'chrome://inspect/#remote-debugging';
  if (state.state === 'connecting') {
    return (
      <div className="browser-pane">
        <div className="empty-state">
          <Icon name="loading" spin />
          <div className="empty-title">Connecting to Chrome</div>
          <div className="muted small">If Chrome on your Mac asks to allow remote debugging, click Allow.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="browser-pane">
      <div className="empty-state chrome-setup">
        <Icon name="globe" />
        <div className="empty-title">Show your Chrome here</div>
        {state.reason === 'disabled' ? (
          <ol className="muted small">
            <li>
              In Chrome on your Mac, open <code>{address}</code>
              <button className="link" onClick={() => { void navigator.clipboard?.writeText(address); setCopied(true); }}>{copied ? 'Copied' : 'Copy'}</button>
            </li>
            <li>Tick "Allow remote debugging for this browser instance". The page should then say "Server running at 127.0.0.1:9222". If it doesn't, quit and reopen Chrome and tick it again.</li>
            <li>Click Connect, then Allow in the dialog Chrome shows.</li>
          </ol>
        ) : (
          <div className="muted small">{state.reason === 'closed' ? 'The connection to Chrome closed.' : state.reason}</div>
        )}
        {tried && state.reason === 'disabled' && <div className="small error-text">Chrome isn't accepting connections yet, so step 2 hasn't taken effect.</div>}
        <button className="primary" onClick={() => { setTried(true); onConnect(); }}>Connect</button>
      </div>
    </div>
  );
}
