import { useEffect, useState } from 'react';
import { Icon } from '../ui/Icon';
import { stored, useEscape } from '../ui/util';
import { apiUrl, bundled, knownMacs, macPort, macUrl, setApiBase, trusted, useApiBase } from './api';
import { switchedMac } from './store';
import { loadMacName, useMacName, type Connect, type Mac } from './macName';

export async function reachable(url: string) {
  try {
    await fetch(`${url}/api/connect?peer=1`, { mode: 'no-cors', signal: AbortSignal.timeout(4000) });
    return true;
  } catch {
    return false;
  }
}

async function switchMac(m: Mac) {
  const url = macUrl(m, bundled ? macPort() : location.port);
  if (!m.self && !(await reachable(url))) return false;
  if (bundled) {
    chooseMac(url);
    return true;
  }
  const q = new URLSearchParams({ switched: '1' });
  const shell = stored('agentview.shell', 0);
  if (shell) q.set('shell', String(shell));
  location.href = `${url}/?${q}`;
  return true;
}

function chooseMac(url: string) {
  setApiBase(url);
  loadMacName();
  switchedMac();
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
    // The phone remembers each address it used, so one Mac can be saved under its IP and its NetBird name.
    const others = (list: Mac[]) => {
      if (!bundled) return list;
      const seen = new Set([base, name]);
      return [...list, ...knownMacs().map((k) => ({ name: k.name || k.url, url: k.url, running: 0 }))].filter((m) => {
        if (seen.has(m.url) || seen.has(m.name)) return false;
        seen.add(m.url).add(m.name);
        return true;
      });
    };
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
  }, [base, name]);

  useEscape(onClose);

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
