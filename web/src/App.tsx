import { useEffect, useState } from 'react';
import { connect, setUi, useStore } from './store';
import { NowPane } from './panes/NowPane';
import { Chat } from './panes/Chat';
import { CodePane } from './panes/CodePane';
import { BrowserPane } from './panes/BrowserPane';
import { FileSwitcher } from './panes/FileSwitcher';
import { Explorer } from './panes/Explorer';
import { Sessions } from './panes/Sessions';
import { Icon } from './Icon';
import { ConnectPopover } from './ConnectPopover';

type Tab = 'now' | 'chat' | 'code' | 'browser';
type View = 'agent' | 'explorer' | 'sessions';

const VIEWS: { id: View; icon: string; title: string }[] = [
  { id: 'agent', icon: 'sparkle', title: 'Agent' },
  { id: 'explorer', icon: 'files', title: 'Explorer' },
  { id: 'sessions', icon: 'history', title: 'Sessions' },
];

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'now', icon: 'sparkle', label: 'Agent' },
  { id: 'chat', icon: 'comment-discussion', label: 'Chat' },
  { id: 'code', icon: 'files', label: 'Code' },
  { id: 'browser', icon: 'globe', label: 'Browser' },
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
  const openFile = useStore((s) => s.ui.openFile);
  const session = useStore((s) => s.session);
  const status = useStore((s) => s.status);
  const [tab, setTab] = useState<Tab>('now');
  const [editor, setEditor] = useState<'file' | 'browser'>('browser');
  const [sidebar, setSidebar] = useState(true);
  const [view, setView] = useState<View>('agent');
  const [chat, setChat] = useState(true);
  const [phone, setPhone] = useState(false);
  const [chatW, setChatW] = useState(() => stored('agentview.chatW', 440));
  const [, rerender] = useState(0);
  const canNotify = 'Notification' in window && Notification.permission === 'default';

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    document.body.classList.add('resizing');
    const move = (ev: PointerEvent) => setChatW(Math.round(Math.min(Math.max(window.innerWidth - ev.clientX, 320), window.innerWidth - 420)));
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
    if (pendingCount > 0) { setChat(true); setTab('chat'); }
  }, [pendingCount]);

  useEffect(() => {
    try { localStorage.setItem('agentview.chatW', String(chatW)); } catch {}
  }, [chatW]);

  useEffect(() => {
    connect();
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'p') { e.preventDefault(); setUi({ switcherOpen: true }); }
      if (k === 'b') { e.preventDefault(); setSidebar((v) => !v); }
      if (k === 'j') { e.preventDefault(); setChat((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (openFile) setEditor('file');
  }, [openFile]);

  const fileName = openFile ? openFile.split('/').pop() : null;
  const project = session.cwd ? session.cwd.split('/').pop() : 'AgentView';
  const mobileExplorer = tab === 'code' && !openFile;

  return (
    <div className="workbench" data-tab={tab} data-sidebar={sidebar} data-chat={chat} style={{ '--chat-w': `${chatW}px` } as React.CSSProperties}>
      <div className="body">
        <aside className="activitybar desktop-only">
          {VIEWS.map((v) => (
            <button key={v.id} className={sidebar && view === v.id ? 'active' : ''} title={v.title} onClick={() => showView(v.id)}>
              <Icon name={v.icon} />
            </button>
          ))}
          <span className="spacer" />
          <button className={chat ? 'active' : ''} title="Chat (⌘J)" onClick={() => setChat((v) => !v)}>
            <Icon name="comment-discussion" />
            {pendingCount > 0 && <span className="badge">{pendingCount}</span>}
          </button>
        </aside>

        <section className="sidebar pane now">
          <div className="sidebar-title">{VIEWS.find((v) => v.id === view)!.title}</div>
          {view === 'agent' ? <NowPane /> : view === 'explorer' ? <Explorer /> : <Sessions />}
        </section>

        <section className={`editor-group pane code ${mobileExplorer ? 'mobile-explorer' : ''}`}>
          {mobileExplorer && <div className="mobile-only mobile-explorer-host"><Explorer /></div>}
          <div className="tabs">
            {openFile && (
              <button className={`tab ${editor === 'file' ? 'active' : ''}`} onClick={() => setEditor('file')} title={openFile}>
                <Icon name="file" small /> {fileName}
                <span className="close" title="Close" onClick={(e) => { e.stopPropagation(); setUi({ openFile: null }); setEditor('browser'); }}>
                  <Icon name="close" small />
                </span>
              </button>
            )}
            <button className={`tab ${editor === 'browser' ? 'active' : ''}`} onClick={() => setEditor('browser')}>
              <Icon name="globe" small /> Browser
            </button>
          </div>
          <div className={`editor ${editor === 'file' ? 'shown' : ''}`}><CodePane /></div>
          <div className={`editor browser ${editor === 'browser' ? 'shown' : ''}`}><BrowserPane /></div>
        </section>

        <div className="sash desktop-only" onPointerDown={startResize} />

        <section className="panel pane chat">
          <div className="panel-title desktop-only">
            <span className="panel-name">Claude</span>
            <span className="spacer" />
            <button className="icon-btn" title="Hide chat (⌘J)" onClick={() => setChat(false)}><Icon name="close" /></button>
          </div>
          <Chat />
        </section>
      </div>

      <footer className="statusbar desktop-only">
        <span className="item project" title={session.cwd}><Icon name="folder" small /> {project}</span>
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
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => { setTab(t.id); if (t.id === 'browser') setEditor('browser'); if (t.id === 'code') setEditor('file'); }}>
            <Icon name={t.icon} />
            <span>{t.label}</span>
            {t.id === 'chat' && pendingCount > 0 && <span className="badge">{pendingCount}</span>}
          </button>
        ))}
      </nav>

      <FileSwitcher />
      {phone && <ConnectPopover onClose={() => setPhone(false)} />}
    </div>
  );
}
