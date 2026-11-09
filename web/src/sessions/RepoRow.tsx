import { Icon } from '../ui/Icon';
import { ago, pressable } from '../ui/util';
import type { SavedSession, Worktree } from '../../../shared/protocol';
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

export function WorktreeRow({ w, removing, start, remove }: { w: Worktree; removing: boolean; start: () => void; remove: () => void }) {
  return (
    <div
      className={`row session worktree ${removing ? 'removing' : ''}`}
      title={`${w.name}\n${w.cwd}${w.dirty ? `\n${w.dirty} uncommitted` : ''}${w.merged ? `\nPR #${w.merged} merged` : ''}${w.removable ? '' : '\nOpen, or used in the last 12 hours with no merged PR, so it cannot be removed yet'}`}
    >
      <Icon name="git-branch" small />
      <span className="name">{removing ? 'Removing… ' : ''}{w.name.split('/').pop()}</span>
      {w.dirty > 0 && <span className="dirty" title={`${w.dirty} uncommitted`}>M</span>}
      {w.merged && <span className="merged" title={`PR #${w.merged} merged`}>Merged</span>}
      <span className="when">{ago(w.lastActive)}</span>
      {removing ? (
        <span className="busy"><Icon name="loading" small spin /></span>
      ) : (
        <span className="acts">
          <button className="icon-btn" title="New chat in this worktree" onClick={start}><Icon name="add" small /></button>
          {w.removable && (
            <button className="icon-btn" title="Remove worktree, keep the branch" onClick={remove}><Icon name="trash" small /></button>
          )}
        </span>
      )}
    </div>
  );
}

export function SessionRow({ s, selected, opening, open, remove }: { s: SavedSession; selected: boolean; opening: boolean; open: () => void; remove: () => void }) {
  return (
    <div className={`row session ${selected ? 'selected' : ''}`} title={`${s.title}\n${s.cwd}${s.gitBranch ? `\n${s.gitBranch}` : ''}`} onClick={open}>
      <span className="name">{opening ? 'Opening… ' : ''}{s.title}</span>
      <span className="when">{s.provider === 'codex' && 'Codex · '}{ago(s.lastModified)}</span>
      <span className="acts">
        <button className="icon-btn" title="Delete chat" onClick={(e) => { e.stopPropagation(); remove(); }}><Icon name="trash" small /></button>
      </span>
    </div>
  );
}
