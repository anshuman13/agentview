import { Suspense, useEffect, useRef, useState } from 'react';
import { connect, embedded, getState, useStore } from '../store';
import { openAgent } from '../../sessions/agents';
import { EmptyState } from '../../ui/Panel';
import { command } from '../../ui/util';
import { haptic } from '../../ui/haptic';
import { slideFrom, useTabSwipe } from '../touch/tabSwipe';
import { useEdgeBack } from '../touch/edgeBack';
import { useKeyboardInset } from '../touch/keyboardInset';
import { useKeyboardFlag } from '../touch/keyboardFlag';
import { ActivityBar, VIEWS } from './ActivityBar';
import { EditorTabs } from './EditorTabs';
import { SideChat, useSideChat } from './SideChat';
import { SidebarPane } from './SidebarPane';
import { useResize } from './useResize';
import { useWorkbenchKeys } from './useWorkbenchKeys';
import { Unreachable, useUnreachable } from './Unreachable';
import { SwitchedBanner, useMacName } from './macName';
import { Guard } from './Guard';
import { deepLink } from '../deepLinks';
import { isPage, PageView, type Page } from '../pages';
import { Brief, AgentsPane, FileSwitcher, Palette, Shortcuts, RepoPicker, Assistant, FocusBar, Explorer, Terminal, CodePane, BrowserPane, ConnectPopover, MacsPopover, Loading } from '../lazy';
import { Offline, Restarting } from './StatusItems';
import { StatusBar } from './StatusBar';
import { useTheme } from '../theme';
import { MoreSheet, TabBar, type Tab, type View } from './TabBar';
import { touch } from '../touch/touch';
import { Back } from '../touch/back';
import { BadgeMount } from './BadgeMount';
import { tauriInvoke } from '../../codex/data/local';

const narrow = () => window.innerWidth <= 900;

