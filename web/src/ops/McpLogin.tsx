import { useEffect, useState } from 'react';
import { send } from '../app/store';
import { Icon } from '../ui/Icon';
import { command } from '../ui/util';
import { openConnectors, post } from './mcpActions';

export function AddToChat({ name }: { name: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setError(''), [name]);
  const add = () => {
    setBusy(true);
    setError('');
    post(`/api/mcp/add?name=${encodeURIComponent(name)}`).catch((e) => setError(e.message)).finally(() => setBusy(false));
  };
  return (
    <>
      <button className="btn" onClick={add} disabled={busy}><Icon name={busy ? 'loading' : 'add'} small spin={busy} /> Load in this chat</button>
      {error && <span className="mcp-act-error bad" role="alert">{error}</span>}
    </>
  );
}

// claude.ai connectors are authorized on claude.ai, for the account this chat runs on; the chat picks them up on reconnect.
export function ClaudeAiLogin({ name, live, account }: { name: string; live: boolean; account?: string }) {
  const [opened, setOpened] = useState(false);
  useEffect(() => setOpened(false), [name]);
  return (
    <div className="mcp-login">
      <div className="mcp-login-acts">
        <button className="btn" onClick={() => { openConnectors(account); setOpened(true); }}><Icon name="link-external" small /> Connect on claude.ai</button>
        {opened && live && <button className="btn" onClick={() => send({ type: 'mcp_reconnect', name })}><Icon name="debug-restart" small /> Reconnect in chat</button>}
      </div>
      <div className="muted">{opened ? `Opened in ${account === 'alt' ? 'Chrome' : 'Firefox'} on the Mac. Once it says Connected there, reconnect it here.` : `Opens in ${account === 'alt' ? 'Chrome' : 'Firefox'} on the Mac.`}</div>
    </div>
  );
}

export function Login({ name, live }: { name: string; live: boolean }) {
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setOpened(false); setError(''); }, [name]);
  useEffect(() => {
    if (!opened) return;
    const t = setInterval(() => !document.hidden && send({ type: 'mcp_status' }), 3000);
    return () => clearInterval(t);
  }, [opened]);
  const start = () => {
    setBusy(true);
    setError('');
    (live ? Promise.resolve() : post(`/api/mcp/add?name=${encodeURIComponent(name)}`).catch(() => {}))
      .then(() => post(`/api/mcp/login?name=${encodeURIComponent(name)}`))
      .then((r) => { if (r.authUrl) setOpened(true); else send({ type: 'mcp_status' }); })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <div className="mcp-login">
      <div className="mcp-login-acts">
        <button className="btn" onClick={start} disabled={busy}><Icon name={busy ? 'loading' : 'key'} small spin={busy} /> {opened ? 'Open again' : 'Log in'}</button>
        {opened && <button className="btn" onClick={() => command('tab:browser')}><Icon name="globe" small /> Show browser</button>}
      </div>
      {opened && <div className="muted">The login page is open in Chrome on the Mac. This updates once you finish there.</div>}
      {error && <div className="bad" role="alert">{error}</div>}
    </div>
  );
}
