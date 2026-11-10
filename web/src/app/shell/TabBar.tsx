import { Suspense, useRef } from 'react';
import { setUi, useStore } from '../store';
import { shownFeature } from '../../../../shared/featureUse';
import { appSettings } from '../appSettings';
import { track } from '../featureUse';
import { AgentsBadge } from '../../sessions/AgentsBadge';
import { ChangesBadge } from '../../workspace/gitStatus';
import { GitHubBadge } from '../../ops/pulls';
import { Icon } from '../../ui/Icon';
import { Sheet } from '../../ui/Sheet';
import { AssistantCounts } from '../lazy';
import { usePages, type Page } from '../pages';
import { canNotify, toggleNotify, useNotify } from '../runtime/notify';
import { THEME_NAMES, type Theme } from '../theme';
import { mcpDot, useCounts } from '../store/counts';

export type Tab = 'assistant' | 'chat' | 'code' | 'term' | 'browser' | 'repos' | 'agents';
export type View = 'assistant' | 'explorer' | 'changes' | 'github' | 'chats' | 'sessions' | 'runs';

const LONG_PRESS = 450;

type TabBarProps = { tab: Tab; more: boolean; inChats: boolean; inMore: boolean; goTab: (t: Tab) => void; goSide: (v: View) => void; toggleMore: () => void };

export function TabBar({ tab, more, inChats, inMore, goTab, goSide, toggleMore }: TabBarProps) {
  const pendingCount = useStore((s) => s.pending.length);
  const { needsYou, chats } = useCounts();
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pressed = useRef(false);
  const assistantPress = {
    onPointerDown: () => {
      pressed.current = false;
      pressTimer.current = setTimeout(() => { pressed.current = true; track('tab:codex'); goTab('assistant'); setTimeout(() => window.dispatchEvent(new Event('assistant:voice')), 100); }, LONG_PRESS);
    },
    onPointerUp: () => clearTimeout(pressTimer.current),
    onPointerCancel: () => clearTimeout(pressTimer.current),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClick: () => { if (!pressed.current) { track('tab:codex'); goTab('assistant'); } pressed.current = false; },
  };
  return (
    <nav className="tabbar mobile-only">
      <button className={tab === 'assistant' && !more ? 'active' : ''} title="Codex. Hold to talk" {...assistantPress}>
        <Icon name="sparkle" />
        <span>Codex</span>
        {needsYou > 0 && <span className="dot waiting" role="img" aria-label={`${needsYou} need you`} />}
        <Suspense fallback={null}><AssistantCounts /></Suspense>
      </button>
      <button className={tab === 'chat' && !more ? 'active' : ''} onClick={() => { track('tab:chat'); goTab('chat'); }}>
        <Icon name="comment" />
        <span>Chat</span>
        {pendingCount > 0 && <span className="badge" aria-label={`${pendingCount} waiting`}>{pendingCount}</span>}
      </button>
      <button className={inChats && !more ? 'active' : ''} onClick={() => { track('tab:sessions'); goSide('chats'); }}>
        <Icon name="comment-discussion" />
        <span>Sessions</span>
        {chats > 0 && <span className="dot waiting" role="img" aria-label={`${chats} unread`} />}
      </button>
      <button className={tab === 'agents' && !more ? 'active' : ''} onClick={() => { track('tab:agents'); goTab('agents'); }}>
        <Icon name="hubot" />
        <span>Agents</span>
        <AgentsBadge />
      </button>
      <button className={more || inMore ? 'active' : ''} onClick={() => { if (!more) track('sheet:more'); toggleMore(); }}>
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
  const { mcp } = useCounts();
  const pages = usePages();
  const hidden = appSettings.use((s) => s.hiddenFeatures);
  if (!open) return null;
  const shown = (id: string) => shownFeature(`more:${id}`, hidden);
  const act = (f: () => void) => () => { onClose(); f(); };
  return (
    <Sheet label="More" onClose={onClose} className="more-sheet" overlayClassName="more-sheet-overlay mobile-only">
      <div className="more-status">
        <button className="more-project" title={`${cwd}\nStart a chat in another repo`} onClick={act(() => setUi({ repoPicker: true }))}>
          <Icon name="folder" small /><span>{project}</span>
        </button>
        {canNotify && (
          <button className="icon-btn" title={notifying ? 'Turn off notifications' : 'Notify me when the agent finishes or needs you'} onClick={toggleNotify}>
            <Icon name={notifying ? 'bell' : 'bell-slash'} />
          </button>
        )}
        <button className="icon-btn" title={`Theme: ${THEME_NAMES[theme]}. Tap to switch`} onClick={toggleTheme}><Icon name="color-mode" /></button>
      </div>
      {shown('files') && (
        <button className={tab === 'code' ? 'active' : ''} onClick={() => { track('more:files'); goTab('code'); }}>
          <Icon name="files" /><span>Files</span>
        </button>
      )}
      {shown('browser') && (
        <button className={tab === 'browser' ? 'active' : ''} onClick={() => { track('more:browser'); goTab('browser'); }}>
          <Icon name="globe" /><span>Browser</span>
        </button>
      )}
      {shown('terminal') && (
        <button className={tab === 'term' ? 'active' : ''} onClick={() => { track('more:terminal'); goTab('term'); }}>
          <Icon name="terminal" /><span>Terminal</span>
        </button>
      )}
      {shown('changes') && (
        <button className={tab === 'repos' && view === 'changes' ? 'active' : ''} onClick={() => { track('more:changes'); goSide('changes'); }}>
          <Icon name="source-control" /><span>Source Control</span><ChangesBadge />
        </button>
      )}
      {shown('github') && (
        <button className={tab === 'repos' && view === 'github' ? 'active' : ''} onClick={() => { track('more:github'); goSide('github'); }}>
          <Icon name="github" /><span>Pull Requests</span><GitHubBadge />
        </button>
      )}
      <span className="more-label">Tools</span>
      {pages.map((p) => (
        <button key={p.id} className={showing === p.id && tab === 'code' ? 'active' : ''} onClick={act(() => openPage(p.id))}>
          <Icon name={p.icon} />
          <span>{p.title}</span>
          {p.id === 'mcp' && mcp.total > 0 && <span className="more-meta"><span className={`dot ${mcpDot(mcp)}`} /> {mcp.connected}/{mcp.total}</span>}
        </button>
      ))}
      <span className="more-divider" />
      <button onClick={act(onMacs)}>
        <Icon name="vm" /><span>{macName || 'Macs'}</span><span className="more-meta">switch</span>
      </button>
      <button onClick={act(() => window.dispatchEvent(new Event('agentview:palette')))}>
        <Icon name="terminal-cmd" /><span>Command Palette</span>
      </button>
    </Sheet>
  );
}
