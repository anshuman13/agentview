import { setUi, useStore } from '../store';
import { Icon } from '../../ui/Icon';
import { CacheItem, McpItem, RunsItem, UsageItem } from './StatusItems';
import { canNotify, toggleNotify, useNotify } from '../runtime/notify';
import { chatState } from '../../sessions/runLogic';
import { THEME_NAMES, type Theme } from '../theme';

const ICON = { running: 'loading', needs: 'bell', failed: 'error', warn: 'debug-pause', idle: 'check' } as const;

type Props = { project?: string; theme: Theme; toggleTheme: () => void; macName: string; onPhone: () => void; onMacs: () => void };

export function StatusBar({ project, theme, toggleTheme, macName, onPhone, onMacs }: Props) {
  const connected = useStore((s) => s.ui.connected);
  const session = useStore((s) => s.session);
  const status = useStore((s) => s.status);
  const live = useStore((s) => s.live.find((c) => c.id === s.session.id));
  const state = chatState({ pending: live?.pending ?? 0, failed: live?.failed, stalled: live?.stalled, running: session.running, status, agentList: live?.agentList, run: live?.run });
  const notifying = useNotify();
  return (
    <footer className="statusbar desktop-only">
      <button className="item project clickable" title={`${session.cwd}\nStart a chat in another repo (⌘O)`} onClick={() => setUi({ repoPicker: true })}><Icon name="folder" small /> {project}</button>
      <span className={`item ${state.tone === 'running' ? 'busy' : 'idle'}`}>
        <Icon name={ICON[state.tone]} small spin={state.tone === 'running'} /> {state.text}
      </span>
      <span className="spacer" />
      <RunsItem />
      <McpItem />
      <UsageItem />
      <CacheItem />
      {canNotify && (
        <button className="item clickable" title={notifying ? 'Notifying you when the agent finishes or needs you. Click to turn off' : 'Notify me when the agent finishes or needs you'} onClick={toggleNotify}>
          <Icon name={notifying ? 'bell' : 'bell-slash'} small />
        </button>
      )}
      <button className="item clickable" title={`Theme: ${THEME_NAMES[theme]}. Click to switch`} onClick={toggleTheme}><Icon name="color-mode" small /></button>
      <button className="item clickable" title="Open on phone" onClick={onPhone}><Icon name="device-mobile" small /></button>
      <button className="item clickable" title="Switch to another Mac" onClick={onMacs}><Icon name="vm" small /> {macName}</button>
      {!connected && <span className="item error"><Icon name="plug" small /> Disconnected</span>}
    </footer>
  );
}
