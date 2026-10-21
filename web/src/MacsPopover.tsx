import { useEffect, useState } from 'react';
import { Icon } from './Icon';

type Mac = { name: string; url: string; running: number };
type Connect = { hostname: string; macs: Mac[] };

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

export function switchMac(url: string) {
  const shell = localStorage.getItem('agentview.shell');
  location.href = shell ? `${url}/?shell=${shell}` : url;
}

export function MacsPopover({ onClose }: { onClose: () => void }) {
  const name = useMacName();
  const [macs, setMacs] = useState<Mac[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/connect?port=${location.port}`)
      .then((r) => r.json())
      .then((d: Connect) => setMacs(d.macs ?? []))
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
            <li key={m.url} className="clickable" onClick={() => switchMac(m.url)}>
              <span className={`mcp-dot ${m.running ? 'ok' : 'off'}`} />
              <span className="mac-name">{m.name}</span>
              <span className="detail">{m.running ? `${m.running} working` : 'idle'}</span>
            </li>
          ))}
        </ul>
        {error && <div className="connect-body muted">{error}</div>}
        {!error && !macs && <div className="connect-body muted">Looking on NetBird</div>}
        {macs && macs.length === 0 && <div className="connect-body muted">No other Mac on NetBird runs AgentView.</div>}
        <div className="connect-note muted small">Macs on NetBird that run AgentView. Click one to switch to it.</div>
      </div>
    </div>
  );
}
