import { useMemo, useState } from 'react';
import { useAssistant } from './data';
import { searchAll, type Group, type Hit } from './data/search';
import { Icon } from '../ui/Icon';
import { setView, useView } from './view';
import '../styles/features/wiki.css';

function Hits({ label, group, open }: { label: string; group: Group; open: (h: Hit) => void }) {
  if (!group.total) return null;
  return (
    <section>
      <div className="as-section">{label} · {group.total}</div>
      <div className="mt-days">
        {group.hits.map((h) => (
          <button key={h.profile + h.id} className="mt-row" onClick={() => open(h)}>
            <span className="mt-body">
              <span className="mt-title">{h.title}<span className={`as-prof ${h.profile}`}>{h.profile === 'work' ? 'Work' : 'Personal'}</span></span>
              {h.snippet && <span className="wk-meta"><span>{h.snippet}</span></span>}
            </span>
          </button>
        ))}
      </div>
      {group.total > group.hits.length && <div className="muted small">{group.total - group.hits.length} more</div>}
    </section>
  );
}

export function Search({ onMenu }: { onMenu: () => void }) {
  const { snap } = useAssistant();
  const { filter } = useView();
  const [query, setQuery] = useState('');
  const r = useMemo(() => {
    const keep = <T extends { profile: string }>(rows: T[]) => rows.filter((x) => filter === 'all' || x.profile === filter);
    return searchAll({ items: keep(snap.items), meetings: keep(snap.meetings), facts: keep(snap.facts), pages: keep(snap.pages), jobs: keep(snap.jobs) }, query);
  }, [snap.items, snap.meetings, snap.facts, snap.pages, snap.jobs, filter, query]);
  const key = (h: Hit) => `${h.profile}:${h.id}`;
  return (
    <div className="wk narrow">
      <header className="wk-head">
        <button className="icon-btn as-menu" title="Lists" aria-label="Lists" onClick={onMenu}><Icon name="menu" /></button>
        <h1>Search</h1>
      </header>
      <div className="wk-scroll">
        <div className="mt-list">
          <input autoFocus type="search" value={query} placeholder="Search tasks, meetings, wiki and jobs" aria-label="Search" onChange={(e) => setQuery(e.target.value)} />
          <Hits label="Tasks and notes" group={r.tasks} open={(h) => setView(h.page ? { list: 'meetings', open: `${h.profile}:${h.page}`, person: null } : { list: 'tasks', open: null })} />
          <Hits label="Meetings" group={r.meetings} open={(h) => setView({ list: 'meetings', open: key(h), person: null })} />
          <Hits label="Wiki" group={r.wiki} open={(h) => setView({ list: 'wiki', open: h.page ?? null, anchor: null })} />
          <Hits label="Jobs" group={r.jobs} open={(h) => setView({ list: 'jobs', open: key(h) })} />
          {query.trim() && !r.total && <div className="as-empty"><Icon name="search" /><div>No matches.</div></div>}
        </div>
      </div>
    </div>
  );
}
