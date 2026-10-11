import { useEffect, useMemo, useState } from 'react';
import { send, useStore } from '../store';
import { Icon } from '../Icon';
import { Confirm, type ConfirmRequest } from '../Confirm';
import { STALE_MS, type SavedSession, type Worktree } from '../../../shared/protocol';

const PAGE = 10;

export function Sessions() {
  const current = useStore((s) => s.session.sessionId);
  const cwd = useStore((s) => s.session.cwd);
  const running = useStore((s) => s.session.running);
  const lastEvent = useStore((s) => s.events[s.events.length - 1]);
  const [list, setList] = useState<SavedSession[]>([]);
  const [filter, setFilter] = useState('');
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [full, setFull] = useState<Set<string>>(new Set());
  const [opening, setOpening] = useState<string | null>(null);
  const [trees, setTrees] = useState<Worktree[] | null>(null);
  const [treesOpen, setTreesOpen] = useState(false);
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (lastEvent?.kind === 'system') setOpening(null);
  }, [lastEvent]);

  useEffect(() => {
    fetch('/api/sessions').then((r) => r.json()).then(setList);
    setOpening(null);
  }, [current]);

  const groups = useMemo(() => {
    const f = filter.toLowerCase();
    const m = new Map<string, SavedSession[]>();
    for (const s of list) {
      if (f && !`${s.title} ${s.cwd} ${s.gitBranch ?? ''}`.toLowerCase().includes(f)) continue;
      m.set(s.cwd, [...(m.get(s.cwd) ?? []), s]);
    }
    return [...m.entries()];
  }, [list, filter]);

  const open = (id: string) => {
    if (id === current || running) return;
    setOpening(id);
    send({ type: 'open_session', sessionId: id });
  };

  useEffect(() => {
    if (treesOpen) fetch('/api/worktrees').then((r) => r.json()).then((t) => setTrees(Array.isArray(t) ? t : []));
  }, [treesOpen]);

  const call = async (url: string, fallback: string) => {
    const r = await fetch(url, { method: 'DELETE' });
    if (!r.ok) setError((await r.json().catch(() => null))?.error ?? fallback);
    return r.ok;
  };

  const remove = (s: SavedSession) =>
    setAsk({
      title: 'Delete this chat?',
      detail: s.title,
      warning: 'The transcript is removed permanently.',
      action: 'Delete',
      run: async () => {
        if (await call(`/api/sessions?id=${encodeURIComponent(s.sessionId)}`, 'Could not delete the chat')) setList((l) => l.filter((x) => x.sessionId !== s.sessionId));
      },
    });

  const removeTree = (w: Worktree) =>
    setAsk({
      title: `Remove this ${w.project} worktree?`,
      detail: w.name,
      warning: `${w.dirty ? `${w.dirty} uncommitted ${w.dirty === 1 ? 'change' : 'changes'} will be lost. ` : ''}The folder is deleted, the branch is kept.`,
      action: 'Remove',
      run: async () => {
        flip(setRemoving, w.id);
        if (await call(`/api/worktrees?id=${encodeURIComponent(w.id)}`, 'Could not remove the worktree')) setTrees((t) => t?.filter((x) => x.id !== w.id) ?? null);
        flip(setRemoving, w.id);
      },
    });

  const flip = (set: (f: (prev: Set<string>) => Set<string>) => void, key: string) =>
    set((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  const isOpen = (dir: string) => Boolean(filter) || (dir === cwd) !== toggled.has(dir);

  return (
    <div className="sessions">
      <div className="sessions-bar">
        <input placeholder="Filter sessions" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="icon-btn" title="New session in this project" disabled={running} onClick={() => send({ type: 'new_session' })}><Icon name="add" /></button>
      </div>
      {running && <div className="hint">Stop or wait for the current turn before switching.</div>}
      {error && <div className="hint error" onClick={() => setError(null)}><Icon name="error" small /> {error}</div>}
      <div className="tree">
        {groups.map(([dir, items]) => (
          <div key={dir}>
            <div className="row project" title={dir} onClick={() => flip(setToggled, dir)}>
              <span className="twistie"><Icon name={isOpen(dir) ? 'chevron-down' : 'chevron-right'} small /></span>
              <span className="name">{dir.split('/').pop() || 'Unknown folder'}</span>
              <span className="count">{items.length}</span>
            </div>
            {isOpen(dir) &&
              (full.has(dir) || filter ? items : items.slice(0, PAGE)).map((s) => (
                <div
                  key={s.sessionId}
                  className={`row session ${s.sessionId === current ? 'selected' : ''}`}
                  title={`${s.title}\n${s.cwd}${s.gitBranch ? `\n${s.gitBranch}` : ''}`}
                  onClick={() => open(s.sessionId)}
                >
                  <span className="name">{opening === s.sessionId ? 'Opening… ' : ''}{s.title}</span>
                  <span className="when">{ago(s.lastModified)}</span>
                  {s.sessionId !== current && Date.now() - s.lastModified > STALE_MS && (
                    <button className="icon-btn delete" title="Delete chat" onClick={(e) => { e.stopPropagation(); setError(null); remove(s); }}>
                      <Icon name="trash" small />
                    </button>
                  )}
                </div>
              ))}
            {isOpen(dir) && !filter && items.length > PAGE && (
              <div className="row more" onClick={() => flip(setFull, dir)}>
                {full.has(dir) ? 'Show less' : `Show ${items.length - PAGE} more`}
              </div>
            )}
          </div>
        ))}
        <div className="row project worktrees" onClick={() => setTreesOpen((v) => !v)}>
          <span className="twistie"><Icon name={treesOpen ? 'chevron-down' : 'chevron-right'} small /></span>
          <span className="name">Worktrees</span>
          {trees && <span className="count">{trees.length}</span>}
        </div>
        {treesOpen && !trees && <div className="row more">Loading…</div>}
        {treesOpen && trees?.length === 0 && <div className="row more">No Paseo worktrees</div>}
        {treesOpen && trees?.map((w) => (
          <div
            key={w.id}
            className={`row session ${removing.has(w.id) ? 'removing' : ''}`}
            title={`${w.name}\n${w.cwd}${w.dirty ? `\n${w.dirty} uncommitted` : ''}${w.removable ? '' : '\nUsed in the last 12 hours or open, so it cannot be removed yet'}`}
          >
            <span className="name">{removing.has(w.id) ? 'Removing… ' : ''}{w.name.split('/').pop()}</span>
            {w.dirty > 0 && <span className="dirty" title={`${w.dirty} uncommitted`}>M</span>}
            <span className="when">{ago(w.lastActive)}</span>
            {removing.has(w.id) ? (
              <span className="busy"><Icon name="loading" small spin /></span>
            ) : w.removable && (
              <button className="icon-btn delete" title="Remove worktree, keep the branch" onClick={() => { setError(null); removeTree(w); }}>
                <Icon name="trash" small />
              </button>
            )}
          </div>
        ))}
      </div>
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}
