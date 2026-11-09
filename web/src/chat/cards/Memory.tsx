import { useEffect, useState } from 'react';
import { appendRule } from '../../../../shared/steering';
import { api, setUi } from '../../app/store';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Row } from '../../ui/Row';
import { Sheet } from '../../ui/Sheet';
import { Markdown } from '../Chat';

type MemoryFile = { path: string; name: string; description: string; text: string };

// Where a memory file comes from; android MemoryUi.kt memoryWhere says the same.
export function memoryWhere(f: Pick<MemoryFile, 'path'>, cwd: string) {
  if (f.path === `${cwd}/CLAUDE.md`) return 'Repo instructions';
  const account = f.path.split('/').filter((p) => p.startsWith('.claude')).pop() ?? '';
  return f.path.includes('/memory/') ? `Memory · ${account}` : `Global instructions · ${account}`;
}

const REPO_FILE = 'CLAUDE.md';
const fileUrl = () => api(`/api/file?path=${REPO_FILE}`);

async function readRepoFile(): Promise<string> {
  const r = await fetch(fileUrl());
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()).content ?? '';
}

async function writeRepoFile(text: string) {
  const r = await fetch(fileUrl(), { method: 'PUT', body: text });
  if (!r.ok) throw new Error(await r.text());
}

// Enter appends a bullet to the repo CLAUDE.md; Undo writes the earlier text back.
function AddRule({ onSaved }: { onSaved: () => void }) {
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [before, setBefore] = useState<string | null>(null);
  const add = async () => {
    if (appendRule('', text) === null) return;
    try {
      const old = await readRepoFile();
      await writeRepoFile(appendRule(old, text)!);
      setText('');
      setNote('Rule added');
      setBefore(old);
      onSaved();
    } catch {
      setNote('Could not save the rule. Your text is still here.');
      setBefore(null);
    }
  };
  const undo = async () => {
    try {
      await writeRepoFile(before!);
      setNote('Rule removed');
      onSaved();
    } catch {
      setNote('Could not undo the rule.');
    }
    setBefore(null);
  };
  return (
    <>
      <input value={text} placeholder="Add a rule" aria-label="Add a rule" enterKeyHint="done" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
      {note && <div className="muted" role="status">{note}{before !== null && <Button size="sm" variant="plain" onClick={() => void undo()}>Undo</Button>}</div>}
    </>
  );
}

// What Claude is told and remembers in this folder, like Windsurf's memories panel. Only the repo CLAUDE.md can be changed.
export function MemoryPick({ cwd, onClose }: { cwd: string; onClose: () => void }) {
  const [files, setFiles] = useState<MemoryFile[] | null>(null);
  const [open, setOpen] = useState<MemoryFile | null>(null);
  const [reloads, setReloads] = useState(0);
  useEffect(() => {
    fetch(api('/api/memory')).then((r) => r.json()).then((l: MemoryFile[]) => setFiles(Array.isArray(l) ? l : [])).catch(() => setFiles([]));
  }, [reloads]);
  if (open) {
    const edit = () => { setUi({ openFile: REPO_FILE, openEdit: true, follow: false }); onClose(); };
    return (
      <Sheet label={open.name} onClose={onClose}>
        <h2>{open.name}</h2>
        <div className="muted">{memoryWhere(open, cwd)}</div>
        {open.path === `${cwd}/CLAUDE.md` && <Button size="sm" variant="plain" icon="edit" onClick={edit}>Edit</Button>}
        <Markdown text={open.text || 'Empty'} />
      </Sheet>
    );
  }
  return (
    <Sheet label="Memory" onClose={onClose}>
      <h2>Memory</h2>
      {files === null && <div className="muted">Loading memory…</div>}
      {files?.length === 0 && <div className="muted">No CLAUDE.md or memory files for this folder</div>}
      {files?.map((f) => <Row key={f.path} title={f.name} meta={[f.description, memoryWhere(f, cwd)].filter(Boolean).join(' · ')} trailing={<Icon name="chevron-right" small />} onClick={() => setOpen(f)} />)}
      {files && <AddRule onSaved={() => setReloads((n) => n + 1)} />}
    </Sheet>
  );
}
