import { useEffect, useState } from 'react';
import { connect, setUi, useStore } from './store';
import { Brief } from './panes/Brief';
import { Chat } from './panes/Chat';
import { CodePane } from './panes/CodePane';
import { BrowserPane } from './panes/BrowserPane';
import { FileSwitcher } from './panes/FileSwitcher';
import { Explorer } from './panes/Explorer';
import { RepoPicker, Sessions } from './panes/Sessions';
import { Icon } from './Icon';
import { ConnectPopover } from './ConnectPopover';

type Tab = 'now' | 'chat' | 'code' | 'browser' | 'repos';
type View = 'explorer' | 'sessions';

const VIEWS: { id: View; icon: string; title: string }[] = [
  { id: 'explorer', icon: 'files', title: 'Explorer' },
  { id: 'sessions', icon: 'repo', title: 'Workspace' },
];

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'now', icon: 'sparkle', label: 'Brief' },
  { id: 'chat', icon: 'comment-discussion', label: 'Chat' },
  { id: 'code', icon: 'files', label: 'Files' },
  { id: 'browser', icon: 'globe', label: 'Browser' },
  { id: 'repos', icon: 'repo', label: 'Repos' },
];

function stored(key: string, fallback: number) {
  try {
    return Number(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function CacheItem() {
  const cache = useStore((s) => s.session.cache);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!cache) return null;
  const expires = cache.at + cache.ttlMs;
  const left = Math.max(0, Math.round((expires - now) / 1000));
  const k = (n: number) => `${Math.round(n / 1000)}k`;
  const title = `Prompt cache (${cache.ttlMs >= 3_600_000 ? '1h' : '5m'} TTL) ${left ? 'expires' : 'expired'} at ${new Date(expires).toLocaleTimeString()}. Last request read ${k(cache.readTokens)} cached tokens, wrote ${k(cache.writeTokens)}.`;
  return (
    <span className={`item ${left ? '' : 'muted'}`} title={title}>
      <Icon name="database" small /> {left ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Expired'}
    </span>
  );
}

export function App() {
  const connected = useStore((s) => s.ui.connected);
  const pendingCount = useStore((s) => s.pending.length);
  const elsewhere = useStore((s) => s.live.filter((c) => c.id !== s.session.id && c.pending > 0).length);
  const openFile = useStore((s) => s.ui.openFile);
  const repoPicker = useStore((s) => s.ui.repoPicker);
  const center = useStore((s) => s.ui.center);
  const session = useStore((s) => s.session);
  const status = useStore((s) => s.status);
  const [tab, setTab] = useState<Tab>('now');
  const [editor, setEditor] = useState<'file' | 'browser'>('file');
  const [browser, setBrowser] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [view, setView] = useState<View>('explorer');
  const [phone, setPhone] = useState(false);
  const [sideW, setSideW] = useState(() => stored('agentview.sideW', 560));
  const [, rerender] = useState(0);
  const canNotify = 'Notification' in window && Notification.permission === 'default';

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    document.body.classList.add('resizing');
    const move = (ev: PointerEvent) => setSideW(Math.round(Math.min(Math.max(window.innerWidth - ev.clientX, 320), window.innerWidth - 480)));
    const up = () => {
      document.body.classList.remove('resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const showView = (v: View) => {
    if (v === view) setSidebar((s) => !s);
    else { setView(v); setSidebar(true); }
  };

  useEffect(() => {
    if (pendingCount > 0) setTab((t) => (t === 'chat' ? t : 'now'));
  }, [pendingCount]);

  useEffect(() => {
    setTab((t) => (t === 'repos' ? 'now' : t));
  }, [session.id]);

  useEffect(() => {
    setTab((t) => (t === 'now' || t === 'chat' ? (center === 'chat' ? 'chat' : 'now') : t));
  }, [center]);

  useEffect(() => {
    try { localStorage.setItem('agentview.sideW', String(sideW)); } catch {}
  }, [sideW]);

  useEffect(() => {
    connect();
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'p') { e.preventDefault(); setUi({ switcherOpen: true }); }
      if (k === 'o') { e.preventDefault(); setUi({ repoPicker: true }); }
      if (k === 'b') { e.preventDefault(); setSidebar((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (openFile) setEditor('file');
  }, [openFile]);

  const fileName = openFile ? openFile.split('/').pop() : null;
  const side = Boolean(openFile) || browser;
  const toggleBrowser = () => {
    if (browser && editor === 'browser') return closeBrowser();
    setBrowser(true);
    setEditor('browser');
  };
  const closeBrowser = () => {
    setBrowser(false);
    setEditor('file');
  };
  const closeFile = () => {
    setUi({ openFile: null });
    setEditor('browser');
  };
  const active = tab === 'browser' ? 'browser' : tab === 'code' || !browser ? 'file' : !openFile ? 'browser' : editor;
  const project = session.cwd ? session.cwd.split('/').pop() : 'AgentView';
  const mobileExplorer = tab === 'code' && !openFile;

  return (
    <div className="workbench" data-tab={tab} data-sidebar={sidebar} data-side={side} style={{ '--side-w': `${sideW}px` } as React.CSSProperties}>
      <div className="body">
        <aside className="activitybar desktop-only">
          {VIEWS.map((v) => (
            <button key={v.id} className={sidebar && view === v.id ? 'active' : ''} title={v.title} onClick={() => showView(v.id)}>
              <Icon name={v.icon} />
              {v.id === 'sessions' && elsewhere > 0 && <span className="badge">{elsewhere}</span>}
            </button>
          ))}
          <span className="spacer" />
          <button className={browser && editor === 'browser' ? 'active' : ''} title="Browser" onClick={toggleBrowser}>
            <Icon name="globe" />
          </button>
        </aside>

        <section className="sidebar pane side">
          <div className="sidebar-title">{VIEWS.find((v) => v.id === view)!.title}</div>
          {view === 'explorer' ? <Explorer /> : <Sessions />}
        </section>

        <section className="main pane center">
          <div className="tabs desktop-only">
            <button className={`tab ${center === 'brief' ? 'active' : ''}`} onClick={() => setUi({ center: 'brief' })}>
              <Icon name="sparkle" small /> Brief
            </button>
            <button className={`tab ${center === 'chat' ? 'active' : ''}`} onClick={() => setUi({ center: 'chat' })}>
              <Icon name="comment-discussion" small /> Chat
            </button>
          </div>
          <div className={`center-view ${center === 'brief' ? 'shown' : ''}`}><Brief /></div>
          <div className={`center-view ${center === 'chat' ? 'shown' : ''}`}><Chat /></div>
        </section>

        <div className="sash desktop-only" onPointerDown={startResize} />

        <section className={`editor-group pane code ${mobileExplorer ? 'mobile-explorer' : ''}`}>
          {mobileExplorer && <div className="mobile-only mobile-explorer-host"><Explorer /></div>}
          <div className="tabs">
            {openFile && (
              <button className={`tab ${active === 'file' ? 'active' : ''}`} onClick={() => setEditor('file')} title={openFile}>
                <Icon name="file" small /> {fileName}
                <span className="close" title="Close" onClick={(e) => { e.stopPropagation(); closeFile(); }}>
                  <Icon name="close" small />
                </span>
              </button>
            )}
            {(browser || tab === 'browser') && (
              <button className={`tab ${active === 'browser' ? 'active' : ''}`} onClick={() => setEditor('browser')}>
                <Icon name="globe" small /> Browser
                <span className="close desktop-only" title="Close" onClick={(e) => { e.stopPropagation(); closeBrowser(); }}>
                  <Icon name="close" small />
                </span>
              </button>
            )}
          </div>
          <div className={`editor ${active === 'file' ? 'shown' : ''}`}><CodePane /></div>
          <div className={`editor browser ${active === 'browser' ? 'shown' : ''}`}><BrowserPane /></div>
        </section>
      </div>

      <footer className="statusbar desktop-only">
        <span className="item project clickable" title={`${session.cwd}\nStart a chat in another repo (⌘O)`} onClick={() => setUi({ repoPicker: true })}><Icon name="folder" small /> {project}</span>
        <span className={`item ${session.running ? 'busy' : ''}`}>
          <Icon name={session.running ? 'loading' : 'check'} small spin={session.running} /> {session.running ? 'Working' : 'Idle'}
        </span>
        {!['Idle', 'Working', 'Connecting'].includes(status) && <span className="item status-text">{status}</span>}
        <span className="spacer" />
        <CacheItem />
        {canNotify && (
          <span className="item clickable" title="Notify me when Claude finishes or needs you" onClick={() => Promise.resolve(Notification.requestPermission()).catch(() => {}).finally(() => rerender((n) => n + 1))}>
            <Icon name="bell" small />
          </span>
        )}
        <span className="item clickable" title="Open on phone" onClick={() => setPhone((v) => !v)}><Icon name="device-mobile" small /></span>
        {!connected && <span className="item error"><Icon name="plug" small /> Disconnected</span>}
      </footer>

      <nav className="tabbar mobile-only">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => { setTab(t.id); if (t.id === 'browser') setEditor('browser'); if (t.id === 'code') setEditor('file'); if (t.id === 'repos') setView('sessions'); if (t.id === 'now') setUi({ center: 'brief' }); if (t.id === 'chat') setUi({ center: 'chat' }); }}>
            <Icon name={t.icon} />
            <span>{t.label}</span>
            {t.id === 'now' && pendingCount > 0 && <span className="badge">{pendingCount}</span>}
            {t.id === 'repos' && elsewhere > 0 && <span className="badge">{elsewhere}</span>}
          </button>
        ))}
      </nav>

      <FileSwitcher />
      {repoPicker && <RepoPicker />}
      {phone && <ConnectPopover onClose={() => setPhone(false)} />}
    </div>
  );
}
