import { Suspense, useEffect, useRef, useState } from 'react';
import { connect, embedded, getState, send, setUi, useStore } from './store';
import { openAgent } from '../sessions/agents';
import { FileIcon } from '../workspace/FileIcon';
import { ChangesBadge } from '../workspace/gitStatus';
import { GitHubBadge } from '../ops/pulls';
import { Icon } from '../ui/Icon';
import { command, pressable, save, stored } from '../ui/util';
import { haptic } from '../ui/haptic';
import { slideFrom, useTabSwipe } from './tabSwipe';
import { Unreachable, useUnreachable } from './Unreachable';
import { MacsPopover, SwitchedBanner, useMacName } from './MacsPopover';
import { Guard } from './Guard';
import { deepLink } from './deepLinks';
import { isPage, pageOf, PageView, PAGES, type Page } from './pages';
import { Brief, AgentsPane, FileSwitcher, Palette, OpenChats, RepoPicker, Sessions, AssistantNav, Assistant, Explorer, Changes, GitHub, Terminal, CodePane, BrowserPane, ConnectPopover, Loading } from './lazy';
import { AppUpdate, Offline, Restarting } from './StatusItems';
import { StatusBar } from './StatusBar';
import { useTheme } from './theme';
import { MoreSheet, TabBar, type Tab, type View } from './TabBar';
import { touch } from './touch';

const VIEWS: { id: View; icon: string; title: string }[] = [
  { id: 'assistant', icon: 'sparkle', title: 'Codex' },
  { id: 'explorer', icon: 'files', title: 'Explorer' },
  { id: 'changes', icon: 'source-control', title: 'Source Control' },
  { id: 'github', icon: 'github', title: 'GitHub Pull Requests' },
  { id: 'chats', icon: 'comment-discussion', title: 'Sessions' },
  { id: 'sessions', icon: 'repo', title: 'Workspace' },
];

const narrow = () => window.innerWidth <= 900;

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

