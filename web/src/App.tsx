import { lazy, Suspense, useEffect, useState } from 'react';
import { connect, embedded, getState, presetChat, send, setUi, useStore } from './store';
import { MCP_BAD } from '../../shared/protocol';
import { Brief } from './panes/Brief';
import { AgentsBadge, AgentsPane, AgentsTab } from './panes/AgentsPane';
import { FileSwitcher } from './panes/FileSwitcher';
import { Palette } from './panes/Palette';
import { Explorer, FileIcon } from './panes/Explorer';
import { Changes, ChangesBadge } from './panes/Changes';
import { GitHub, GitHubBadge } from './panes/GitHub';
import { OpenChats, RepoPicker, Sessions } from './panes/Sessions';
import { Icon } from './Icon';
import { pressable } from './panes/util';
import { ConnectPopover } from './ConnectPopover';
import { MacsPopover, SwitchedBanner, useMacName } from './MacsPopover';
import { McpItem, McpPage } from './panes/McpStatus';
import './page.css';

const Terminal = lazy(() => import('./panes/Terminal').then((m) => ({ default: m.Terminal })));
const CodePane = lazy(() => import('./panes/CodePane').then((m) => ({ default: m.CodePane })));
const BrowserPane = lazy(() => import('./panes/BrowserPane').then((m) => ({ default: m.BrowserPane })));
const Loading = () => <div style={{ margin: 'auto', padding: 24, fontSize: 13, color: 'var(--fg-faint, #6e6e6e)' }}>Loading…</div>;
import { Observe } from './panes/Observe';
import { Deploy } from './panes/Deploy';
import { canNotify, toggleNotify, useNotify } from './notify';
import { THEME_NAMES, useTheme } from './theme';
import { ReadAloud } from './panes/Voice';

type Tab = 'chat' | 'code' | 'term' | 'browser' | 'repos' | 'agents';
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
];
const narrow = () => window.innerWidth <= 900;
const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

