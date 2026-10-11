import { useEffect, useState } from 'react';
import { Icon } from '../Icon';

type Size = 'fill' | 'tablet' | 'phone';
type Screen = { id: number; url: string; size: Size };

const KEY = 'agentview.browsers.v2';
const WIDTH: Record<Size, string> = { fill: '100%', tablet: '768px', phone: '390px' };
const DEFAULT: Screen[] = [{ id: 1, url: '', size: 'fill' }];

function isSelf(url: string) {
  try {
    return new URL(url).origin === location.origin;
  } catch {
    return false;
  }
}

function load(): Screen[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '');
    if (Array.isArray(v) && v.length) return v;
  } catch {}
  return DEFAULT;
}

export function BrowserPane() {
  const [screens, setScreens] = useState<Screen[]>(load);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(screens)); } catch {}
  }, [screens]);

  const update = (id: number, patch: Partial<Screen>) => setScreens((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const add = () => setScreens((s) => [...s, { id: Math.max(0, ...s.map((x) => x.id)) + 1, url: s[s.length - 1]?.url ?? '', size: 'fill' }]);
  const close = (id: number) => setScreens((s) => (s.length > 1 ? s.filter((x) => x.id !== id) : s));

  return (
    <div className="browser-pane">
      <div className="screens">
        {screens.map((s) => (
          <BrowserScreen key={s.id} s={s} onChange={(p) => update(s.id, p)} onAdd={add} onClose={screens.length > 1 ? () => close(s.id) : undefined} />
        ))}
      </div>
    </div>
  );
}

function BrowserScreen({ s, onChange, onAdd, onClose }: { s: Screen; onChange: (p: Partial<Screen>) => void; onAdd: () => void; onClose?: () => void }) {
  const [url, setUrl] = useState(s.url);
  const [nonce, setNonce] = useState(0);

  const go = () => {
    if (!url.trim()) return;
    const u = url.includes('://') ? url : `http://${url}`;
    setUrl(u);
    onChange({ url: u });
    setNonce((n) => n + 1);
  };

  return (
    <div className={`screen size-${s.size}`}>
      <div className="pane-bar browser-bar">
        <button className="icon-btn" title="Reload" onClick={() => setNonce((n) => n + 1)}><Icon name="refresh" /></button>
        <input className="url" placeholder="localhost:3000" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
        <select value={s.size} onChange={(e) => onChange({ size: e.target.value as Size })} title="Viewport">
          <option value="fill">Fill</option>
          <option value="tablet">Tablet</option>
          <option value="phone">Phone</option>
        </select>
        {s.url && <a className="icon-btn" href={s.url} target="_blank" rel="noreferrer" title="Open in a new tab"><Icon name="link-external" /></a>}
        <button className="icon-btn desktop-only" title="Add a screen" onClick={onAdd}><Icon name="split-horizontal" /></button>
        {onClose && <button className="icon-btn" title="Close screen" onClick={onClose}><Icon name="close" /></button>}
      </div>
      <div className="frame-host">
        {!s.url ? (
          <div className="empty-state">
            <Icon name="globe" />
            <div className="empty-title">Preview your app</div>
            <div className="muted small">Enter its address above. Sites that block embedding open in a new tab instead.</div>
          </div>
        ) : isSelf(s.url) ? (
          <div className="empty-state">
            <Icon name="globe" />
            <div className="empty-title">This is AgentView itself</div>
            <div className="muted small">Enter the address of the app you are working on.</div>
          </div>
        ) : (
          <iframe key={nonce} src={s.url} title={s.url} style={{ width: WIDTH[s.size] }} />
        )}
      </div>
    </div>
  );
}
