import { Icon } from '../../ui/Icon';
import { ChangesBadge } from '../../workspace/gitStatus';
import { GitHubBadge } from '../../ops/pulls';
import { useCounts } from '../store/counts';
import { usePages, type Page } from '../pages';
import type { View } from './TabBar';

export const VIEWS: { id: View; icon: string; title: string }[] = [
  { id: 'assistant', icon: 'sparkle', title: 'Codex' },
  { id: 'explorer', icon: 'files', title: 'Explorer' },
  { id: 'changes', icon: 'source-control', title: 'Source Control' },
  { id: 'github', icon: 'github', title: 'GitHub Pull Requests' },
  { id: 'chats', icon: 'comment-discussion', title: 'Sessions' },
  { id: 'sessions', icon: 'repo', title: 'Workspace' },
  { id: 'runs', icon: 'sync', title: 'Runs' },
];

type Props = { showing: string; sidebar: boolean; view: View; browserShown: boolean; showView: (v: View) => void; openPage: (p: Page) => void; switchEditor: () => void };

export function ActivityBar({ showing, sidebar, view, browserShown, showView, openPage, switchEditor }: Props) {
  const pages = usePages();
  const { chats } = useCounts();
  return (
    <aside className="activitybar desktop-only">
      {VIEWS.map((v) => (
        <button key={v.id} data-view={v.id} className={(v.id === 'assistant' ? showing === 'assistant' : sidebar && view === v.id) ? 'active' : ''} title={v.id === 'assistant' ? 'Codex (⌘I)' : v.title} onClick={() => showView(v.id)}>
          <Icon name={v.icon} />
          {v.id === 'chats' && chats > 0 && <span className="badge">{chats}</span>}
          {v.id === 'changes' && <ChangesBadge />}
          {v.id === 'github' && <GitHubBadge />}
        </button>
      ))}
      <span className="divider" />
      {pages.map((p) => (
        <button key={p.id} data-view={p.id} className={showing === p.id ? 'active' : ''} title={p.title} onClick={() => openPage(p.id)}>
          <Icon name={p.icon} />
        </button>
      ))}
      <span className="spacer" />
      <button className={browserShown ? 'active' : ''} title="Switch between the file and the browser (⌘E)" onClick={switchEditor}>
        <Icon name="globe" />
      </button>
    </aside>
  );
}