function stored(key: string, fallback: number) {
  try {
    return Number(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

const params = new URLSearchParams(location.search);
const shellParam = params.get('shell');
if (shellParam) localStorage.setItem('agentview.shell', shellParam);
// Deep links: ?view=github, ?page=observe, ?chat=<live id>, ?session=<saved id> or ?beside=<live id>. Consumed once, then dropped from the URL.
const deepLink = { view: params.get('view'), page: params.get('page'), chat: params.get('chat'), session: params.get('session') };
if (deepLink.chat || deepLink.session) presetChat(deepLink.chat, deepLink.session);
if (params.get('beside') && !embedded) setUi({ beside: params.get('beside') });
if (params.size) history.replaceState(null, '', location.pathname);

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

function Restarting() {
  const restarting = useStore((s) => s.ui.restarting && s.ui.connected);
  const busy = useStore((s) => s.live.filter((c) => c.running).length);
  if (!restarting) return null;
  return (
    <div className="app-update">
      <Icon name="debug-restart" small />
      <span>Restarting AgentView when {busy > 1 ? `${busy} chats finish` : 'Claude finishes'}</span>
      <a href="#" onClick={(e) => { e.preventDefault(); send({ type: 'restart', now: true }); }}>Restart now</a>
    </div>
  );
}

function Offline() {
  const connected = useStore((s) => s.ui.connected);
  const restarting = useStore((s) => s.ui.restarting);
  const [late, setLate] = useState(false);
  useEffect(() => {
    setLate(false);
    if (connected) return;
    const t = setTimeout(() => setLate(true), 2000);
    return () => clearTimeout(t);
  }, [connected]);
  if (connected || !late) return null;
  return (
    <div className="app-update offline mobile-only">
      <Icon name="plug" small />
      <span>{restarting ? 'AgentView is restarting' : 'Disconnected from the Mac, reconnecting'}</span>
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
  const elsewhere = useStore((s) => s.live.filter((c) => c.id !== s.session.id && c.pending > 0).length + s.attention.length);
  const openFile = useStore((s) => s.ui.openFile);
  const repoPicker = useStore((s) => s.ui.repoPicker);
  const session = useStore((s) => s.session);
  const status = useStore((s) => s.status);
  const mcp = useStore((s) => s.session.mcp);
  const [tab, setTab] = useState<Tab>('chat');
  const [editor, setEditor] = useState<'file' | 'browser' | 'agents' | Page>('file');
  const [agentSel, setAgentSel] = useState<string | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [more, setMore] = useState(false);
  const [browse, setBrowse] = useState(false);
  const openPage = (p: Page) => { setPage(p); setEditor(p); setTab((t) => (narrow() ? 'code' : t)); };
  const closePage = () => { setPage(null); setEditor((e) => (isPage(e) ? 'file' : e)); };
  const [sidebar, setSidebar] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const [view, setView] = useState<View>('explorer');
  const [phone, setPhone] = useState(false);
  const [macs, setMacs] = useState(false);
  const macName = useMacName();
  const [chatW, setChatW] = useState(() => stored('agentview.chatW', 480));
  const [termH, setTermH] = useState(() => stored('agentview.termH', 240));
  const [terminal, setTerminal] = useState(false);
  const notifying = useNotify();
  const [theme, toggleTheme] = useTheme();
  const beside = useStore((s) => (s.ui.beside && s.ui.beside !== s.session.id ? s.ui.beside : null));
  const besideChat = useStore((s) => s.live.find((c) => c.id === s.ui.beside));
  const besideGone = useStore((s) => Boolean(s.ui.beside) && s.live.length > 0 && !s.live.some((c) => c.id === s.ui.beside));

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
    if (besideGone) setUi({ beside: null });
    else localStorage.setItem('agentview.beside', beside ?? '');
  }, [beside, besideGone]);

  // The side column tells the page which chat it shows; the page keeps the title and the stored id in step.
  useEffect(() => {
    if (embedded) {
      if (session.id) window.parent.postMessage({ type: 'agentview:chat', id: session.id }, location.origin);
      return;
    }
    const on = (e: MessageEvent) => { if (e.origin === location.origin && e.data?.type === 'agentview:chat' && typeof e.data.id === 'string') setUi({ beside: e.data.id }); };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [session.id]);

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
    const show = () => { setTerminal(true); setTab((t) => (narrow() ? 'term' : t)); };
    window.addEventListener('agentview:terminal', show);
    return () => window.removeEventListener('agentview:terminal', show);
  }, []);

  useEffect(() => {
    connect();
    const onKey = (e: KeyboardEvent) => {
      if (!(MAC ? e.metaKey : e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'p') { e.preventDefault(); setUi({ switcherOpen: true }); }
      if (k === 'o') { e.preventDefault(); setUi({ repoPicker: true }); }
      if (e.code === 'KeyB' && e.altKey) { e.preventDefault(); setChatOpen((v) => !v); }
      else if (k === 'b') { e.preventDefault(); setSidebar((v) => !v); }
      if (k === 'j') { e.preventDefault(); setTerminal((v) => !v); }
      if (k === 'e') { e.preventDefault(); setEditor((v) => (v === 'file' ? 'browser' : 'file')); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!openFile) return;
    setEditor('file');
    setBrowse(false);
    if (narrow() && !getState().ui.follow) setTab((t) => (t === 'chat' || t === 'repos' ? 'code' : t));
  }, [openFile]);

  useEffect(() => {
    const open = (e: Event) => {
      const id = (e as CustomEvent<unknown>).detail;
      setAgentSel(typeof id === 'string' ? id : null);
      setEditor('agents');
      setTab((t) => (narrow() ? 'agents' : t));
    };
    window.addEventListener('open-agent', open);
    return () => window.removeEventListener('open-agent', open);
  }, []);

  useEffect(() => {
    const onCommand = (e: Event) => {
      const [kind, arg] = (e as CustomEvent<{ id: string }>).detail.id.split(':');
      if (kind === 'view') {
        setView(arg as View);
        setSidebar(true);
        if (narrow() && arg === 'explorer') { setTab('code'); setEditor('file'); setBrowse(true); }
        else if (narrow()) setTab('repos');
      }
      else if (kind === 'tab') {
        if (arg === 'chat') setChatOpen(true);
        else if (arg === 'term') setTerminal(true);
        else setEditor(arg === 'code' ? 'file' : (arg as 'browser' | 'agents'));
        if (narrow()) setTab(arg as Tab);
        if (arg === 'chat') window.dispatchEvent(new CustomEvent('agentview:focus'));
      }
      else if (kind === 'page' && isPage(arg)) openPage(arg);
      else if (kind === 'terminal') { if (narrow()) setTab('term'); else setTerminal((v) => !v); }
      else if (kind === 'switchEditor') setEditor((v) => (v === 'file' ? 'browser' : 'file'));
      else if (kind === 'phone') setPhone((v) => !v);
      else if (kind === 'toggleSidebar') setSidebar((v) => !v);
      else if (kind === 'toggleChat') setChatOpen((v) => !v);
      else if (kind === 'theme') toggleTheme();
    };
    window.addEventListener('agentview:command', onCommand);
    return () => window.removeEventListener('agentview:command', onCommand);
  }, [toggleTheme]);

  useEffect(() => {
    const id = deepLink.page && isPage(deepLink.page) ? `page:${deepLink.page}` : VIEWS.some((v) => v.id === deepLink.view) ? `view:${deepLink.view}` : null;
    if (id) window.dispatchEvent(new CustomEvent('agentview:command', { detail: { id } }));
  }, []);

  const fileName = openFile ? openFile.split('/').pop() : null;
  const closeFile = () => setUi({ openFile: null });
  const showing = tab === 'browser' ? 'browser' : tab === 'agents' ? 'agents' : tab === 'code' && !isPage(editor) ? 'file' : editor;
  const active = showing === 'browser' ? 'browser' : showing === 'agents' ? 'agents' : isPage(showing) ? showing : openFile ? 'file' : 'empty';
  const project = session.cwd ? session.cwd.split('/').pop() : 'AgentView';
  const mobileExplorer = tab === 'code' && (!openFile || browse) && !isPage(editor);
  const chatsView = view === 'chats' || view === 'sessions';
  const inChats = tab === 'repos' && chatsView;
  const inMore = tab === 'term' || (tab === 'repos' && !chatsView) || (tab === 'code' && isPage(editor));
  const mcpOk = mcp.filter((m) => m.status === 'connected').length;
  const goTab = (t: Tab) => {
    setMore(false);
    if (t === 'code' && tab === 'code' && !isPage(editor) && openFile) setBrowse((v) => !v);
    if (t === 'agents' && tab === 'agents') setAgentSel(null);
    setTab(t);
    if (t === 'agents') setEditor('agents');
    if (t === 'browser') setEditor('browser');
    if (t === 'code') setEditor('file');
  };
  const goSide = (v: View) => { setMore(false); setView(v); setTab('repos'); };
  const act = (f: () => void) => () => { setMore(false); f(); };
  const reopen = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    const row = el.closest<HTMLElement>('.ex-row');
    if (row && !el.closest('.ex-close') && row.title === openFile) setBrowse(false);
  };

  if (embedded) {
    return (
      <div className="workbench embed" data-tab="chat" data-sidebar="false" data-chat="true" data-editor="false">
        <SwitchedBanner />
        <Restarting />
        <Offline />
        <div className="body"><section className="main pane center"><Brief /></section></div>
      </div>
    );
  }

  return (
    <div className="workbench" data-tab={tab} data-sidebar={sidebar} data-chat={chatOpen} data-editor={active !== 'empty' || terminal || !chatOpen} style={{ '--chat-w': `${chatW}px` } as React.CSSProperties}>
      <AppUpdate />
      <SwitchedBanner />
      <Restarting />
      <Offline />
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
          {tab === 'repos' && chatsView && (
            <div className="side-switch mobile-only">
              <button className={view !== 'sessions' ? 'active' : ''} onClick={() => setView('chats')}>Chats</button>
              <button className={view === 'sessions' ? 'active' : ''} onClick={() => setView('sessions')}>Repos</button>
            </div>
          )}
          {view === 'explorer' ? <Explorer /> : view === 'changes' ? <Changes /> : view === 'github' ? <GitHub /> : view === 'chats' ? <OpenChats /> : <Sessions />}
        </section>

        <section className={`editor-group pane code ${mobileExplorer ? 'mobile-explorer' : ''}`}>
          {mobileExplorer && <div className="mobile-only mobile-explorer-host" onClick={reopen}><Explorer /></div>}
          <div className="tabs">
            <button className={`tab ex-tab mobile-only ${mobileExplorer ? 'active' : ''}`} title="Explorer" onClick={() => { setTab('code'); setEditor('file'); setBrowse(true); }}>
              <Icon name="files" small />
            </button>
            <div className={`tab ${showing === 'file' && !mobileExplorer ? 'active' : ''}`} {...pressable(() => { setEditor('file'); setBrowse(false); setTab((t) => (t === 'browser' || t === 'agents' ? 'code' : t)); })} title={openFile ?? 'Files (⌘E to switch)'}>
              {fileName ? <FileIcon name={fileName} /> : <Icon name="file" small />} {fileName ?? 'File'}
              {openFile && (
                <button className="close" title="Close file" onClick={(e) => { e.stopPropagation(); closeFile(); }}>
                  <Icon name="close" small />
                </button>
              )}
            </div>
            <button className={`tab browser ${showing === 'browser' ? 'active' : ''}`} onClick={() => { setEditor('browser'); setTab((t) => (t === 'code' || t === 'agents' ? 'browser' : t)); }} title="Browser (⌘E to switch)">
              <Icon name="globe" small /> Browser
            </button>
            <AgentsTab active={showing === 'agents'} onOpen={() => { setEditor('agents'); setTab((t) => (t === 'code' || t === 'browser' ? 'agents' : t)); }} />
            {page && (
              <div className={`tab ptab ptab-${page} ${showing === page ? 'active' : ''}`} {...pressable(() => { setEditor(page); setTab((t) => (t === 'browser' || t === 'agents' ? 'code' : t)); })} title={pageOf(page).title}>
                <Icon name={pageOf(page).icon} small /> {pageOf(page).title}
                <button className="close" title="Close" onClick={(e) => { e.stopPropagation(); closePage(); }}><Icon name="close" small /></button>
              </div>
            )}
            <span className="tabs-spacer desktop-only" />
            <button className="tab-tool desktop-only" title={`${sidebar ? 'Hide' : 'Show'} the left sidebar (⌘B)`} onClick={() => setSidebar((v) => !v)}>
              <Icon name={sidebar ? 'layout-sidebar-left' : 'layout-sidebar-left-off'} small />
            </button>
            <button className="tab-tool desktop-only" title={`${chatOpen ? 'Hide' : 'Show'} the chat (⌥⌘B)`} onClick={() => setChatOpen((v) => !v)}>
              <Icon name={chatOpen ? 'layout-sidebar-right' : 'layout-sidebar-right-off'} small />
              {!chatOpen && pendingCount > 0 && <span className="badge">{pendingCount}</span>}
            </button>
          </div>
          <div className={`editor ${active === 'file' ? 'shown' : ''}`}><Suspense fallback={<Loading />}><CodePane /></Suspense></div>
          <div className={`editor ${active === 'agents' ? 'shown' : ''}`}>{active === 'agents' && <AgentsPane selected={agentSel} onSelect={setAgentSel} />}</div>
          <div className={`editor browser ${active === 'browser' ? 'shown' : ''}`}>{active === 'browser' && <Suspense fallback={<Loading />}><BrowserPane onEmpty={() => setEditor('file')} /></Suspense>}</div>
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
            <Suspense fallback={null}><Terminal key={session.id} chat={session.id} project={project} open={terminal || tab === 'term'} onToggle={() => tab !== 'term' && setTerminal((v) => !v)} /></Suspense>
          </div>
        </section>

        <div className="sash desktop-only" onPointerDown={startResize} />

        <section className="main pane center">
          <Brief />
        </section>
        {beside && (
          <section className="main pane center beside desktop-only">
            <div className="beside-head">
              <Icon name="comment-discussion" small />
              <span className="name" title={besideChat ? `${besideChat.title}\n${besideChat.cwd}` : ''}>{besideChat ? `${besideChat.cwd.split('/').pop()} · ${besideChat.title}` : 'Chat'}</span>
              <span className="spacer" />
              <button className="icon-btn" title="Show this chat in the main column" onClick={() => send({ type: 'view', id: beside })}><Icon name="arrow-left" small /></button>
              <button className="icon-btn" title="Close the side chat" onClick={() => setUi({ beside: null })}><Icon name="close" small /></button>
            </div>
            <iframe key={beside} className="beside-frame" title="Side chat" src={`/?chat=${encodeURIComponent(beside)}`} />
          </section>
        )}
      </div>

      <footer className="statusbar desktop-only">
        <button className="item project clickable" title={`${session.cwd}\nStart a chat in another repo (⌘O)`} onClick={() => setUi({ repoPicker: true })}><Icon name="folder" small /> {project}</button>
        <span className={`item ${session.running ? 'busy' : 'idle'}`}>
          <Icon name={session.running ? 'loading' : 'check'} small spin={session.running} /> {session.running ? 'Working' : 'Idle'}
        </span>
        {!['Idle', 'Working', 'Connecting'].includes(status) && <span className="item status-text">{status}</span>}
        <span className="spacer" />
        <McpItem />
        <CacheItem />
        {canNotify && (
          <button className="item clickable" title={notifying ? 'Notifying you when Claude finishes or needs you. Click to turn off' : 'Notify me when Claude finishes or needs you'} onClick={toggleNotify}>
            <Icon name={notifying ? 'bell' : 'bell-slash'} small />
          </button>
        )}
        <button className="item clickable" title={`Theme: ${THEME_NAMES[theme]}. Click to switch`} onClick={toggleTheme}><Icon name="color-mode" small /></button>
        <button className="item clickable" title="Open on phone" onClick={() => setPhone((v) => !v)}><Icon name="device-mobile" small /></button>
        <button className="item clickable" title="Switch to another Mac" onClick={() => setMacs((v) => !v)}><Icon name="vm" small /> {macName}</button>
        {!connected && <span className="item error"><Icon name="plug" small /> Disconnected</span>}
      </footer>

      <nav className="tabbar mobile-only">
        {TABS.map((t) => [
          <button key={t.id} className={tab === t.id && !(t.id === 'code' && isPage(editor)) && !more ? 'active' : ''} onClick={() => goTab(t.id)}>
            <Icon name={t.icon} />
            <span>{t.label}</span>
            {t.id === 'chat' && pendingCount > 0 && <span className="badge">{pendingCount}</span>}
          </button>,
          t.id === 'chat' && (
            <button key="chats" className={inChats && !more ? 'active' : ''} onClick={() => goSide('chats')}>
              <Icon name="comment-discussion" />
              <span>Chats</span>
              {elsewhere > 0 && <span className="badge">{elsewhere}</span>}
            </button>
          ),
        ])}
        <button className={tab === 'agents' && !more ? 'active' : ''} onClick={() => goTab('agents')}>
          <Icon name="hubot" />
          <span>Agents</span>
          <AgentsBadge />
        </button>
        <button className={more || inMore ? 'active' : ''} onClick={() => setMore((v) => !v)}>
          <Icon name="ellipsis" />
          <span>More</span>
        </button>
      </nav>
      {more && (
        <div className="more-sheet-overlay mobile-only" onClick={() => setMore(false)}>
          <div className="more-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="more-status">
              <button className="more-project" title={`${session.cwd}\nStart a chat in another repo`} onClick={act(() => setUi({ repoPicker: true }))}>
                <Icon name="folder" small /><span>{project}</span>
              </button>
              <ReadAloud />
              {canNotify && (
                <button className="icon-btn" title={notifying ? 'Turn off notifications' : 'Notify me when Claude finishes or needs you'} onClick={toggleNotify}>
                  <Icon name={notifying ? 'bell' : 'bell-slash'} />
                </button>
              )}
              <button className="icon-btn" title={`Theme: ${THEME_NAMES[theme]}. Tap to switch`} onClick={toggleTheme}><Icon name="color-mode" /></button>
            </div>
            <button className={tab === 'term' ? 'active' : ''} onClick={() => goTab('term')}>
              <Icon name="terminal" /><span>Terminal</span>
            </button>
            <button className={tab === 'repos' && view === 'changes' ? 'active' : ''} onClick={() => goSide('changes')}>
              <Icon name="source-control" /><span>Source Control</span><ChangesBadge />
            </button>
            <button className={tab === 'repos' && view === 'github' ? 'active' : ''} onClick={() => goSide('github')}>
              <Icon name="github" /><span>Pull Requests</span><GitHubBadge />
            </button>
            <span className="more-label">Tools</span>
            {PAGES.map((p) => (
              <button key={p.id} className={showing === p.id && tab === 'code' ? 'active' : ''} onClick={act(() => openPage(p.id))}>
                <Icon name={p.icon} />
                <span>{p.title}</span>
                {p.id === 'mcp' && mcp.length > 0 && <span className="more-meta"><span className={`mcp-dot ${mcp.some((m) => MCP_BAD.includes(m.status)) ? 'bad' : mcpOk ? 'ok' : 'off'}`} /> {mcpOk}/{mcp.length}</span>}
              </button>
            ))}
            <span className="more-divider" />
            <button onClick={act(() => setMacs(true))}>
              <Icon name="vm" /><span>{macName || 'Macs'}</span><span className="more-meta">switch</span>
            </button>
            <button onClick={act(() => window.dispatchEvent(new Event('agentview:palette')))}>
              <Icon name="terminal-cmd" /><span>Command Palette</span>
            </button>
          </div>
        </div>
      )}

      <FileSwitcher />
      <Palette />
      {repoPicker && <RepoPicker />}
      {phone && <ConnectPopover onClose={() => setPhone(false)} />}
      {macs && <MacsPopover onClose={() => setMacs(false)} />}
    </div>
  );
}