export function App() {
  const pendingCount = useStore((s) => s.pending.length);
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
  const closePage = () => { setPage(null); setEditor((e) => (isPage(e) ? 'file' : e)); };
  const [sidebar, setSidebar] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const [view, setView] = useState<View>('explorer');
  const [phone, setPhone] = useState(false);
  const [macs, setMacs] = useState(false);
  const macName = useMacName();
  const { chatW, termH, startResize, startTermResize } = useResize();
  const [terminal, setTerminal] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const beside = useSideChat();

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

  // The first init swaps the preset chat id for the server's; that is not a chat switch, so a deep-linked view stays.
  const prevId = useRef(session.id);
  const [fromRepos, setFromRepos] = useState(false);
  useEffect(() => {
    const from = prevId.current;
    prevId.current = session.id;
    if (deepLink.view && from === deepLink.chat) return;
    setTab((t) => {
      if (t !== 'repos') return t;
      slideFrom(1);
      setFromRepos(true);
      return 'chat';
    });
  }, [session.id]);
  useEffect(() => { if (tab !== 'chat') setFromRepos(false); }, [tab]);

  useEffect(() => {
    const show = () => { setTerminal(true); setTab((t) => (narrow() ? 'term' : t)); };
    window.addEventListener('agentview:terminal', show);
    return () => window.removeEventListener('agentview:terminal', show);
  }, []);

  useEffect(() => { connect(); }, []);
  useWorkbenchKeys({
    toggleChat: () => setChatOpen((v) => !v),
    toggleSidebar: () => setSidebar((v) => !v),
    toggleTerminal: () => setTerminal((v) => !v),
    switchEditor: () => setEditor((v) => (v === 'file' ? 'browser' : 'file')),
  });

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
  useKeyboardFlag();
  const goSide = (v: View) => { haptic(); setMore(false); setView(v); setTab('repos'); };
  const swipeTabs = [() => goTab('assistant'), () => goTab('chat'), () => goSide('chats'), () => goTab('agents')];
  useEdgeBack();
  useKeyboardInset();
  useTabSwipe(more ? -1 : tab === 'assistant' ? 0 : tab === 'chat' ? 1 : inChats ? 2 : tab === 'agents' ? 3 : -1, swipeTabs.length, (i) => swipeTabs[i]());
  const reopen = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    const row = el.closest<HTMLElement>('[data-path]');
    if (row && !el.closest('button') && row.dataset.path === openFile) setBrowse(false);
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
      {tauriInvoke() && <BadgeMount />}
      {fromRepos && tab === 'chat' && narrow() && <Back close={() => { slideFrom(-1); setTab('repos'); }} />}
      <SwitchedBanner />
      <Restarting />
      <Offline />
      <div className="body">
        <ActivityBar showing={showing} sidebar={sidebar} view={view} browserShown={editor === 'browser'} showView={showView} openPage={openPage} switchEditor={() => setEditor((v) => (v === 'file' ? 'browser' : 'file'))} />

        <SidebarPane view={view} tab={tab} chatsView={chatsView} setView={setView} />

        <section className={`editor-group pane code ${mobileExplorer ? 'mobile-explorer' : ''}`}>
          {mobileExplorer && <div className="mobile-only mobile-explorer-host" onClick={reopen}><Suspense fallback={null}><Explorer /></Suspense></div>}
          <EditorTabs
            showing={showing}
            page={page}
            mobileExplorer={mobileExplorer}
            sidebar={sidebar}
            chatOpen={chatOpen}
            showFile={() => { setEditor('file'); setBrowse(false); setTab((t) => (t === 'browser' || t === 'agents' ? 'code' : t)); }}
            showPage={(p) => { setEditor(p); setTab((t) => (t === 'browser' || t === 'agents' ? 'code' : t)); }}
            showExplorer={() => { setTab('code'); setEditor('file'); setBrowse(true); }}
            closeBrowser={() => { setEditor('file'); setTab((t) => (t === 'browser' ? 'chat' : t)); }}
            closePage={closePage}
            toggleSidebar={() => setSidebar((v) => !v)}
            toggleChat={() => setChatOpen((v) => !v)}
          />
          <div className={`editor ${active === 'file' ? 'shown' : ''}`}><Suspense fallback={<Loading />}><CodePane /></Suspense></div>
          <div className={`editor ${active === 'agents' ? 'shown' : ''}`}>{active === 'agents' && <Suspense fallback={<Loading />}><AgentsPane selected={agentSel} onSelect={setAgentSel} /></Suspense>}</div>
          <div className={`editor browser ${active === 'browser' ? 'shown' : ''}`}>{active === 'browser' && <Suspense fallback={<Loading />}><BrowserPane onEmpty={() => setEditor('file')} /></Suspense>}</div>
          {page && <PageView key={page} page={page} shown={active === page} project={project ?? 'this repo'} />}
          <div className={`editor as-editor ${active === 'assistant' ? 'shown' : ''}`}>{seenAssistant && <Guard><Suspense fallback={null}><FocusBar /></Suspense><Suspense fallback={<Loading />}><Assistant /></Suspense></Guard>}</div>
          <div className={`editor ${active === 'offline' ? 'shown' : ''}`}>{unreachable && <Unreachable />}</div>
          <div className={`editor ${active === 'empty' ? 'shown' : ''}`}>
            <EmptyState size="md" icon="files" title="No file open" hint={`Pick a file in the Explorer${touch() ? '' : ' or press ⌘P'}. Files Claude edits open here`} />
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
        {beside && <SideChat beside={beside} />}
      </div>

      <StatusBar project={project} theme={theme} toggleTheme={toggleTheme} macName={macName} onPhone={() => setPhone((v) => !v)} onMacs={() => setMacs((v) => !v)} />

      <TabBar tab={tab} more={more} inChats={inChats} inMore={inMore} goTab={goTab} goSide={goSide} toggleMore={() => setMore((v) => !v)} />
      <MoreSheet open={more} onClose={() => setMore(false)} tab={tab} view={view} showing={showing} project={project} theme={theme} toggleTheme={toggleTheme} macName={macName} goTab={goTab} goSide={goSide} openPage={openPage} onMacs={() => setMacs(true)} />

      <Suspense fallback={null}>
        <FileSwitcher />
        <Palette />
        <Shortcuts />
      </Suspense>
      {repoPicker && <Suspense fallback={null}><RepoPicker /></Suspense>}
      {phone && <Suspense fallback={null}><ConnectPopover onClose={() => setPhone(false)} /></Suspense>}
      {macs && <Suspense fallback={null}><MacsPopover onClose={() => setMacs(false)} /></Suspense>}
    </div>
  );
}
