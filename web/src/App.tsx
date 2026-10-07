import { useEffect, useState } from 'react';
import { connect, send, setUi, useStore } from './store';
import { NowPane } from './panes/NowPane';
import { Chat } from './panes/Chat';
import { CodePane } from './panes/CodePane';
import { BrowserPane } from './panes/BrowserPane';
import { FileSwitcher } from './panes/FileSwitcher';
import { Explorer } from './panes/Explorer';
import { Icon } from './Icon';
import { QuickPick } from './QuickPick';
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
  const [view, setView] = useState<'agent' | 'explorer'>('agent');
  const [chat, setChat] = useState(true);
  const [pick, setPick] = useState<'model' | 'mode' | null>(null);

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
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (openFile) setEditor('file');
  }, [openFile]);

  useEffect(() => {
    if (pendingCount > 0 && window.matchMedia('(max-width: 900px)').matches) setTab('now');
  }, [pendingCount]);

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
            {pendingCount > 0 && <span className="badge">{pendingCount}</span>}
          </button>
          <button className={sidebar && view === 'explorer' ? 'active' : ''} title="Explorer (⌘P for quick open)" onClick={() => { if (view === 'explorer') setSidebar((v) => !v); else { setView('explorer'); setSidebar(true); } }}>
            <Icon name="files" />
          </button>
          <button className={editor === 'browser' ? 'active' : ''} title="Browser" onClick={() => setEditor('browser')}><Icon name="globe" /></button>
          <span className="spacer" />
          <button className={chat ? 'active' : ''} title="Chat" onClick={() => setChat((v) => !v)}><Icon name="chat" /></button>
        </aside>

        <section className="sidebar pane now">
          <div className="sidebar-title">{view === 'agent' ? 'Agent' : 'Explorer'}</div>
          {view === 'agent' ? <NowPane /> : <Explorer />}
        </section>

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

        <section className="auxbar pane chat">
          <div className="sidebar-title">Chat</div>
          <Chat />
        </section>
      </div>

      <footer className="statusbar desktop-only">
        <span className={`item ${session.running ? 'busy' : ''}`}>
          <Icon name={session.running ? 'sync' : 'check'} small /> {session.running ? 'Working' : 'Idle'}
        </span>
        <span className="item">{status}</span>
        <span className="spacer" />
        <span className="item clickable" title="Switch model" onClick={() => setPick('model')}>
          {session.models.find((m) => m.value === (session.model ?? 'default'))?.displayName ?? session.model ?? 'default model'}
        </span>
        <span className="item clickable" title="Permission mode" onClick={() => setPick('mode')}>
          {session.permissionMode ?? 'default'}
        </span>
        {session.apiKeySource && <span className="item">{session.apiKeySource === 'none' ? 'claude.ai login' : session.apiKeySource}</span>}
        <span className={`item ${connected ? '' : 'error'}`}>{connected ? 'Connected' : 'Disconnected'}</span>
      </footer>

      <nav className="tabbar mobile-only">
        {(['now', 'chat', 'code', 'browser'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => { setTab(t); if (t === 'browser') setEditor('browser'); if (t === 'code') setEditor('file'); }}>
            <Icon name={t === 'now' ? 'agent' : t === 'chat' ? 'chat' : t === 'code' ? 'files' : 'globe'} />
            <span>{t === 'now' ? 'Agent' : t[0].toUpperCase() + t.slice(1)}</span>
            {t === 'now' && pendingCount > 0 && <span className="badge">{pendingCount}</span>}
          </button>
        ))}
      </nav>

      <FileSwitcher />
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
