import { useEffect, useState } from 'react';
import { connect, setUi, useStore } from './store';
import { Brief } from './panes/Brief';
import { Terminal } from './panes/Terminal';
import { CodePane } from './panes/CodePane';
import { BrowserPane } from './panes/BrowserPane';
import { FileSwitcher } from './panes/FileSwitcher';
import { Palette } from './panes/Palette';
import { Explorer, FileIcon } from './panes/Explorer';
import { Changes, ChangesBadge } from './panes/Changes';
import { GitHub, GitHubBadge } from './panes/GitHub';
import { OpenChats, RepoPicker, Sessions } from './panes/Sessions';
import { Icon } from './Icon';
import { ConnectPopover } from './ConnectPopover';
import { McpItem, McpPage } from './panes/McpStatus';
import './page.css';
import { Observe } from './panes/Observe';
import { Deploy } from './panes/Deploy';
import { canNotify, toggleNotify, useNotify } from './notify';
import { THEME_NAMES, useTheme } from './theme';

type Tab = 'chat' | 'code' | 'term' | 'browser' | 'repos';
type View = 'explorer' | 'changes' | 'github' | 'chats' | 'sessions';
type Page = 'observe' | 'deploy' | 'mcp';

const VIEWS: { id: View; icon: string; title: string }[] = [
  { id: 'explorer', icon: 'files', title: 'Explorer' },
  { id: 'changes', icon: 'source-control', title: 'Source Control' },
  { id: 'github', icon: 'github', title: 'GitHub Pull Requests' },
  { id: 'chats', icon: 'comment-discussion', title: 'Chats' },
  { id: 'sessions', icon: 'repo', title: 'Workspace' },
];

const PAGES: { id: Page; icon: string; title: string; kicker: string; sub: (repo: string) => string }[] = [
  { id: 'observe', icon: 'pulse', title: 'Observe', kicker: 'Sentry · Grafana · Snowflake', sub: (r) => `Errors, logs and data for ${r}, read through the same MCP servers Claude uses.` },
  { id: 'deploy', icon: 'rocket', title: 'Deploy', kicker: 'Velodrome', sub: (r) => `Deploys of ${r}: what runs where, and a one-click deploy or rollback.` },
  { id: 'mcp', icon: 'plug', title: 'MCP Servers', kicker: 'Model Context Protocol', sub: (r) => `What Claude can reach from ${r}. Same config as the Claude CLI, checked live.` },
];
const isPage = (v: string): v is Page => PAGES.some((p) => p.id === v);
const pageOf = (id: Page) => PAGES.find((p) => p.id === id)!;

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'chat', icon: 'comment-discussion', label: 'Chat' },
  { id: 'code', icon: 'files', label: 'Files' },
  { id: 'term', icon: 'terminal', label: 'Terminal' },
  { id: 'browser', icon: 'globe', label: 'Browser' },
  { id: 'repos', icon: 'comment-discussion', label: 'Chats' },
];

