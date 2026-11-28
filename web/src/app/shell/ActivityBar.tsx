import { useRef, useState } from 'react';
import { Icon } from '../../ui/Icon';
import { Menu, MenuItem } from '../../ui/Menu';
import { ChangesBadge } from '../../workspace/gitStatus';
import { GitHubBadge } from '../../ops/pulls';
import { useCounts } from './counts';
import { usePages, type Page } from '../pages';
import type { View } from './TabBar';
import { ariaKeys, keyText } from './keys';
import { canHideView, hiddenViews, shownViews, toggleHiddenView } from './hiddenViews';

export const VIEWS: { id: View; icon: string; title: string }[] = [
  { id: 'assistant', icon: 'sparkle', title: 'Codex' },
  { id: 'explorer', icon: 'files', title: 'Explorer' },
  { id: 'changes', icon: 'source-control', title: 'Source control' },
  { id: 'github', icon: 'github', title: 'GitHub pull requests' },
  { id: 'chats', icon: 'comment-discussion', title: 'Sessions' },
  { id: 'sessions', icon: 'repo', title: 'Workspace' },
];

type Props = { showing: string; sidebar: boolean; view: View; browserShown: boolean; showView: (v: View) => void; openPage: (p: Page) => void; switchEditor: () => void; toggleSidebar: () => void };

export function ActivityBar({ showing, sidebar, view, browserShown, showView, openPage, switchEditor, toggleSidebar }: Props) {
  const pages = usePages();
  const { chats } = useCounts();
  const hidden = hiddenViews.use();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <aside className="activitybar desktop-only" onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}>
      <button className="side-toggle" title={`${sidebar ? 'Hide' : 'Show'} the sidebar (${keyText('⌘B')})`} aria-label={`${sidebar ? 'Hide' : 'Show'} the sidebar`} aria-keyshortcuts={ariaKeys('⌘B')} aria-pressed={sidebar} onClick={toggleSidebar}>
        <Icon name={sidebar ? 'layout-sidebar-left' : 'layout-sidebar-left-off'} />
      </button>
      <span className="divider" />
      {shownViews(VIEWS, hidden).map((v) => (
        <button key={v.id} data-view={v.id} className={(v.id === 'assistant' ? showing === 'assistant' : sidebar && view === v.id) ? 'active' : ''} title={v.id === 'assistant' ? `Codex (${keyText('⌘I')})` : v.title} aria-label={v.title} aria-keyshortcuts={v.id === 'assistant' ? ariaKeys('⌘I') : undefined} onClick={() => showView(v.id)}>
          <Icon name={v.icon} />
          {v.id === 'chats' && chats > 0 && <span className="badge">{chats}</span>}
          {v.id === 'changes' && <ChangesBadge />}
          {v.id === 'github' && <GitHubBadge />}
        </button>
      ))}
      <span className="divider" />
      {pages.map((p) => (
        <button key={p.id} data-view={p.id} className={showing === p.id ? 'active' : ''} title={p.title} aria-label={p.title} onClick={() => openPage(p.id)}>
          <Icon name={p.icon} />
        </button>
      ))}
      <span className="spacer" />
      <button className={browserShown ? 'active' : ''} title={`Switch between the file and the browser (${keyText('⌘E')})`} aria-label="Switch between the file and the browser" aria-keyshortcuts={ariaKeys('⌘E')} onClick={switchEditor}>
        <Icon name="globe" />
      </button>
      {menu && <ViewsMenu at={menu} hidden={hidden} onClose={() => setMenu(null)} />}
    </aside>
  );
}

function ViewsMenu({ at, hidden, onClose }: { at: { x: number; y: number }; hidden: string[]; onClose: () => void }) {
  const anchor = useRef<HTMLDivElement>(null);
  return (
    <div ref={anchor} className="ui-menu-anchor" style={{ left: at.x, top: at.y }}>
      <Menu trigger={anchor} onClose={onClose}>
        {VIEWS.map((v) => {
          const shown = !hidden.includes(v.id);
          return <MenuItem key={v.id} icon={shown ? 'check' : 'blank'} aria-checked={shown} disabled={!canHideView(v.id)} onClick={() => toggleHiddenView(v.id)}>{v.title}</MenuItem>;
        })}
      </Menu>
    </div>
  );
}