export function App() {
  const pendingCount = useStore((s) => s.pending.length);
  const elsewhere = useStore((s) => s.live.filter((c) => c.id !== s.session.id && c.pending > 0).length + s.attention.length);
  const openFile = useStore((s) => s.ui.openFile);
  const repoPicker = useStore((s) => s.ui.repoPicker);
  const session = useStore((s) => s.session);
  const [tab, setTab] = useState<Tab>(() => (narrow() && !deepLink.chat && !deepLink.session ? 'assistant' : 'chat'));
  const [editor, setEditor] = useState<'file' | 'browser' | 'agents' | 'assistant' | Page>('file');
  const [seenAssistant, setSeenAssistant] = useState(false);
  const [agentSel, setAgentSel] = useState<string | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [more, setMore] = useState(false);
  const [browse, setBrowse] = useState(false);
  const openPage = (p: Page) => { setPage(p); setEditor(p); setTab((t) => (narrow() ? 'code' : t)); };
  const reveal = (el: HTMLElement | null) => el?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  const closePage = () => { setPage(null); setEditor((e) => (isPage(e) ? 'file' : e)); };
  const [sidebar, setSidebar] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const [view, setView] = useState<View>('explorer');
  const [phone, setPhone] = useState(false);
  const [macs, setMacs] = useState(false);
  const macName = useMacName();
  const [chatW, setChatW] = useState(() => stored<number>('agentview.chatW', 480) || 480);
  const [termH, setTermH] = useState(() => stored<number>('agentview.termH', 240) || 240);
  const [terminal, setTerminal] = useState(false);
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
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  const startResize = (e: React.PointerEvent) => drag(e, (ev) => setChatW(Math.round(Math.min(Math.max(window.innerWidth - ev.clientX, 360), window.innerWidth - 420))), 'resizing');
  const startTermResize = (e: React.PointerEvent) => drag(e, (ev) => setTermH(Math.round(Math.min(Math.max(window.innerHeight - 22 - ev.clientY, 100), window.innerHeight - 200))), 'resizing-v');

  const showView = (v: View) => {
    if (v === 'assistant') return openAssistant(view === 'assistant' && editor === 'assistant' && sidebar);
    if (editor === 'assistant') { setEditor('file'); setView(v); setSidebar(true); return; }
    if (v === view) setSidebar((s) => !s);
    else { setView(v); setSidebar(true); }
  };
  // Desktop: the lists go in the sidebar and the feed in the editor area. Phone: its own tab.
  const openAssistant = (toggleSidebar = false) => {
    setMore(false);
    setEditor('assistant');
    if (narrow()) setTab('assistant');
    else if (toggleSidebar) setSidebar(false);
    else { setView('assistant'); setSidebar(true); }
    window.dispatchEvent(new Event('assistant:shown'));
  };

  useEffect(() => {
    if (pendingCount > 0) setTab('chat');
  }, [pendingCount]);

  useEffect(() => {
    if (besideGone) setUi({ beside: null });
    else try { localStorage.setItem('agentview.beside', beside ?? ''); } catch {}
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

  // The first init swaps the preset chat id for the server's; that is not a chat switch, so a deep-linked view stays.
  const prevId = useRef(session.id);
  useEffect(() => {
    const from = prevId.current;
    prevId.current = session.id;
    if (deepLink.view && from === deepLink.chat) return;
    setTab((t) => {
      if (t !== 'repos') return t;
      slideFrom(1);
      return 'chat';
    });
  }, [session.id]);

  useEffect(() => {
    save('agentview.chatW', chatW);
    save('agentview.termH', termH);
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
      if (k === 'i') { e.preventDefault(); command('assistant'); setTimeout(() => window.dispatchEvent(new Event('assistant:focus')), 50); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A file Claude edits while a page or the browser is shown goes to Open Editors without taking the editor.
  useEffect(() => {
    if (!openFile) return;
    if (getState().ui.follow && editor !== 'file') return;
    setEditor('file');
    setBrowse(false);
    if (narrow() && !getState().ui.follow) setTab((t) => (t === 'chat' || t === 'repos' ? 'code' : t));
  }, [openFile]);

  useEffect(() => {
    const open = (e: Event) => {
      if (!narrow()) return setChatOpen(true);
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
      if (kind === 'assistant' || (kind === 'view' && arg === 'assistant')) openAssistant();
      else if (kind === 'view') {
        setView(arg as View);
        setSidebar(true);
        if (narrow() && arg === 'explorer') { setTab('code'); setEditor('file'); setBrowse(true); }
        else if (narrow()) setTab('repos');
      }
      else if (kind === 'tab') {
        if (arg === 'agents' && !narrow()) return openAgent();
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

  // Applied once the first init is in, so the chat switch does not undo it on the phone.
  const linked = useRef(false);
  useEffect(() => {
    if (!session.id || linked.current) return;
    linked.current = true;
    const id = deepLink.page && isPage(deepLink.page) ? `page:${deepLink.page}` : VIEWS.some((v) => v.id === deepLink.view) ? `view:${deepLink.view}` : null;
    if (id) command(id);
  }, [session.id]);

  const fileName = openFile ? openFile.split('/').pop() : null;
  const closeFile = () => setUi({ openFile: null });
  const showing = tab === 'assistant' ? 'assistant' : tab === 'browser' ? 'browser' : tab === 'agents' ? 'agents' : tab === 'code' && !isPage(editor) ? 'file' : editor;
  const unreachable = useUnreachable();
  const active = showing === 'assistant' ? 'assistant' : unreachable ? 'offline' : showing === 'browser' ? 'browser' : showing === 'agents' ? 'agents' : isPage(showing) ? showing : openFile ? 'file' : 'empty';
  const project = session.cwd ? session.cwd.split('/').pop() : 'AgentView';
  const mobileExplorer = tab === 'code' && (!openFile || browse) && !isPage(editor);
  const chatsView = view === 'chats' || view === 'sessions';
  const inChats = tab === 'repos' && chatsView;
  const inMore = tab === 'term' || tab === 'browser' || tab === 'code' || (tab === 'repos' && !chatsView);
  const goTab = (t: Tab) => {
    haptic();
    setMore(false);
    if (t === 'code' && tab === 'code' && !isPage(editor) && openFile) setBrowse((v) => !v);
    if (t === 'agents' && tab === 'agents') setAgentSel(null);
    setTab(t);
    if (t === 'agents') setEditor('agents');
    if (t === 'browser') setEditor('browser');
    if (t === 'code') setEditor('file');
    if (t === 'assistant') { setEditor('assistant'); window.dispatchEvent(new Event('assistant:shown')); }
  };
  useEffect(() => { if (showing === 'assistant') setSeenAssistant(true); }, [showing]);
  const goSide = (v: View) => { haptic(); setMore(false); setView(v); setTab('repos'); };
  const swipeTabs = [() => goTab('assistant'), () => goTab('chat'), () => goSide('chats'), () => goTab('agents')];
  useTabSwipe(more ? -1 : tab === 'assistant' ? 0 : tab === 'chat' ? 1 : inChats ? 2 : tab === 'agents' ? 3 : -1, swipeTabs.length, (i) => swipeTabs[i]());
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
        <div className="body"><section className="main pane center"><Suspense fallback={<Loading />}><Brief /></Suspense></section></div>
      </div>
    );
  }

  return (
    <div className="workbench" data-tab={tab} data-sidebar={sidebar} data-chat={chatOpen} data-editor={active !== 'empty' || terminal || !chatOpen} data-codex={active === 'assistant'} style={{ '--chat-w': `${chatW}px` } as React.CSSProperties}>
      <AppUpdate />
      <SwitchedBanner />
      <Restarting />
      <Offline />
      <div className="body">
        <aside className="activitybar desktop-only">
          {VIEWS.map((v) => (
            <button key={v.id} data-view={v.id} className={(v.id === 'assistant' ? showing === 'assistant' : sidebar && view === v.id) ? 'active' : ''} title={v.id === 'assistant' ? 'Codex (⌘I)' : v.title} onClick={() => showView(v.id)}>
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
              <button className={view !== 'sessions' ? 'active' : ''} onClick={() => setView('chats')}>Sessions</button>
              <button className={view === 'sessions' ? 'active' : ''} onClick={() => setView('sessions')}>Repos</button>
            </div>
          )}
          {view === 'assistant' ? <Guard><Suspense fallback={null}><AssistantNav /></Suspense></Guard> : view === 'explorer' ? <Suspense fallback={null}><Explorer /></Suspense> : view === 'changes' ? <Suspense fallback={null}><Changes /></Suspense> : view === 'github' ? <Suspense fallback={null}><GitHub /></Suspense> : view === 'chats' ? <Suspense fallback={null}><OpenChats /></Suspense> : <Suspense fallback={null}><Sessions /></Suspense>}
        </section>

        <section className={`editor-group pane code ${mobileExplorer ? 'mobile-explorer' : ''}`}>
          {mobileExplorer && <div className="mobile-only mobile-explorer-host" onClick={reopen}><Suspense fallback={null}><Explorer /></Suspense></div>}
          <div className="tabs">
            <button className={`tab ex-tab mobile-only ${mobileExplorer ? 'active' : ''}`} title="Explorer" onClick={() => { setTab('code'); setEditor('file'); setBrowse(true); }}>
              <Icon name="files" small />
            </button>
            {(openFile || showing === 'file') && <div className={`tab ${showing === 'file' && !mobileExplorer ? 'active' : ''}`} {...pressable(() => { setEditor('file'); setBrowse(false); setTab((t) => (t === 'browser' || t === 'agents' ? 'code' : t)); })} title={openFile ?? 'Files (⌘E to switch)'}>
              {fileName ? <FileIcon name={fileName} /> : <Icon name="file" small />} {fileName ?? 'File'}
              {openFile && (
                <button className="close" title="Close file" onClick={(e) => { e.stopPropagation(); closeFile(); }}>
                  <Icon name="close" small />
                </button>
              )}
            </div>}
            {showing === 'browser' && (
              <div className="tab browser active" title="Browser (⌘E to switch)">
                <Icon name="globe" small /> Browser
                <button className="close" title="Close the browser" onClick={() => { setEditor('file'); setTab((t) => (t === 'browser' ? 'chat' : t)); }}><Icon name="close" small /></button>
              </div>
            )}
            {page && (
              <div className={`tab ptab ptab-${page} ${showing === page ? 'active' : ''}`} ref={showing === page ? reveal : undefined} {...pressable(() => { setEditor(page); setTab((t) => (t === 'browser' || t === 'agents' ? 'code' : t)); })} title={pageOf(page).title}>
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
          <div className={`editor ${active === 'agents' ? 'shown' : ''}`}>{active === 'agents' && <Suspense fallback={<Loading />}><AgentsPane selected={agentSel} onSelect={setAgentSel} /></Suspense>}</div>
          <div className={`editor browser ${active === 'browser' ? 'shown' : ''}`}>{active === 'browser' && <Suspense fallback={<Loading />}><BrowserPane onEmpty={() => setEditor('file')} /></Suspense>}</div>
          {page && <PageView key={page} page={page} shown={active === page} project={project ?? 'this repo'} />}
          <div className={`editor as-editor ${active === 'assistant' ? 'shown' : ''}`}>{seenAssistant && <Guard><Suspense fallback={<Loading />}><Assistant /></Suspense></Guard>}</div>
          <div className={`editor ${active === 'offline' ? 'shown' : ''}`}>{unreachable && <Unreachable onMacs={() => setMacs(true)} />}</div>
          <div className={`editor ${active === 'empty' ? 'shown' : ''}`}>
            <div className="empty-state">
              <Icon name="files" />
              <div className="empty-title">No file open</div>
              <div className="muted small">Pick a file in the Explorer{touch() ? '' : ' or press ⌘P'}. Files Claude edits open here.</div>
            </div>
          </div>
          <div className="panel" style={terminal ? { height: termH } : undefined}>
            {terminal && <div className="panel-sash" onPointerDown={startTermResize} />}
            <Suspense fallback={null}><Terminal key={session.id} chat={session.id} project={project} open={terminal || tab === 'term'} onToggle={() => tab !== 'term' && setTerminal((v) => !v)} /></Suspense>
          </div>
        </section>

        <div className="sash desktop-only" onPointerDown={startResize} />

        <section className="main pane center">
          <Suspense fallback={<Loading />}><Brief /></Suspense>
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

      <StatusBar project={project} theme={theme} toggleTheme={toggleTheme} macName={macName} onPhone={() => setPhone((v) => !v)} onMacs={() => setMacs((v) => !v)} />

      <TabBar tab={tab} more={more} inChats={inChats} inMore={inMore} goTab={goTab} goSide={goSide} toggleMore={() => setMore((v) => !v)} />
      <MoreSheet open={more} onClose={() => setMore(false)} tab={tab} view={view} showing={showing} project={project} theme={theme} toggleTheme={toggleTheme} macName={macName} goTab={goTab} goSide={goSide} openPage={openPage} onMacs={() => setMacs(true)} />

      <Suspense fallback={null}>
        <FileSwitcher />
        <Palette />
      </Suspense>
      {repoPicker && <Suspense fallback={null}><RepoPicker /></Suspense>}
      {phone && <Suspense fallback={null}><ConnectPopover onClose={() => setPhone(false)} /></Suspense>}
      {macs && <MacsPopover onClose={() => setMacs(false)} />}
    </div>
  );
}
