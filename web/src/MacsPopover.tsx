import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { apiBase, apiUrl, bundled, knownMacs, macOrigin, macPort, setApiBase, shell, trusted, useApiBase } from './api';
import { switchedMac } from './store';

type Mac = { name: string; url: string; running: number; self?: boolean };
type Connect = { hostname: string; macs: Mac[]; netbird?: string };

let hostname = '';
const listeners = new Set<(name: string) => void>();

export function loadMacName() {
  hostname = '';
  listeners.forEach((f) => f(hostname));
  const base = apiBase();
  fetch(apiUrl('/api/connect?peer=1'))
    .then((r) => r.json())
    .then((d: Connect) => {
      if (base !== apiBase()) return;
      hostname = d.hostname;
      shell()?.remember?.(macOrigin(), hostname);
      listeners.forEach((f) => f(hostname));
    })
    .catch(() => {});
}

loadMacName();

export function useMacName() {
  const [name, setName] = useState(hostname);
  useEffect(() => {
    listeners.add(setName);
    return () => void listeners.delete(setName);
  }, []);
  return name;
}

const switched = typeof location !== 'undefined' && new URLSearchParams(location.search).has('switched');

export async function reachable(url: string) {
  try {
    await fetch(`${url}/api/connect?peer=1`, { mode: 'no-cors', signal: AbortSignal.timeout(4000) });
    return true;
  } catch {
    return false;
  }
}

// A Mac cannot reach its own NetBird address, so the Mac the page is viewed from (self) opens on localhost.
async function switchMac(m: Mac) {
  if (bundled) {
    if (!(await reachable(m.url))) return false;
    chooseMac(m.url);
    return true;
  }
  const url = m.self ? `${location.protocol}//localhost${location.port ? `:${location.port}` : ''}` : (await reachable(m.url)) ? m.url : null;
  if (!url) return false;
  const q = new URLSearchParams({ switched: '1' });
  const shell = localStorage.getItem('agentview.shell');
  if (shell) q.set('shell', shell);
  location.href = `${url}/?${q}`;
  return true;
}

export function chooseMac(url: string) {
  setApiBase(url);
  loadMacName();
  switchedMac();
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
  const [address, setAddress] = useState('');
  const base = useApiBase();

  const connectTo = async () => {
    let u = address.trim().replace(/\/+$/, '');
    if (!u || busy) return;
    if (!/^https?:\/\//.test(u)) u = `http://${u}`;
    if (!trusted(u)) return setError("Use your Mac's NetBird address.");
    await go({ name: u, url: u, running: 0 });
  };

  const go = async (m: Mac) => {
    if (busy) return;
    setBusy(m.url);
    setError('');
    if (!(await switchMac(m))) {
      setBusy('');
      setError(`Can't reach ${m.name}. Is NetBird connected and AgentView running there?`);
    }
  };

  useEffect(() => {
    const others = (list: Mac[]) => (bundled ? [...list, ...knownMacs().filter((k) => !list.some((m) => m.url === k.url)).map((k) => ({ name: k.name || k.url, url: k.url, running: 0 }))].filter((m) => m.url !== base) : list);
    const load = () =>
      fetch(apiUrl(`/api/connect?port=${macPort()}`))
        .then((r) => r.json())
        .then((d: Connect) => {
          setMacs(others(d.macs ?? []));
          setNetbird(d.netbird ?? '');
        })
        .catch((e) => (bundled ? setMacs(others([])) : setError(String(e))));
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 10_000);
    return () => clearInterval(t);
  }, [base]);

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
            <span className="dot ok" />
            <span className="mac-name">{name || (bundled ? base.replace(/^https?:\/\//, '') : location.hostname)}</span>
            <span className="detail">this Mac</span>
          </li>
          {macs?.map((m) => (
            <li key={m.url} className="clickable" onClick={() => void go(m)}>
              <span className={`dot ${m.running ? 'ok' : 'off'}`} />
              <span className="mac-name">{m.name}</span>
              <span className="detail">{busy === m.url ? 'connecting' : [m.self && 'you are here', m.running ? `${m.running} working` : 'idle'].filter(Boolean).join(', ')}</span>
            </li>
          ))}
        </ul>
        {error && <div className="connect-body muted">{error}</div>}
        {!error && !macs && <div className="connect-body muted">Looking on NetBird</div>}
        {netbird && <div className="connect-body warn">{netbird}</div>}
        {bundled && (
          <form className="connect-body" onSubmit={(e) => { e.preventDefault(); void connectTo(); }}>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="my-mac.netbird.cloud:7777" autoCapitalize="off" autoCorrect="off" spellCheck={false} inputMode="url" />
          </form>
        )}
        {macs && macs.length === 0 && !netbird && <div className="connect-body muted">No other Mac on NetBird runs AgentView.</div>}
        <div className="connect-note muted small">Macs on NetBird that run AgentView. Click one to switch to it.</div>
      </div>
    </div>
  );
}
