import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/Icon';
import { readFlag, saveFlag, wsUrl } from '../ui/util';

type Tab = { id: string; title: string; url: string };
type State = { state: 'off' | 'connecting' | 'on'; reason: string; retry?: boolean; own?: boolean };

const BUTTON = ['left', 'middle', 'right'];
const mods = (e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) =>
  (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);

export function BrowserPane({ onEmpty }: { onEmpty?: () => void }) {
  const ws = useRef<WebSocket | null>(null);
  const img = useRef<HTMLImageElement>(null);
  const kbd = useRef<HTMLTextAreaElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const vp = useRef({ w: 0, h: 0 });
  const touch = useRef(false);
  const [state, setState] = useState<State>({ state: 'connecting', reason: '' });
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const [url, setUrl] = useState('');
  const [editing, setEditing] = useState(false);
  const [full, setFull] = useState(false);
  const [phone, setPhone] = useState(() => readFlag('browser-phone', false));
  const hadTabs = useRef(false);
  const emptied = useRef(onEmpty);
  emptied.current = onEmpty;

  const send = (m: object) => ws.current?.readyState === WebSocket.OPEN && ws.current.send(JSON.stringify(m));
  const tab = tabs.find((t) => t.id === current);

  useEffect(() => {
    let alive = true;
    let delay = 1000;
    let timer: ReturnType<typeof setTimeout>;
    const open = () => {
      const s = new WebSocket(wsUrl('chrome'));
      ws.current = s;
      s.onopen = () => { delay = 1000; };
      s.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.t === 'state') {
          setState(m);
          if (m.state !== 'on') setHasFrame(false);
        }
        if (m.t === 'tabs') {
          setTabs(m.tabs);
          if (hadTabs.current && m.tabs.length === 0) emptied.current?.();
          hadTabs.current = m.tabs.length > 0;
          setCurrent(m.current);
          setPinned(m.pinned);
        }
        if (m.t === 'frame' && img.current) {
          vp.current = { w: m.w, h: m.h };
          img.current.src = `data:image/jpeg;base64,${m.data}`;
          setHasFrame(true);
        }
      };
      s.onclose = () => {
        if (!alive) return;
        setState({ state: 'off', reason: 'server', retry: true });
        setHasFrame(false);
        timer = setTimeout(open, delay);
        delay = Math.min(delay * 2, 10000);
      };
    };
    open();
    return () => {
      alive = false;
      clearTimeout(timer);
      ws.current?.close();
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('browser-full', full);
    return () => document.body.classList.remove('browser-full');
  }, [full]);

  useEffect(() => {
    if (!editing) setUrl(tab?.url ?? '');
  }, [tab?.url, editing]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      send({ t: 'size', w: Math.round(r.width * dpr), h: Math.round(r.height * dpr), cssW: Math.round(r.width), cssH: Math.round(r.height), dpr, mobile: phone && r.width < 700 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [state.state, phone]);

  const pos = (e: { clientX: number; clientY: number }) => {
    if (!img.current) return { x: 0, y: 0 };
    const r = img.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * vp.current.w, y: ((e.clientY - r.top) / r.height) * vp.current.h };
  };

  const onDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.pointerType !== 'mouse') {
      touch.current = true;
      send({ t: 'touch', type: 'touchStart', ...pos(e) });
      return;
    }
    e.preventDefault();
    kbd.current?.focus({ preventScroll: true });
    send({ t: 'mouse', type: 'mousePressed', ...pos(e), button: BUTTON[e.button] ?? 'left', buttons: e.buttons, clickCount: e.detail || 1, modifiers: mods(e) });
  };
  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') {
      if (touch.current) send({ t: 'touch', type: 'touchMove', ...pos(e) });
      return;
    }
    send({ t: 'mouse', type: 'mouseMoved', ...pos(e), button: 'none', buttons: e.buttons, modifiers: mods(e) });
  };
  const onUp = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') {
      if (touch.current) send({ t: 'touch', type: 'touchEnd', ...pos(e) });
      touch.current = false;
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

  if (state.state !== 'on') return <Connect state={state} onSetup={() => send({ t: 'setup' })} />;

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
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) { go(); e.currentTarget.blur(); }
            if (e.key === 'Escape') e.currentTarget.blur();
          }}
        />
        <select className="tab-pick" value={pinned ?? ''} onChange={(e) => send({ t: 'tab', id: e.target.value || null })} title="Which Chrome tab to show">
          <option value="">Follow Claude</option>
          {tabs.map((t) => <option key={t.id} value={t.id}>{t.title || t.url}</option>)}
        </select>
        <button
          className={`icon-btn phone-only${phone ? ' on' : ''}`}
          title={phone ? 'Phone layout is on. Chrome on the Mac shows the page at phone size' : 'Show the page at phone size. Chrome on the Mac shrinks while this is on'}
          aria-pressed={phone}
          onClick={() => {
            const v = !phone;
            setPhone(v);
            saveFlag('browser-phone', v);
          }}
        ><Icon name="device-mobile" /></button>
        <button className="icon-btn phone-only" title="Keyboard" onClick={() => kbd.current?.focus()}><Icon name="keyboard" /></button>
        <button className="icon-btn phone-only" title="Full screen" onClick={() => setFull(true)}><Icon name="screen-full" /></button>
      </div>
      <div className="frame-host" ref={host}>
        {full && <button className="icon-btn browser-exit" title="Exit full screen" onClick={() => setFull(false)}><Icon name="screen-normal" /></button>}
        <img
          ref={img}
          className="chrome-frame"
          alt=""
          hidden={!hasFrame}
          draggable={false}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => { if (touch.current) send({ t: 'touch', type: 'touchCancel', x: 0, y: 0 }); touch.current = false; }}
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

