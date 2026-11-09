import { createFolder } from './sessionApi';
import { notice, send, setUi, useStore } from '../app/store';
import { appSettings } from '../app/appSettings';
import { QuickPick } from '../ui/QuickPick';
import { useWorkspace } from './folders';

export function RepoPicker() {
  const cwd = useStore((s) => s.session.cwd);
  const { folders } = useWorkspace(null);
  const roots = appSettings.use((s) => s.roots);
  const close = () => setUi({ repoPicker: false });
  const items = folders.flatMap((f) => [
    ...(f.repo ? [{ value: f.cwd, label: f.name, detail: `${f.repo.root} · ${f.repo.kind === 'new' ? 'empty' : f.repo.branch || 'no git'}` }] : []),
    ...f.trees.map((w) => ({ value: w.cwd, label: w.name.split('/').pop()!, detail: `${w.project} worktree` })),
  ]);
  return (
    <QuickPick
      title="Start a chat in a folder, or type a name for a new project"
      items={items}
      current={folders.find((f) => f.cwd === cwd || f.trees.some((w) => w.cwd === cwd))?.cwd}
      extra={(q) => (/^[A-Za-z0-9][\w.-]*$/.test(q) && !folders.some((f) => f.name === q) ? roots.map((root) => ({ value: `create:${root}:${q}`, label: `Create ${q}`, detail: `new project in ~/${root}` })) : [])}
      onPick={async (v) => {
        close();
        if (!v.startsWith('create:')) return send({ type: 'new_session', cwd: v });
        const [, root, name] = v.split(':');
        const r = await createFolder(root, name);
        const body = await r?.json().catch(() => null);
        if (r?.ok && body?.cwd) send({ type: 'new_session', cwd: body.cwd });
        else notice(body?.error ?? 'Could not create the folder');
      }}
      onClose={close}
    />
  );
}
