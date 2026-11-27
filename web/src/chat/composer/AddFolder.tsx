import { send, useStore } from '../../app/store';
import { Chip } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { QuickPick } from '../../ui/QuickPick';
import { dirChoices, useWorkspace } from '../../sessions/folders';

const baseName = (p: string) => p.split('/').filter(Boolean).pop() ?? p;

// A folder the agent may use besides the chat folder: a known repo or worktree, or a typed path.
export function AddFolderPick({ at, onClose }: { at?: DOMRect; onClose: () => void }) {
  const cwd = useStore((s) => s.session.cwd);
  const dirs = useStore((s) => s.session.dirs) ?? [];
  const { folders } = useWorkspace(null);
  const items = dirChoices(folders).filter((d) => d.cwd !== cwd && !dirs.includes(d.cwd)).map((d) => ({ value: d.cwd, label: d.name, detail: d.cwd }));
  const typed = (q: string) => (/^[/~]/.test(q) ? [{ value: q, label: `Add ${q}` }] : []);
  return <QuickPick title="Add a folder" note="Claude can read and edit files there too. Type a path or pick a repo." anchor={at} items={items} extra={typed} onPick={(d) => { send({ type: 'set_dirs', dirs: [...dirs, d] }); onClose(); }} onClose={onClose} />;
}

export function FolderChips() {
  const dirs = useStore((s) => s.session.dirs) ?? [];
  const running = useStore((s) => s.session.running);
  return dirs.map((d) => (
    <Chip key={d} size="sm" className="cp-dir" title={`${d}\nAlso open to the agent. Click to remove`} disabled={running} onClick={() => send({ type: 'set_dirs', dirs: dirs.filter((x) => x !== d) })}>
      <Icon name="folder" small /><span>{baseName(d)}</span><Icon name="close" small />
    </Chip>
  ));
}
