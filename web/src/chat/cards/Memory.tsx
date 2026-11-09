import { useEffect, useState } from 'react';
import { appendRule } from '../../../../shared/steering';
import { setUi, useStore } from '../../app/store';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Row } from '../../ui/Row';
import { Sheet } from '../../ui/Sheet';
import { fileRequest } from '../../workspace/fileApi';
import { Markdown } from '../Chat';
import { fetchMemory } from '../chatApi';

type MemoryFile = { path: string; name: string; description: string; text: string };

// Where a memory file comes from; android MemoryUi.kt memoryWhere says the same.
export function memoryWhere(f: Pick<MemoryFile, 'path'>, cwd: string) {
  if (f.path.slice(0, f.path.lastIndexOf('/')) === cwd) return 'Repo instructions';
  const account = f.path.split('/').filter((p) => p.startsWith('.claude') || p === '.codex').pop() ?? '';
  return f.path.includes('/memory/') ? `Memory · ${account}` : `Global instructions · ${account}`;
}

// Rules go to the first instruction file, the repo's, as a path in the folder; android MemoryUi.kt ruleFile says the same.
export const ruleFile = (cwd: string, files?: string[]) => (files?.[0]?.startsWith(`${cwd}/`) ? files[0].slice(cwd.length + 1) : 'CLAUDE.md');

async function readRepoFile(file: string): Promise<string> {
  const r = await fileRequest(file);
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()).content ?? '';
}

async function writeRepoFile(file: string, text: string) {
  const r = await fileRequest(file, { method: 'PUT', body: text });
  if (!r.ok) throw new Error(await r.text());
}

// Enter appends a bullet to the repo instruction file; Undo writes the earlier text back.
function AddRule({ file, onSaved }: { file: string; onSaved: () => void }) {
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [before, setBefore] = useState<string | null>(null);
  const add = async () => {
    if (appendRule('', text) === null) return;
    try {
      const old = await readRepoFile(file);
      await writeRepoFile(file, appendRule(old, text)!);
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
      await writeRepoFile(file, before!);
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

// What Claude is told and remembers in this folder, like Windsurf's memories panel. Only the repo instruction file can be changed.
export function MemoryPick({ cwd, onClose }: { cwd: string; onClose: () => void }) {
  const [files, setFiles] = useState<MemoryFile[] | null>(null);
  const [open, setOpen] = useState<MemoryFile | null>(null);
  const [reloads, setReloads] = useState(0);
  const file = ruleFile(cwd, useStore((s) => s.session.instructionFiles));
  useEffect(() => {
    fetchMemory().then((l: MemoryFile[]) => setFiles(Array.isArray(l) ? l : [])).catch(() => setFiles([]));
  }, [reloads]);
  if (open) {
    const edit = () => { setUi({ openFile: file, openEdit: true, follow: false }); onClose(); };
    return (
      <Sheet label={open.name} onClose={onClose}>
        <h2>{open.name}</h2>
        <div className="muted">{memoryWhere(open, cwd)}</div>
        {open.path === `${cwd}/${file}` && <Button size="sm" variant="plain" icon="edit" onClick={edit}>Edit</Button>}
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
      {files && <AddRule file={file} onSaved={() => setReloads((n) => n + 1)} />}
    </Sheet>
  );
}
