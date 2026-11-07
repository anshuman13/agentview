import { Icon } from '../ui/Icon';
import { pressable } from '../ui/util';
import { isDefault, type Folder } from './folders';

type Props = {
  d: Folder;
  active: boolean;
  here: boolean;
  open: boolean;
  icon: string;
  creating: boolean;
  toggle: () => void;
  newTree: () => void;
  start: () => void;
};

export function RepoRow({ d, active, here, open, icon, creating, toggle, newTree, start }: Props) {
  const kids = d.chats.length > 0 || d.trees.length > 0;
  const branch = d.repo && !isDefault(d.repo.branch) ? d.repo.branch : '';
  const dirty = d.repo?.dirty ?? 0;
  return (
    <div className={`row project repo-row ${active ? '' : 'dim'} ${branch ? 'two' : ''} ${here ? 'here' : ''}`} title={dirty ? `${d.cwd}\n${dirty} uncommitted` : d.cwd} {...pressable(() => kids && toggle())}>
      <span className="twistie">{kids && <Icon name={open ? 'chevron-down' : 'chevron-right'} small />}</span>
      <Icon name={icon} small />
      <span className="label">
        <span className="name">{d.name}</span>
        {branch && <span className="chip sm branch-chip" title={branch}>{branch}</span>}
      </span>
      <span className="acts">
        {d.repo?.paseo && (
          <button className="icon-btn" title="New worktree" disabled={creating} onClick={(e) => { e.stopPropagation(); newTree(); }}><Icon name="git-branch-create" small /></button>
        )}
        <button className="icon-btn" title={`New chat in ${d.name}`} onClick={(e) => { e.stopPropagation(); start(); }}><Icon name="add" small /></button>
      </span>
    </div>
  );
}
