import { useEffect, useState } from 'react';
import { appendRule, removeRule } from '../../../../shared/steering';
import { setUi, useStore } from '../../app/store';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { EmptyState } from '../../ui/Panel';
import { Skeleton } from '../../ui/Skeleton';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import { Sheet } from '../../ui/Sheet';
import { fileRequest } from '../../workspace/fileApi';
import { Markdown } from '../Chat';
import { fetchMemory, saveMemory } from '../chatApi';

type MemoryFile = { path: string; name: string; description: string; text: string; editable?: boolean };

// Where a memory file comes from; android MemoryUi.kt memoryWhere says the same.
export function memoryWhere(f: Pick<MemoryFile, 'path'>, cwd: string) {
  if (f.path.slice(0, f.path.lastIndexOf('/')) === cwd) return 'Repo instructions';
  const account = f.path.split('/').filter((p) => p.startsWith('.claude') || p === '.codex').pop() ?? '';
  return f.path.includes('/memory/') ? `Memory · ${account}` : `Global instructions · ${account}`;
}

// Rules go to the first instruction file, the repo's, as a path in the folder; android MemoryUi.kt ruleFile says the same.
export const ruleFile = (cwd: string, files?: string[]) => (files?.[0]?.startsWith(`${cwd}/`) ? files[0].slice(cwd.length + 1) : 'CLAUDE.md');

export async function readRepoFile(file: string, chat?: string): Promise<string> {
  const r = await fileRequest(file, undefined, chat);
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()).content ?? '';
}

export async function writeRepoFile(file: string, text: string, chat?: string) {
  const r = await fileRequest(file, { method: 'PUT', body: text }, chat);
  if (!r.ok) throw new Error(await r.text());
}

// Appends a bullet to the instruction file and returns an undo that reads the file again and removes only that bullet.
export async function addRepoRule(file: string, text: string, chat?: string) {
  await writeRepoFile(file, appendRule(await readRepoFile(file, chat), text)!, chat);
  return async () => {
    const left = removeRule(await readRepoFile(file, chat), text);
    if (left !== null) await writeRepoFile(file, left, chat);
  };
}

// Enter appends a bullet to the repo instruction file; Undo removes it again.
function AddRule({ file, onSaved }: { file: string; onSaved: () => void }) {
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [back, setBack] = useState<(() => Promise<void>) | null>(null);
  const add = async () => {
    if (appendRule('', text) === null) return;
    try {
      const remove = await addRepoRule(file, text);
      setBack(() => remove);
      setText('');
      setNote('Rule added');
      onSaved();
    } catch {
      setNote('Could not save the rule. Your text is still here');
      setBack(null);
    }
  };
  const undo = async () => {
    try {
      await back!();
      setNote('Rule removed');
      onSaved();
    } catch {
      setNote('Could not undo the rule');
    }
    setBack(null);
  };
  return (
    <>
      <div className="ui-fields"><input value={text} placeholder="Add a rule" aria-label="Add a rule" enterKeyHint="done" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} /></div>
      {note && <div className="muted" role="status">{note}{back &&<Button size="sm" variant="plain" onClick={() => void undo()}>Undo</Button>}</div>}
    </>
  );
}

// A memory file's body as a field with Save and Cancel; a save can be undone while the file stays open.
function MemoryEdit({ file, onSaved }: { file: MemoryFile; onSaved: (text: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [back, setBack] = useState<string | null>(null);
  const save = async (text: string, undo = false) => {
    try {
      const previous = await saveMemory(file.path, text);
      setBack(undo ? null : previous);
      setNote(undo ? 'Memory restored' : 'Memory updated');
      setDraft(null);
      onSaved(text);
    } catch {
      setNote(undo ? 'Could not undo the memory update' : 'Could not save the memory. Your text is still here.');
    }
  };
  return (
    <>
      {draft === null ? (
        <>
          <Button size="sm" variant="plain" icon="edit" onClick={() => { setDraft(file.text); setNote(''); }}>Edit</Button>
          <Markdown text={file.text || 'Empty'} />
        </>
      ) : (
        <>
          <div className="ui-fields"><textarea rows={8} aria-label="Memory text" value={draft} onChange={(e) => setDraft(e.target.value)} /></div>
          <Button size="sm" disabled={!draft.trim()} onClick={() => void save(draft)}>Save</Button>
          <Button size="sm" variant="plain" onClick={() => setDraft(null)}>Cancel</Button>
        </>
      )}
      {note && <div className="muted" role="status">{note}{back !== null && <Button size="sm" variant="plain" onClick={() => void save(back, true)}>Undo</Button>}</div>}
    </>
  );
}

// What the agent is told and remembers in this folder, like Windsurf's memories panel. The repo instruction file and Claude's memory files can be changed.
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
        <Section label={open.name} />
        <div className="muted">{memoryWhere(open, cwd)}</div>
        {open.editable ? (
          <MemoryEdit file={open} onSaved={(text) => { setOpen({ ...open, text }); setReloads((n) => n + 1); }} />
        ) : (
          <>
            {open.path === `${cwd}/${file}` && <Button size="sm" variant="plain" icon="edit" onClick={edit}>Edit</Button>}
            <Markdown text={open.text || 'Empty'} />
          </>
        )}
      </Sheet>
    );
  }
  return (
    <Sheet label="Memory" onClose={onClose}>
      <Section label="Memory" />
      {files === null && <Skeleton rows={3} />}
      {files?.length === 0 && <EmptyState size="sm" title={`No ${file} or memory files`} hint="Add a rule below to create one" />}
      {files?.map((f) => <Row key={f.path} title={f.name} meta={[f.description, memoryWhere(f, cwd)].filter(Boolean).join(' · ')} trailing={<Icon name="chevron-right" small />} onClick={() => setOpen(f)} />)}
      {files && <AddRule file={file} onSaved={() => setReloads((n) => n + 1)} />}
    </Sheet>
  );
}
