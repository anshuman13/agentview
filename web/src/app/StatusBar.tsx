import { setUi, useStore } from './store';
import { Icon } from '../ui/Icon';
import { CacheItem, McpItem, UsageItem } from './StatusItems';
import { canNotify, toggleNotify, useNotify } from './notify';
import { THEME_NAMES, type Theme } from './theme';

type Props = { project?: string; theme: Theme; toggleTheme: () => void; macName: string; onPhone: () => void; onMacs: () => void };

export function StatusBar({ project, theme, toggleTheme, macName, onPhone, onMacs }: Props) {
  const connected = useStore((s) => s.ui.connected);
  const session = useStore((s) => s.session);
  const status = useStore((s) => s.status);
  const notifying = useNotify();
  return (
    <footer className="statusbar desktop-only">
      <button className="item project clickable" title={`${session.cwd}\nStart a chat in another repo (⌘O)`} onClick={() => setUi({ repoPicker: true })}><Icon name="folder" small /> {project}</button>
      <span className={`item ${session.running ? 'busy' : 'idle'}`}>
        <Icon name={session.running ? 'loading' : 'check'} small spin={session.running} /> {session.running ? 'Working' : 'Idle'}
      </span>
      {!['Idle', 'Working', 'Connecting'].includes(status) && <span className="item status-text">{status}</span>}
      <span className="spacer" />
      <McpItem />
      <UsageItem />
      <CacheItem />
      {canNotify && (
        <button className="item clickable" title={notifying ? 'Notifying you when Claude finishes or needs you. Click to turn off' : 'Notify me when Claude finishes or needs you'} onClick={toggleNotify}>
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
