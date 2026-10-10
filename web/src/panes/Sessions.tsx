import { useEffect, useMemo, useState } from 'react';
import { send, useStore } from '../store';
import type { SavedSession } from '../../../shared/protocol';

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
        <button className="ghost new" title="New session in this project" disabled={running} onClick={() => send({ type: 'new_session' })}>+ New</button>
      </div>
      {running && <div className="hint">Stop or wait for the current turn before switching.</div>}
      <div className="tree">
        {groups.map(([dir, items]) => (
          <div key={dir}>
            <div className="row project" title={dir} onClick={() => flip(setToggled, dir)}>
              <span className="twistie">{isOpen(dir) ? '▾' : '▸'}</span>
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
                </div>
              ))}
            {isOpen(dir) && !filter && items.length > PAGE && (
              <div className="row more" onClick={() => flip(setFull, dir)}>
                {full.has(dir) ? 'Show less' : `Show ${items.length - PAGE} more`}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}
