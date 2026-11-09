import { useEffect, useState, type ReactElement, type RefObject } from 'react';
import { taskMatches } from '../data/ask/match';
import type { ItemRow } from '../data/sync';
import { Icon } from '../../ui/Icon';
import { EmptyState } from '../../ui/Panel';
import { Section } from '../../ui/Section';
import type { List } from '../view';

// / on Tasks opens the search when nothing else has focus.
export function useTaskSearch(list: List, root: RefObject<HTMLElement | null>) {
  const [query, setQuery] = useState<string | null>(null);
  useEffect(() => {
    if (list !== 'tasks') return setQuery(null);
    const key = (e: KeyboardEvent) => {
      const at = document.activeElement;
      if (e.key !== '/' || e.metaKey || e.ctrlKey || root.current?.offsetParent == null || (at && at !== document.body && !at.matches('[data-row]'))) return;
      e.preventDefault();
      setQuery((q) => q ?? '');
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [list]);
  return [query, setQuery] as const;
}

export function SearchBar({ query, setQuery }: { query: string; setQuery: (q: string | null) => void }) {
  return (
    <div className="as-search">
      <Icon name="search" />
      <input autoFocus value={query} placeholder="Search tasks" aria-label="Search tasks" enterKeyHint="search" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery(null)} />
      <button className="icon-btn" title="Close search" aria-label="Close search" onClick={() => setQuery(null)}><Icon name="close" /></button>
    </div>
  );
}

export function SearchResults({ query, candidates, rows }: { query: string; candidates: ItemRow[]; rows: (rs: ItemRow[], key?: string, droppable?: boolean) => ReactElement }) {
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  const found = candidates.filter((r) => taskMatches(r, q) && !seen.has(r.profile + r.id) && seen.add(r.profile + r.id));
  return (
    <section className="as-results">
      <Section label="Results" count={found.length} />
      {found.length ? rows(found, undefined, false) : <EmptyState size="sm" title="No task matches" />}
    </section>
  );
}
