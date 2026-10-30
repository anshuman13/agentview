import { Suspense, useRef } from 'react';
import { Back } from './back';
import { setUi, useStore } from './store';
import { AgentsBadge } from '../sessions/AgentsBadge';
import { ChangesBadge } from '../workspace/gitStatus';
import { GitHubBadge } from '../ops/pulls';
import { Icon } from '../ui/Icon';
import { useSheetDrag } from '../ui/useSheetDrag';
import { AssistantBadge } from './lazy';
import { PAGES, type Page } from './pages';
import { canNotify, toggleNotify, useNotify } from './notify';
import { THEME_NAMES, type Theme } from './theme';
import { useMcpHealth } from '../ops/mcpShown';

export type Tab = 'assistant' | 'chat' | 'code' | 'term' | 'browser' | 'repos' | 'agents';
export type View = 'assistant' | 'explorer' | 'changes' | 'github' | 'chats' | 'sessions';

const LONG_PRESS = 450;

type TabBarProps = { tab: Tab; more: boolean; inChats: boolean; inMore: boolean; goTab: (t: Tab) => void; goSide: (v: View) => void; toggleMore: () => void };

export function TabBar({ tab, more, inChats, inMore, goTab, goSide, toggleMore }: TabBarProps) {
  const pendingCount = useStore((s) => s.pending.length);
  const elsewhere = useStore((s) => s.live.filter((c) => c.id !== s.session.id && c.pending > 0).length + s.attention.length);
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pressed = useRef(false);
  const assistantPress = {
    onPointerDown: () => {
      pressed.current = false;
      pressTimer.current = setTimeout(() => { pressed.current = true; goTab('assistant'); setTimeout(() => window.dispatchEvent(new Event('assistant:voice')), 100); }, LONG_PRESS);
    },
    onPointerUp: () => clearTimeout(pressTimer.current),
    onPointerCancel: () => clearTimeout(pressTimer.current),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClick: () => { if (!pressed.current) goTab('assistant'); pressed.current = false; },
  };
  return (
    <nav className="tabbar mobile-only">
      <button className={tab === 'assistant' && !more ? 'active' : ''} title="Codex. Hold to talk" {...assistantPress}>
        <Icon name="sparkle" />
        <span>Codex</span>
        <Suspense fallback={null}><AssistantBadge /></Suspense>
      </button>
      <button className={tab === 'chat' && !more ? 'active' : ''} onClick={() => goTab('chat')}>
        <Icon name="comment" />
        <span>Chat</span>
        {pendingCount > 0 && <span className="badge">{pendingCount}</span>}
      </button>
      <button className={inChats && !more ? 'active' : ''} onClick={() => goSide('chats')}>
        <Icon name="comment-discussion" />
        <span>Sessions</span>
        {elsewhere > 0 && <span className="badge">{elsewhere}</span>}
      </button>
      <button className={tab === 'agents' && !more ? 'active' : ''} onClick={() => goTab('agents')}>
        <Icon name="hubot" />
        <span>Agents</span>
        <AgentsBadge />
      </button>
      <button className={more || inMore ? 'active' : ''} onClick={toggleMore}>
        <Icon name="ellipsis" />
        <span>More</span>
      </button>
    </nav>
  );
}

type MoreProps = {
  open: boolean;
  onClose: () => void;
  tab: Tab;
  view: View;
  showing: string;
  project?: string;
  theme: Theme;
  toggleTheme: () => void;
  macName: string;
  goTab: (t: Tab) => void;
  goSide: (v: View) => void;
  openPage: (p: Page) => void;
  onMacs: () => void;
};

export function MoreSheet({ open, onClose, tab, view, showing, project, theme, toggleTheme, macName, goTab, goSide, openPage, onMacs }: MoreProps) {
  const cwd = useStore((s) => s.session.cwd);
  const notifying = useNotify();
  const mcp = useMcpHealth();
  const sheet = useSheetDrag(open, onClose);
  if (!open) return null;
  const act = (f: () => void) => () => { onClose(); f(); };
  return (
    <div className="more-sheet-overlay mobile-only" ref={sheet.overlay} onClick={sheet.close}>
      <Back close={onClose} />
      <div className="more-sheet" ref={sheet.sheet} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" {...sheet.handle} />
        <div className="more-status">
          <button className="more-project" title={`${cwd}\nStart a chat in another repo`} onClick={act(() => setUi({ repoPicker: true }))}>
            <Icon name="folder" small /><span>{project}</span>
          </button>
          {canNotify && (
            <button className="icon-btn" title={notifying ? 'Turn off notifications' : 'Notify me when Claude finishes or needs you'} onClick={toggleNotify}>
              <Icon name={notifying ? 'bell' : 'bell-slash'} />
            </button>
          )}
          <button className="icon-btn" title={`Theme: ${THEME_NAMES[theme]}. Tap to switch`} onClick={toggleTheme}><Icon name="color-mode" /></button>
        </div>
        <button className={tab === 'code' ? 'active' : ''} onClick={() => goTab('code')}>
          <Icon name="files" /><span>Files</span>
        </button>
        <button className={tab === 'browser' ? 'active' : ''} onClick={() => goTab('browser')}>
          <Icon name="globe" /><span>Browser</span>
        </button>
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
            {p.id === 'mcp' && mcp.total > 0 && <span className="more-meta"><span className={`dot ${mcp.dot}`} /> {mcp.ok}/{mcp.total}</span>}
          </button>
        ))}
        <span className="more-divider" />
        <button onClick={act(onMacs)}>
          <Icon name="vm" /><span>{macName || 'Macs'}</span><span className="more-meta">switch</span>
        </button>
        <button onClick={act(() => window.dispatchEvent(new Event('agentview:palette')))}>
          <Icon name="terminal-cmd" /><span>Command Palette</span>
        </button>
      </div>
    </div>
  );
}