const REASONS: Record<string, string> = {
  nofda: 'macOS blocks AgentView from finding Chrome. AgentView needs Full Disk Access, and macOS forgets it each time AgentView is rebuilt.',
  nochrome: 'Chrome is not running.',
  disabled: 'Chrome is running, but remote debugging is off.',
  denied: 'Chrome refused the connection.',
  timeout: 'Chrome did not answer in time.',
  closed: 'The connection to Chrome closed.',
  server: 'The AgentView server is not reachable.',
};

function Connect({ state, onSetup }: { state: State; onSetup: () => void }) {
  const [asked, setAsked] = useState(false);
  if (state.state === 'connecting') {
    return (
      <div className="browser-pane">
        <div className="empty-state">
          <Icon name="loading" spin />
          <div className="empty-title">Connecting to Chrome</div>
          {!state.own && <div className="muted small">If Chrome asks to allow remote debugging, click Allow.</div>}
        </div>
      </div>
    );
  }
  const fda = state.reason === 'nofda';
  return (
    <div className="browser-pane">
      <div className="empty-state chrome-setup">
        <Icon name="globe" />
        <div className="empty-title">Show your Chrome here</div>
        <div className="muted small">{state.own && state.reason === 'nochrome' ? 'The AgentView Chrome is not running.' : (REASONS[state.reason] ?? state.reason)}</div>
        {state.reason !== 'server' && (
          <button className="primary" onClick={() => { setAsked(true); onSetup(); }}>
            {fda ? 'Open Full Disk Access settings' : 'Connect Chrome'}
          </button>
        )}
        {asked && (
          <div className="muted small">
            {state.own
              ? 'AgentView opens its own Chrome window and connects on its own.'
              : fda
              ? 'If AgentView is already in the Full Disk Access list, select it and remove it with the minus button. Then drag AgentView from the Finder window into the list and turn it on. AgentView connects on its own; if it does not, quit and reopen it from the menu bar.'
              : 'In the Chrome tab that opened, tick "Allow remote debugging for this browser instance", then click Allow. AgentView connects on its own.'}
          </div>
        )}
      </div>
    </div>
  );
}
