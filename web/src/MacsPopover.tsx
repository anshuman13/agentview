import { useEffect, useState } from 'react';
import { Icon } from './Icon';

type Mac = { name: string; url: string; running: number };
type Connect = { hostname: string; macs: Mac[]; netbird?: string };

type Shell = { AgentViewShell?: { remember?: (url: string, name: string) => void } };

let hostname = '';
const listeners = new Set<(name: string) => void>();

fetch('/api/connect?peer=1')
  .then((r) => r.json())
  .then((d: Connect) => {
    hostname = d.hostname;
    (window as Shell).AgentViewShell?.remember?.(location.origin, hostname);
    listeners.forEach((f) => f(hostname));
  })
  .catch(() => {});

export function useMacName() {
  const [name, setName] = useState(hostname);
  useEffect(() => {
    listeners.add(setName);
    return () => void listeners.delete(setName);
  }, []);
  return name;
}

const switched = typeof location !== 'undefined' && new URLSearchParams(location.search).has('switched');

async function switchMac(url: string) {
  try {
    await fetch(`${url}/api/connect?peer=1`, { mode: 'no-cors', signal: AbortSignal.timeout(4000) });
  } catch {
    return false;
  }
  const q = new URLSearchParams({ switched: '1' });
  const shell = localStorage.getItem('agentview.shell');
  if (shell) q.set('shell', shell);
  location.href = `${url}/?${q}`;
  return true;
}

export function SwitchedBanner() {
  const name = useMacName();
  const [shown, setShown] = useState(switched);
  useEffect(() => {
    if (!shown || !name) return;
    const t = setTimeout(() => setShown(false), 5000);
    return () => clearTimeout(t);
  }, [shown, name]);
  if (!shown || !name) return null;
  return (
    <div className="app-update">
      <Icon name="vm" small />
      <span>Switched to {name}</span>
      <button className="icon-btn" title="Close" onClick={() => setShown(false)}><Icon name="close" small /></button>
    </div>
  );
}

export function MacsPopover({ onClose }: { onClose: () => void }) {
  const name = useMacName();
  const [macs, setMacs] = useState<Mac[] | null>(null);
  const [error, setError] = useState('');
  const [netbird, setNetbird] = useState('');
  const [busy, setBusy] = useState('');

  const go = async (m: Mac) => {
    if (busy) return;
    setBusy(m.url);
    setError('');
    if (!(await switchMac(m.url))) {
      setBusy('');
      setError(`Can't reach ${m.name}. Is NetBird connected and AgentView running there?`);
    }
  };

  useEffect(() => {
    fetch(`/api/connect?port=${location.port}`)
      .then((r) => r.json())
      .then((d: Connect) => {
        setMacs(d.macs ?? []);
        setNetbird(d.netbird ?? '');
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay connect-overlay" onClick={onClose}>
      <div className="switcher connect" onClick={(e) => e.stopPropagation()}>
        <div className="connect-head">
          <span>Macs</span>
          <span className="spacer" />
          <button className="icon-btn" title="Close" onClick={onClose}><Icon name="close" /></button>
        </div>
        <ul className="macs">
          <li className="current">
            <span className="mcp-dot ok" />
            <span className="mac-name">{name || location.hostname}</span>
            <span className="detail">this Mac</span>
          </li>
          {macs?.map((m) => (
            <li key={m.url} className="clickable" onClick={() => void go(m)}>
              <span className={`mcp-dot ${m.running ? 'ok' : 'off'}`} />
              <span className="mac-name">{m.name}</span>
              <span className="detail">{busy === m.url ? 'connecting' : m.running ? `${m.running} working` : 'idle'}</span>
            </li>
          ))}
        </ul>
        {error && <div className="connect-body muted">{error}</div>}
        {!error && !macs && <div className="connect-body muted">Looking on NetBird</div>}
        {netbird && <div className="connect-body warn">{netbird}</div>}
        {macs && macs.length === 0 && !netbird && <div className="connect-body muted">No other Mac on NetBird runs AgentView.</div>}
        <div className="connect-note muted small">Macs on NetBird that run AgentView. Click one to switch to it.</div>
      </div>
    </div>
  );
}
