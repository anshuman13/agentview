import { useEffect, useRef, useState } from 'react';
import { connect, send, setUi, useStore } from './store';
import { NowPane } from './panes/NowPane';
import { Chat } from './panes/Chat';
import { CodePane } from './panes/CodePane';
import { BrowserPane } from './panes/BrowserPane';
import { FileSwitcher } from './panes/FileSwitcher';
import { Explorer } from './panes/Explorer';
import { Sessions } from './panes/Sessions';
import { Icon } from './Icon';
import { QuickPick } from './QuickPick';
import { ConnectPopover } from './ConnectPopover';
import { PERMISSION_MODES } from '../../shared/protocol';

type Tab = 'now' | 'chat' | 'code' | 'browser';

const MODE_HELP: Record<string, string> = {
  default: 'Ask before risky tools',
  acceptEdits: 'Auto-accept file edits, ask for the rest',
  plan: 'Read-only planning, no edits',
  dontAsk: 'Deny anything not pre-approved',
};

export function App() {
  const connected = useStore((s) => s.ui.connected);
  const pendingCount = useStore((s) => s.pending.length);
  const openFile = useStore((s) => s.ui.openFile);
  const session = useStore((s) => s.session);
  const status = useStore((s) => s.status);
  const [tab, setTab] = useState<Tab>('now');
  const [editor, setEditor] = useState<'file' | 'browser'>('browser');
  const [sidebar, setSidebar] = useState(true);
  const [view, setView] = useState<'agent' | 'explorer' | 'sessions'>('agent');
  const [chat, setChat] = useState(true);
  const [pick, setPick] = useState<'model' | 'mode' | null>(null);
  const [phone, setPhone] = useState(false);
  const [panelH, setPanelH] = useState(() => Number(localStorage.getItem('agentview.panelH')) || 240);
  const main = useRef<HTMLDivElement>(null);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    document.body.classList.add('resizing');
    const move = (ev: PointerEvent) => {
      const r = main.current!.getBoundingClientRect();
      setPanelH(Math.round(Math.min(Math.max(r.bottom - ev.clientY, 100), r.height - 120)));
    };
    const up = () => {
      document.body.classList.remove('resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  useEffect(() => {
    if (pendingCount > 0) { setChat(true); setTab('chat'); }
  }, [pendingCount]);

  useEffect(() => {
    try { localStorage.setItem('agentview.panelH', String(panelH)); } catch {}
  }, [panelH]);

  useEffect(() => {
    connect();
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setUi({ switcherOpen: true });
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebar((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setChat((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (openFile) setEditor('file');
  }, [openFile]);

  const fileName = openFile ? openFile.split('/').pop() : null;
  const mobileExplorer = tab === 'code' && !openFile;

  return (
    <div className="workbench" data-tab={tab} data-sidebar={sidebar} data-chat={chat}>
      <div className="titlebar desktop-only">
        <span>{session.cwd ? session.cwd.split('/').pop() : 'AgentView'} — AgentView</span>
      </div>

      <div className="body">
        <aside className="activitybar desktop-only">
          <button className={sidebar && view === 'agent' ? 'active' : ''} title="Agent (⌘B)" onClick={() => { if (view === 'agent') setSidebar((v) => !v); else { setView('agent'); setSidebar(true); } }}>
            <Icon name="agent" />
          </button>
          <button className={sidebar && view === 'explorer' ? 'active' : ''} title="Explorer (⌘P for quick open)" onClick={() => { if (view === 'explorer') setSidebar((v) => !v); else { setView('explorer'); setSidebar(true); } }}>
            <Icon name="files" />
          </button>
          <button className={sidebar && view === 'sessions' ? 'active' : ''} title="Sessions" onClick={() => { if (view === 'sessions') setSidebar((v) => !v); else { setView('sessions'); setSidebar(true); } }}>
            <Icon name="history" />
          </button>
          <button className={editor === 'browser' ? 'active' : ''} title="Browser" onClick={() => setEditor('browser')}><Icon name="globe" /></button>
          <span className="spacer" />
          <button className={chat ? 'active' : ''} title="Chat panel (⌘J)" onClick={() => setChat((v) => !v)}>
            <Icon name="chat" />
            {pendingCount > 0 && <span className="badge">{pendingCount}</span>}
          </button>
        </aside>

        <section className="sidebar pane now">
          <div className="sidebar-title">{view === 'agent' ? 'Agent' : view === 'explorer' ? 'Explorer' : 'Sessions'}</div>
          {view === 'agent' ? <NowPane /> : view === 'explorer' ? <Explorer /> : <Sessions />}
        </section>

        <div className="main" ref={main} style={{ '--panel-h': `${panelH}px` } as React.CSSProperties}>
          <section className={`editor-group pane code ${mobileExplorer ? 'mobile-explorer' : ''}`}>
            {mobileExplorer && <div className="mobile-only mobile-explorer-host"><Explorer /></div>}
            <div className="tabs">
              {openFile && (
                <button className={`tab ${editor === 'file' ? 'active' : ''}`} onClick={() => setEditor('file')} title={openFile}>
                  <Icon name="file" small /> {fileName}
                  <span className="close" onClick={(e) => { e.stopPropagation(); setUi({ openFile: null }); setEditor('browser'); }}>×</span>
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
              <span className="panel-tab">Chat</span>
              <span className="spacer" />
              <button className="ghost" title="Hide panel (⌘J)" onClick={() => setChat(false)}>×</button>
            </div>
            <Chat />
          </section>
        </div>
      </div>

      <footer className="statusbar desktop-only">
        <span className={`item ${session.running ? 'busy' : ''}`}>
          <Icon name={session.running ? 'sync' : 'check'} small /> {session.running ? 'Working' : 'Idle'}
        </span>
        {!['Idle', 'Working', 'Connecting'].includes(status) && <span className="item">{status}</span>}
        <span className="spacer" />
        <span className="item clickable" title="Open on phone" onClick={() => setPhone((v) => !v)}>Open on phone</span>
        <span className="item clickable" title="Switch model" onClick={() => setPick('model')}>
          Model: {session.models.find((m) => m.value === (session.model ?? 'default'))?.displayName ?? session.model ?? 'default'}
        </span>
        <span className="item clickable" title="Permission mode" onClick={() => setPick('mode')}>
          Mode: {session.permissionMode ?? 'default'}
        </span>
        {session.apiKeySource && <span className="item">{session.apiKeySource === 'none' ? 'claude.ai login' : session.apiKeySource}</span>}
        {!connected && <span className="item error">Disconnected</span>}
      </footer>

      <nav className="tabbar mobile-only">
        {(['now', 'chat', 'code', 'browser'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => { setTab(t); if (t === 'browser') setEditor('browser'); if (t === 'code') setEditor('file'); }}>
            <Icon name={t === 'now' ? 'agent' : t === 'chat' ? 'chat' : t === 'code' ? 'files' : 'globe'} />
            <span>{t === 'now' ? 'Agent' : t[0].toUpperCase() + t.slice(1)}</span>
            {t === 'chat' && pendingCount > 0 && <span className="badge">{pendingCount}</span>}
          </button>
        ))}
      </nav>

      <FileSwitcher />
      {phone && <ConnectPopover onClose={() => setPhone(false)} />}
      {pick === 'model' && (
        <QuickPick
          title="Select model"
          current={session.model}
          items={session.models.map((m) => ({ value: m.value, label: m.displayName, detail: m.description }))}
          onPick={(v) => { send({ type: 'set_model', model: v }); setPick(null); }}
          onClose={() => setPick(null)}
        />
      )}
      {pick === 'mode' && (
        <QuickPick
          title="Permission mode"
          current={session.permissionMode}
          items={PERMISSION_MODES.map((m) => ({ value: m, label: m, detail: MODE_HELP[m] }))}
          onPick={(v) => { send({ type: 'set_permission_mode', mode: v }); setPick(null); }}
          onClose={() => setPick(null)}
        />
      )}
    </div>
  );
}
