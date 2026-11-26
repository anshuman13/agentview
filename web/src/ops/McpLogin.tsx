import { useEffect, useState } from 'react';
import { send } from '../app/store';
import { Button } from '../ui/Button';
import { command } from '../ui/util';
import { openConnectors } from './mcpActions';
import { addMcp, loginMcp } from './opsApi';

export function AddToChat({ name }: { name: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setError(''), [name]);
  const add = () => {
    setBusy(true);
    setError('');
    addMcp(name).catch((e) => setError(e.message)).finally(() => setBusy(false));
  };
  return (
    <>
      <Button icon={busy ? 'loading' : 'add'} onClick={add} disabled={busy}>Load in this chat</Button>
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
        <Button icon="link-external" onClick={() => { openConnectors(account); setOpened(true); }}>Connect</Button>
        {opened && live && <Button icon="debug-restart" onClick={() => send({ type: 'mcp_reconnect', name })}>Reconnect in chat</Button>}
      </div>
      <div className="muted">{opened ? `Opened in ${account && account !== 'main' ? 'Chrome' : 'Firefox'} on the Mac. Once it says Connected there, reconnect it here.` : `Opens in ${account && account !== 'main' ? 'Chrome' : 'Firefox'} on the Mac.`}</div>
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
    (live ? Promise.resolve() : addMcp(name).catch(() => {}))
      .then(() => loginMcp(name))
      .then((r) => { if (r.authUrl) setOpened(true); else send({ type: 'mcp_status' }); })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <div className="mcp-login">
      <div className="mcp-login-acts">
        <Button icon={busy ? 'loading' : 'key'} onClick={start} disabled={busy}>{opened ? 'Open again' : 'Connect'}</Button>
        {opened && <Button icon="globe" onClick={() => command('tab:browser')}>Show browser</Button>}
      </div>
      {opened && <div className="muted">The login page is open in Chrome on the Mac. This updates once you finish there.</div>}
      {error && <div className="bad" role="alert">{error}</div>}
    </div>
  );
}
