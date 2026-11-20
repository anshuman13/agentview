import { useEffect, useState } from 'react';
import { appendRule, removeRule } from '../../../../shared/steering';
import { setUi, useStore } from '../../app/store';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { EmptyState } from '../../ui/Panel';
import { Skeleton } from '../../ui/Skeleton';
import { Row } from '../../ui/Row';
import { Section, sectionCount } from '../../ui/Section';
import { Sheet } from '../../ui/Sheet';
import { Confirm, type ConfirmRequest } from '../../ui/Confirm';
import { command } from '../../ui/util';
import { fileRequest } from '../../workspace/fileApi';
import { setView, showSnack } from '../../codex/view';
import { useAssistantTable } from '../../codex/data';
import { MEMORY } from '../../codex/wiki/shared';
import { useClaimEdits } from '../../codex/wiki/useClaimEdits';
import { MenuItem } from '../../ui/Menu';
import type { Fact } from '../../codex/data/wiki/wiki';
import { since } from '../../sessions/folders';
import { Badge, LABEL_ON } from '../../ui/Badge';
import { profileOfPath } from '../../../../shared/workspace';
import { loadErrorText } from '../../../../shared/loadError';
import { givenPreferences } from '../../../../shared/preferences';
import { Markdown } from '../Chat';
import { fetchMemory, saveMemory } from '../chatApi';
import { moveMemoryToWiki, rememberChat } from '../chatActions';
import { isMemoryIndex } from '../transcript/workFold';
import { markLine, memoryMark, type MemoryFile, type MemoryMark } from './memoryLogic';

const markBadge = (m: MemoryMark | null) => (m ? <Badge status={LABEL_ON[m.mark]} label={m.mark} /> : null);

// Where a memory file comes from; android MemoryUi.kt memoryWhere says the same.
export function memoryWhere(f: Pick<MemoryFile, 'path'>, cwd: string) {
  if (f.path.slice(0, f.path.lastIndexOf('/')) === cwd) return 'Repo instructions';
  const account = f.path.split('/').filter((p) => p.startsWith('.claude') || p === '.codex').pop() ?? '';
  return f.path.includes('/memory/') ? `Memory · ${account}` : `Global instructions · ${account}`;
}

// Rules go to the first instruction file, the repo's, as a path in the folder; android MemoryUi.kt ruleFile says the same.
export const ruleFile = (cwd: string, files?: string[]) => (files?.[0]?.startsWith(`${cwd}/`) ? files[0].slice(cwd.length + 1) : 'CLAUDE.md');

export function RememberPick({ close }: { close: () => void }) {
  return <Confirm title="Remember" detail="Saved to Memory for every later chat." action="Save" icon="lightbulb" input={{ value: '', placeholder: 'What to remember', maxLength: 400 }} run={async (text) => rememberChat(text)} onClose={close} />;
}

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

