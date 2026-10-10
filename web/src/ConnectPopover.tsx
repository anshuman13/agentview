import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function ConnectPopover({ onClose }: { onClose: () => void }) {
  const [urls, setUrls] = useState<string[] | null>(null);
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/connect?port=${location.port}`)
      .then((r) => r.json())
      .then((d: { urls: string[] }) => setUrls(d.urls))
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!urls?.[0]) return;
    QRCode.toDataURL(urls[0], { margin: 2, width: 180, color: { dark: '#000000', light: '#ffffff' } }).then(setQr);
  }, [urls]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay connect-overlay" onClick={onClose}>
      <div className="switcher connect" onClick={(e) => e.stopPropagation()}>
        <div className="connect-head">
          <span>Open on phone</span>
          <span className="spacer" />
          <button className="ghost" title="Close" onClick={onClose}>×</button>
        </div>
        {error && <div className="connect-body muted">{error}</div>}
        {urls && urls.length === 0 && <div className="connect-body muted">No network address found.</div>}
        {urls && urls.length > 0 && (
          <div className="connect-body">
            {qr && <img className="connect-qr" src={qr} alt={urls[0]} />}
            <div className="connect-url">{urls[0]}</div>
            {urls.length > 1 && (
              <ul className="connect-others muted small">
                {urls.slice(1).map((u) => <li key={u}>{u}</li>)}
              </ul>
            )}
          </div>
        )}
        <div className="connect-note muted small">
          Same Wi-Fi only. For outside the network, expose port 5173 (dev) or 7777 (built) with Tailscale or similar.
        </div>
      </div>
    </div>
  );
}
