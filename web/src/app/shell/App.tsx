import { Suspense } from 'react';
import { embedded, useStore } from '../store';
import { EmptyState } from '../../ui/Panel';
import { slideFrom } from '../touch/tabSwipe';
import { useEdgeBack } from '../touch/edgeBack';
import { useKeyboardInset } from '../touch/keyboardInset';
import { useKeyboardFlag } from '../touch/keyboardFlag';
import { ActivityBar } from './ActivityBar';
import { EditorTabs } from './EditorTabs';
import { PhoneHeader } from './PhoneHeader';
import { SideChat, useSideChat } from './SideChat';
import { SidebarPane } from './SidebarPane';
import { useResize } from './useResize';
import { Unreachable } from './Unreachable';
import { SwitchedBanner, useMacName } from './macName';
import { Guard } from './Guard';
import { isPage, PageView } from '../pages';
import { Brief, AgentsPane, FileSwitcher, Palette, GoalSheets, Shortcuts, RepoPicker, Assistant, FocusBar, Explorer, CodePane, BrowserPane, ConnectPopover, MacsPopover, Loading } from '../lazy';
import { Offline, Restarting } from './StatusItems';
import { StatusBar } from './StatusBar';
import { MoreSheet, TabBar } from './TabBar';
import { touch } from '../touch/touch';
import { Back } from '../touch/back';
import { BadgeMount } from './BadgeMount';
import { tauriInvoke } from '../runtime/tauri';
import { EmbeddedApp, TerminalPanel } from './AppParts';
import { narrow, useWorkbench } from './useWorkbench';

export function App() {
  const repoPicker = useStore((s) => s.ui.repoPicker);
  const cwd = useStore((s) => s.session.cwd);
  const macName = useMacName();
  const { chatW, termH, sideW, startResize, startTermResize, startSideResize } = useResize();
  const beside = useSideChat();
  const {
    openFile, chatId, tab, setTab, editor, setEditor, seenAssistant, agentSel, setAgentSel, page, more, setMore, browse, setBrowse, sidebar, setSidebar,
    chatOpen, setChatOpen, view, setView, phone, setPhone, macs, setMacs, terminal, setTerminal, theme, toggleTheme,
    showView, openPage, closePage, fromRepos, showing, active, unreachable, mobileExplorer, chatsView, inChats, inMore, goTab, goSide, goHome, closeTool, reopen,
  } = useWorkbench();
  const project = cwd ? cwd.split('/').pop() : 'AgentView';
  useKeyboardFlag();
  useEdgeBack();
  useKeyboardInset();

  if (embedded) return <EmbeddedApp />;

  return (
    <div className="workbench" data-tab={tab} data-sidebar={sidebar} data-chat={chatOpen} data-editor={active !== 'empty' || terminal || !chatOpen} data-codex={active === 'assistant'} style={{ '--chat-w': `${chatW}px`, '--sidebar-w': `${sideW}px` } as React.CSSProperties}>
      {tauriInvoke() && <BadgeMount />}
      {fromRepos && tab === 'chat' && narrow() && <Back close={() => { slideFrom(-1); setTab('repos'); }} />}
      <SwitchedBanner />
      <Restarting />
      <Offline />
      <div className="body">
        <ActivityBar showing={showing} sidebar={sidebar} view={view} browserShown={editor === 'browser'} showView={showView} openPage={openPage} switchEditor={() => setEditor((v) => (v === 'file' ? 'browser' : 'file'))} />

        <SidebarPane view={view} tab={tab} chatsView={chatsView} setView={setView} project={project} back={goHome} />
        <div className="sash side-sash desktop-only" onPointerDown={startSideResize} />

        <section className={`editor-group pane code ${mobileExplorer ? 'mobile-explorer' : ''}`}>
          {tab === 'code' && !isPage(editor) && (
            <PhoneHeader
              title={mobileExplorer ? 'Files' : openFile?.split('/').pop()}
              sub={mobileExplorer ? project : openFile?.split('/').slice(0, -1).join('/') || project}
              slot={mobileExplorer ? 'page-files-action' : 'page-file-action'}
              onBack={mobileExplorer ? goHome : () => setBrowse(true)}
            />
          )}
          {mobileExplorer && <div className="mobile-only mobile-explorer-host" onClick={reopen}><Suspense fallback={null}><Explorer phone /></Suspense></div>}
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
          {page && <PageView key={page} page={page} shown={active === page} project={project ?? 'this repo'} back={tab === 'code' && active === page ? closeTool : undefined} />}
          <div className={`editor as-editor ${active === 'assistant' ? 'shown' : ''}`}>{seenAssistant && <Guard><Suspense fallback={null}><FocusBar /></Suspense><Suspense fallback={<Loading />}><Assistant /></Suspense></Guard>}</div>
          <div className={`editor ${active === 'offline' ? 'shown' : ''}`}>{unreachable && <Unreachable />}</div>
          <div className={`editor ${active === 'empty' ? 'shown' : ''}`}>
            <EmptyState size="md" icon="files" title="No file open" hint={`Pick a file in the Explorer${touch() ? '' : ' or press ⌘P'}. Files the agent edits open here`} />
          </div>
          <TerminalPanel chat={chatId} project={project} height={termH} open={terminal} tab={tab} startResize={startTermResize} toggle={() => setTerminal((v) => !v)} />
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
        <GoalSheets />
        <Shortcuts />
      </Suspense>
      {repoPicker && <Suspense fallback={null}><RepoPicker /></Suspense>}
      {phone && <Suspense fallback={null}><ConnectPopover onClose={() => setPhone(false)} /></Suspense>}
      {macs && <Suspense fallback={null}><MacsPopover onClose={() => setMacs(false)} /></Suspense>}
    </div>
  );
}
