import { useState } from 'react';

export function BrowserPane() {
  const [url, setUrl] = useState(() => localStorage.getItem('agentview.url') ?? 'http://localhost:3000');
  const [src, setSrc] = useState(url);
  const [nonce, setNonce] = useState(0);

  const go = () => {
    const u = url.includes('://') ? url : `http://${url}`;
    setUrl(u);
    setSrc(u);
    try { localStorage.setItem('agentview.url', u); } catch {}
    setNonce((n) => n + 1);
  };

  return (
    <div className="browser-pane">
      <div className="pane-bar">
        <input
          className="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
        />
        <button onClick={go}>Go</button>
        <button onClick={() => setNonce((n) => n + 1)}>Reload</button>
        <a href={src} target="_blank" rel="noreferrer"><button>Open</button></a>
      </div>
      <iframe key={nonce} src={src} title="preview" />
      <div className="muted small hint">
        An iframe can only show pages that allow framing. The Electron shell replaces this with a real webview.
      </div>
    </div>
  );
}