function stored(key: string, fallback: number) {
  try {
    return Number(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

const shellParam = new URLSearchParams(location.search).get('shell');
if (shellParam) {
  localStorage.setItem('agentview.shell', shellParam);
  history.replaceState(null, '', location.pathname);
}

function AppUpdate() {
  const [ready, setReady] = useState(0);
  useEffect(() => {
    const shell = Number(localStorage.getItem('agentview.shell')) || (/; wv\)/.test(navigator.userAgent) ? 1 : 0);
    if (!shell) return;
    const later = Number(localStorage.getItem('agentview.shell.later'));
    fetch('/api/app').then((r) => r.json()).then((a) => setReady(a.build > shell && a.build > later ? a.build : 0)).catch(() => {});
  }, []);
  if (!ready) return null;
  return (
    <div className="app-update">
      <Icon name="cloud-download" small />
      <span>A new version of the app is ready</span>
      <a href="/api/app.apk">Install</a>
      <button className="icon-btn" title="Later" onClick={() => { localStorage.setItem('agentview.shell.later', String(ready)); setReady(0); }}><Icon name="close" small /></button>
    </div>
  );
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
  const session = useStore((s) => s.session);
  const status = useStore((s) => s.status);
  const [tab, setTab] = useState<Tab>('chat');
  const [editor, setEditor] = useState<'file' | 'browser' | Page>('file');
  const [page, setPage] = useState<Page | null>(null);
  const [more, setMore] = useState(false);
  const openPage = (p: Page) => { setPage(p); setEditor(p); setTab((t) => (window.innerWidth <= 900 ? 'code' : t)); };
  const closePage = () => { setPage(null); setEditor((e) => (isPage(e) ? 'file' : e)); };
  const [sidebar, setSidebar] = useState(true);
  const [view, setView] = useState<View>('explorer');
  const [phone, setPhone] = useState(false);
  const [chatW, setChatW] = useState(() => stored('agentview.chatW', 480));
  const [termH, setTermH] = useState(() => stored('agentview.termH', 240));
  const [terminal, setTerminal] = useState(false);
  const [termOpened, setTermOpened] = useState(terminal && window.innerWidth > 900);
  const notifying = useNotify();
  const [theme, toggleTheme] = useTheme();

  const drag = (e: React.PointerEvent, move: (ev: PointerEvent) => void, cls: string) => {
    e.preventDefault();
    document.body.classList.add(cls);
    const up = () => {
      document.body.classList.remove(cls);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const startResize = (e: React.PointerEvent) => drag(e, (ev) => setChatW(Math.round(Math.min(Math.max(window.innerWidth - ev.clientX, 360), window.innerWidth - 420))), 'resizing');
  const startTermResize = (e: React.PointerEvent) => drag(e, (ev) => setTermH(Math.round(Math.min(Math.max(window.innerHeight - 22 - ev.clientY, 100), window.innerHeight - 200))), 'resizing-v');

  const showView = (v: View) => {
    if (v === view) setSidebar((s) => !s);
    else { setView(v); setSidebar(true); }
  };

  useEffect(() => {
    if (pendingCount > 0) setTab('chat');
  }, [pendingCount]);

  useEffect(() => {
    setTab((t) => (t === 'repos' ? 'chat' : t));
  }, [session.id]);


  useEffect(() => {
    try {
      localStorage.setItem('agentview.chatW', String(chatW));
      localStorage.setItem('agentview.termH', String(termH));
    } catch {}
  }, [chatW, termH]);

  useEffect(() => {
    const show = () => { setTerminal(true); setTab((t) => (window.innerWidth <= 900 ? 'term' : t)); };
    window.addEventListener('agentview:terminal', show);
    return () => window.removeEventListener('agentview:terminal', show);
  }, []);

  useEffect(() => {
    connect();
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'p') { e.preventDefault(); setUi({ switcherOpen: true }); }
      if (k === 'o') { e.preventDefault(); setUi({ repoPicker: true }); }
      if (k === 'b') { e.preventDefault(); setSidebar((v) => !v); }
      if (k === 'j') { e.preventDefault(); setTerminal((v) => !v); }
      if (k === 'e') { e.preventDefault(); setEditor((v) => (v === 'file' ? 'browser' : 'file')); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (openFile) setEditor('file');
  }, [openFile]);

  useEffect(() => {
    if (terminal) setTermOpened(true);
  }, [terminal]);

  useEffect(() => {
    const onCommand = (e: Event) => {
      const [kind, arg] = (e as CustomEvent<{ id: string }>).detail.id.split(':');
      if (kind === 'view') { setView(arg as View); setSidebar(true); }
      else if (kind === 'tab') { setTab(arg as Tab); if (arg === 'browser') setEditor('browser'); if (arg === 'code') setEditor('file'); }
      else if (kind === 'page' && isPage(arg)) openPage(arg);
      else if (kind === 'terminal') setTerminal((v) => !v);
      else if (kind === 'phone') setPhone((v) => !v);
      else if (kind === 'theme') toggleTheme();
    };
    window.addEventListener('agentview:command', onCommand);
    return () => window.removeEventListener('agentview:command', onCommand);
  }, [toggleTheme]);

  const fileName = openFile ? openFile.split('/').pop() : null;
  const closeFile = () => setUi({ openFile: null });
  const showing = tab === 'browser' ? 'browser' : tab === 'code' && !isPage(editor) ? 'file' : editor;
  const active = showing === 'browser' ? 'browser' : isPage(showing) ? showing : openFile ? 'file' : 'empty';
  const project = session.cwd ? session.cwd.split('/').pop() : 'AgentView';
  const mobileExplorer = tab === 'code' && !openFile && !isPage(editor);

  return (
    <div className="workbench" data-tab={tab} data-sidebar={sidebar} style={{ '--chat-w': `${chatW}px` } as React.CSSProperties}>
      <AppUpdate />
      <div className="body">
        <aside className="activitybar desktop-only">
          {VIEWS.map((v) => (
            <button key={v.id} data-view={v.id} className={sidebar && view === v.id ? 'active' : ''} title={v.title} onClick={() => showView(v.id)}>
              <Icon name={v.icon} />
              {v.id === 'chats' && elsewhere > 0 && <span className="badge">{elsewhere}</span>}
              {v.id === 'changes' && <ChangesBadge />}
              {v.id === 'github' && <GitHubBadge />}
            </button>
          ))}
          <span className="divider" />
          {PAGES.map((p) => (
            <button key={p.id} data-view={p.id} className={showing === p.id ? 'active' : ''} title={p.title} onClick={() => openPage(p.id)}>
              <Icon name={p.icon} />
            </button>
          ))}
          <span className="spacer" />
          <button className={editor === 'browser' ? 'active' : ''} title="Switch between the file and the browser (⌘E)" onClick={() => setEditor((v) => (v === 'file' ? 'browser' : 'file'))}>
            <Icon name="globe" />
          </button>
        </aside>

        <section className="sidebar pane side">
          <div className="sidebar-title">{VIEWS.find((v) => v.id === view)!.title}</div>
          {tab === 'repos' && (
            <div className="side-switch mobile-only">
              <button className={view !== 'sessions' ? 'active' : ''} onClick={() => setView('chats')}>Chats</button>
              <button className={view === 'sessions' ? 'active' : ''} onClick={() => setView('sessions')}>Repos</button>
            </div>
          )}
          {view === 'explorer' ? <Explorer /> : view === 'changes' ? <Changes /> : view === 'github' ? <GitHub /> : view === 'chats' ? <OpenChats /> : <Sessions />}
        </section>

        <section className={`editor-group pane code ${mobileExplorer ? 'mobile-explorer' : ''}`}>
          {mobileExplorer && <div className="mobile-only mobile-explorer-host"><Explorer /></div>}
          <div className="tabs">
            <button className={`tab ${showing === 'file' ? 'active' : ''}`} onClick={() => setEditor('file')} title={openFile ?? 'Files (⌘E to switch)'}>
              {fileName ? <FileIcon name={fileName} /> : <Icon name="file" small />} {fileName ?? 'File'}
              {openFile && (
                <span className="close" title="Close file" onClick={(e) => { e.stopPropagation(); closeFile(); }}>
                  <Icon name="close" small />
                </span>
              )}
            </button>
            <button className={`tab browser ${showing === 'browser' ? 'active' : ''}`} onClick={() => setEditor('browser')} title="Browser (⌘E to switch)">
              <Icon name="globe" small /> Browser
            </button>
            {page && (
              <button className={`tab ptab ptab-${page} ${showing === page ? 'active' : ''}`} onClick={() => setEditor(page)} title={pageOf(page).title}>
                <Icon name={pageOf(page).icon} small /> {pageOf(page).title}
                <span className="close" title="Close" onClick={(e) => { e.stopPropagation(); closePage(); }}><Icon name="close" small /></span>
              </button>
            )}
          </div>
          <div className={`editor ${active === 'file' ? 'shown' : ''}`}><CodePane /></div>
          <div className={`editor browser ${active === 'browser' ? 'shown' : ''}`}>{active === 'browser' && <BrowserPane />}</div>
          {page && (
            <div key={page} className={`editor ${active === page ? 'shown' : ''}`}>
              <div className={`page page-${page}`}>
                <header className="page-hero">
                  <div>
                    <div className="page-kicker">{pageOf(page).kicker}</div>
                    <h1>{pageOf(page).title}</h1>
                    <div className="page-sub">{pageOf(page).sub(project ?? 'this repo')}</div>
                  </div>
                  <div id={`page-${page}-extra`} className="page-extra" />
                </header>
                <div className="page-body">{page === 'mcp' ? <McpPage /> : page === 'observe' ? <Observe /> : <Deploy />}</div>
              </div>
            </div>
          )}
          <div className={`editor ${active === 'empty' ? 'shown' : ''}`}>
            <div className="empty-state">
              <Icon name="files" />
              <div className="empty-title">No file open</div>
              <div className="muted small">Pick a file in the Explorer or press ⌘P. Files Claude edits open here.</div>
            </div>
          </div>
          <div className="panel" style={terminal ? { height: termH } : undefined}>
            {terminal && <div className="panel-sash" onPointerDown={startTermResize} />}
            <Terminal key={session.id} chat={session.id} project={project} open={terminal || tab === 'term'} onToggle={() => tab !== 'term' && setTerminal((v) => !v)} />
          </div>
        </section>

        <div className="sash desktop-only" onPointerDown={startResize} />

        <section className="main pane center">
          <Brief />
        </section>
      </div>

      <footer className="statusbar desktop-only">
        <span className="item project clickable" title={`${session.cwd}\nStart a chat in another repo (⌘O)`} onClick={() => setUi({ repoPicker: true })}><Icon name="folder" small /> {project}</span>
        <span className={`item ${session.running ? 'busy' : 'idle'}`}>
          <Icon name={session.running ? 'loading' : 'check'} small spin={session.running} /> {session.running ? 'Working' : 'Idle'}
        </span>
        {!['Idle', 'Working', 'Connecting'].includes(status) && <span className="item status-text">{status}</span>}
        <span className="spacer" />
        <McpItem />
        <CacheItem />
        {canNotify && (
          <span className="item clickable" title={notifying ? 'Notifying you when Claude finishes or needs you. Click to turn off' : 'Notify me when Claude finishes or needs you'} onClick={toggleNotify}>
            <Icon name={notifying ? 'bell' : 'bell-slash'} small />
          </span>
        )}
        <span className="item clickable" title={`Theme: ${THEME_NAMES[theme]}. Click to switch`} onClick={toggleTheme}><Icon name="color-mode" small /></span>
        <span className="item clickable" title="Open on phone" onClick={() => setPhone((v) => !v)}><Icon name="device-mobile" small /></span>
        {!connected && <span className="item error"><Icon name="plug" small /> Disconnected</span>}
      </footer>

      <nav className="tabbar mobile-only">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id && !(t.id === 'code' && isPage(editor)) ? 'active' : ''} onClick={() => { setTab(t.id); if (t.id === 'browser') setEditor('browser'); if (t.id === 'code') setEditor('file'); if (t.id === 'repos') setView('chats'); }}>
            <Icon name={t.icon} />
            <span>{t.label}</span>
            {t.id === 'chat' && pendingCount > 0 && <span className="badge">{pendingCount}</span>}
            {t.id === 'repos' && elsewhere > 0 && <span className="badge">{elsewhere}</span>}
          </button>
        ))}
        <button className={more || (tab === 'code' && isPage(editor)) ? 'active' : ''} onClick={() => setMore((v) => !v)}>
          <Icon name="ellipsis" />
          <span>More</span>
        </button>
      </nav>
      {more && (
        <div className="more-sheet-overlay mobile-only" onClick={() => setMore(false)}>
          <div className="more-sheet" onClick={(e) => e.stopPropagation()}>
            {PAGES.map((p) => (
              <button key={p.id} className={showing === p.id ? 'active' : ''} onClick={() => { openPage(p.id); setMore(false); }}>
                <Icon name={p.icon} />
                <span>{p.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <FileSwitcher />
      <Palette />
      {repoPicker && <RepoPicker />}
      {phone && <ConnectPopover onClose={() => setPhone(false)} />}
    </div>
  );
}