// A memory file's body as a field with Save and Cancel; a save can be undone while the file stays open. Move to wiki is beside Edit on every file but MEMORY.md.
function MemoryEdit({ file, draft, setDraft, onSaved, onMove }: { file: MemoryFile; draft: string | null; setDraft: (draft: string | null) => void; onSaved: (text: string) => void; onMove: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const save = async (text: string, undo = false) => {
    setSaving(true);
    try {
      const previous = await saveMemory(file.path, text);
      showSnack(undo ? 'Memory restored' : 'Memory updated', undo ? undefined : () => void save(previous, true));
      setDraft(null);
      onSaved(text);
    } catch {
      showSnack(undo ? 'Could not undo the memory update' : 'Could not save the memory. Your text is still here.');
    }
    setSaving(false);
  };
  return (
    <>
      {draft === null ? (
        <>
          <div className="gl-actions">
            <Button size="sm" variant="plain" icon="edit" onClick={() => setDraft(file.text)}>Edit</Button>
            {!isMemoryIndex(file.path) && <Button size="sm" variant="plain" icon="book" disabled={saving} onClick={() => { setSaving(true); void onMove().finally(() => setSaving(false)); }}>Move to wiki</Button>}
          </div>
          <div className="bd-doc"><Markdown text={file.text || 'Empty'} /></div>
        </>
      ) : (
        <>
          <div className="ui-fields"><textarea rows={8} aria-label="Memory text" value={draft} onChange={(e) => setDraft(e.target.value)} /></div>
          <div className="gl-actions">
            <Button size="sm" variant="plain" onClick={() => setDraft(null)}>Cancel</Button>
            <Button size="sm" disabled={!draft.trim() || saving} onClick={() => void save(draft)}>Save</Button>
          </div>
        </>
      )}
    </>
  );
}

// What the agent is told and remembers in this folder, like Windsurf's memories panel. The repo instruction file and Claude's memory files can be changed.
// `initial` opens that file once the list has loaded.
export function MemoryPick({ cwd, initial, onClose }: { cwd: string; initial?: string; onClose: () => void }) {
  const [files, setFiles] = useState<MemoryFile[] | null>(null);
  const [open, setOpen] = useState<MemoryFile | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<string | null>(null);
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const [reloads, setReloads] = useState(0);
  const file = ruleFile(cwd, useStore((s) => s.session.instructionFiles));
  const facts = useAssistantTable('facts');
  const now = Date.now();
  const markOf = (f: MemoryFile) => memoryMark(f, facts, profileOfPath(cwd), now);
  const reload = () => setReloads((n) => n + 1);
  useEffect(() => {
    fetchMemory().then((list) => {
      setFiles(list);
      setError('');
      if (reloads === 0 && initial) setOpen(list.find((f) => f.path === initial) ?? null);
    }).catch((err: Error) => (files?.length ? showSnack : setError)(loadErrorText(err.message)));
  }, [reloads]);
  if (open) {
    const edit = () => { setUi({ openFile: file, openEdit: true, follow: false }); onClose(); };
    const mark = markOf(open);
    const move = async () => {
      if (!(await moveMemoryToWiki(open, reload))) return;
      setOpen(null);
      reload();
    };
    const toList = () => { setOpen(null); setDraft(null); };
    const back = () => {
      if (ask) return;
      if (draft === null) toList();
      else setAsk({ title: 'Discard the edit?', detail: `Your changes to ${open.name} are not saved.`, action: 'Discard', run: async () => toList() });
    };
    return (
      <Sheet label={open.name} onClose={onClose} onBack={back} className="gl-sheet">
        <Section label={open.name} action={<Button size="sm" variant="plain" onClick={back}>Back</Button>} />
        <div className="bd-doc muted">
          <div>{memoryWhere(open, cwd)}</div>
          {mark && <div>{markLine(mark, open.at)}</div>}
        </div>
        {open.editable ? (
          <MemoryEdit file={open} draft={draft} setDraft={setDraft} onSaved={(text) => { setOpen({ ...open, text }); reload(); }} onMove={move} />
        ) : (
          <>
            {open.path === `${cwd}/${file}` && <div className="gl-actions"><Button size="sm" variant="plain" icon="edit" onClick={edit}>Edit</Button></div>}
            <div className="bd-doc"><Markdown text={open.text || 'Empty'} /></div>
          </>
        )}
        {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
      </Sheet>
    );
  }
  const retry = () => { setError(''); reload(); };
  return (
    <Sheet label="Memory" onClose={onClose} className="gl-sheet">
      <Section label="Memory" />
      {files === null && !error && <Skeleton rows={3} />}
      {error && !files?.length && <EmptyState size="sm" title="Could not load memory" hint={error} action={<Button size="sm" onClick={retry}>Retry</Button>} />}
      {!error && files?.length === 0 && <EmptyState size="sm" title={`No ${file} or memory files`} hint="Add a rule below to create one" />}
      {files?.map((f) => <Row key={f.path} title={f.name} meta={[f.description, memoryWhere(f, cwd), f.at ? since(f.at, now) : ''].filter(Boolean).join(' · ')} state={markBadge(markOf(f))} trailing={<Icon name="chevron-right" small />} onClick={() => setOpen(f)} />)}
      {files && <AddRule file={file} onSaved={reload} />}
      <GivenClaims facts={facts} cwd={cwd} onClose={onClose} />
    </Sheet>
  );
}

// The wiki's Memory claims that new chats in this profile start with; a tap opens the claim on the Memory page, Retire drops it from the list, Remember adds one.
export function GivenClaims({ facts, cwd, onClose }: { facts: Fact[]; cwd: string; onClose: () => void }) {
  const [remember, setRemember] = useState(false);
  const given = givenPreferences(facts, profileOfPath(cwd));
  const openClaim = (id: string) => {
    setView({ list: 'wiki', open: MEMORY, anchor: id, person: null });
    command('assistant');
    onClose();
  };
  return (
    <>
      <Section label="From the wiki" count={sectionCount(given.length)} action={<Button size="sm" variant="plain" icon="add" onClick={() => setRemember(true)}>Remember</Button>} />
      <div className="muted">New chats get these</div>
      {given.length ? given.map((f) => <GivenClaim key={f.id} fact={f} open={() => openClaim(f.id)} />)
        : <EmptyState size="sm" title="Nothing from the wiki yet" hint="Remember adds a preference every new chat in this profile starts with" />}
      {remember && <RememberPick close={() => setRemember(false)} />}
    </>
  );
}

function GivenClaim({ fact, open }: { fact: Fact; open: () => void }) {
  const { retire } = useClaimEdits(fact, 'Memory');
  return (
    <Row leading={<Icon name="lightbulb" />} title={fact.text} meta={fact.at ? since(fact.at) : undefined} onClick={open}
      menu={<>
        <MenuItem icon="book" onClick={open}>Open in wiki</MenuItem>
        <MenuItem icon="archive" danger onClick={retire}>Retire</MenuItem>
      </>} />
  );
}
