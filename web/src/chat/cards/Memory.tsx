import { useEffect, useState } from 'react';
import { api } from '../../app/store';
import { QuickPick } from '../../ui/QuickPick';
import { Sheet } from '../../ui/Sheet';
import { Markdown } from '../Chat';

type MemoryFile = { path: string; name: string; description: string; text: string };

// Where a memory file comes from; android MemoryUi.kt memoryWhere says the same.
export function memoryWhere(f: Pick<MemoryFile, 'path'>, cwd: string) {
  if (f.path === `${cwd}/CLAUDE.md`) return 'Repo instructions';
  const account = f.path.split('/').filter((p) => p.startsWith('.claude')).pop() ?? '';
  return f.path.includes('/memory/') ? `Memory · ${account}` : `Global instructions · ${account}`;
}

// What Claude is told and remembers in this folder, like Windsurf's memories panel. Read-only.
export function MemoryPick({ anchor, cwd, onClose }: { anchor: DOMRect; cwd: string; onClose: () => void }) {
  const [files, setFiles] = useState<MemoryFile[] | null>(null);
  const [open, setOpen] = useState<MemoryFile | null>(null);
  useEffect(() => {
    fetch(api('/api/memory')).then((r) => r.json()).then((l: MemoryFile[]) => setFiles(Array.isArray(l) ? l : [])).catch(() => setFiles([]));
  }, []);
  if (open) {
    return (
      <Sheet label={open.name} onClose={onClose}>
        <h2>{open.name}</h2>
        <div className="muted">{memoryWhere(open, cwd)}</div>
        <Markdown text={open.text || 'Empty'} />
      </Sheet>
    );
  }
  const items = files === null ? [{ value: '', label: 'Loading memory…' }] : files.length ? files.map((f) => ({ value: f.path, label: f.name, detail: [f.description, memoryWhere(f, cwd)].filter(Boolean).join(' · ') })) : [{ value: '', label: 'No CLAUDE.md or memory files for this folder' }];
  return <QuickPick anchor={anchor} title="Memory" items={items} onPick={(v) => { const f = files?.find((x) => x.path === v); if (f) setOpen(f); }} onClose={onClose} />;
}
