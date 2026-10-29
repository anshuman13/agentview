import { useMemo } from 'react';
import { useAssistantStore, useAssistantData, useCodex, useSyncStatus } from './data';
import { reviewCount } from './data/wiki';
import { atTime, split } from './data/engine';
import { Icon } from '../ui/Icon';
import { ago } from '../ui/util';
import { FILTER_LABEL, setView, useView, type Filter, type List } from './view';
import { useMinute, useSplit } from './split';

export const LISTS: { id: List; icon: string; label: string }[] = [
  { id: 'today', icon: 'home', label: 'Overview' },
  { id: 'tasks', icon: 'checklist', label: 'Tasks' },
  { id: 'summary', icon: 'comment-discussion', label: 'Summary' },
  { id: 'meetings', icon: 'record', label: 'Meetings' },
  { id: 'jobs', icon: 'history', label: 'Jobs' },
  { id: 'wiki', icon: 'book', label: 'Wiki' },
];
const FILTERS: Filter[] = ['all', 'work', 'personal'];

export function AssistantNav({ onPick }: { onPick?: () => void }) {
  const { list, filter } = useView();
  const store = useAssistantStore();
  const snap = useAssistantData();
  const s = useSplit();
  const { facts, pages } = useCodex();
  const count: Record<List, number> = { today: 0, tasks: s.overdue.length + s.today.length + s.later.filter((r) => atTime(r.at)! < s.endOfDay).length + s.review.length, summary: 0, meetings: 0, jobs: 0, wiki: reviewCount(pages, facts) };
  const sync = useSyncStatus();
  const status = sync.error ? `Sync failed: ${sync.error}` : sync.last ? `Synced ${ago(sync.last, ' ago')}` : sync.syncing ? 'Syncing' : 'Not synced yet';
  const dot = sync.error ? 'bad' : sync.syncing ? 'busy' : sync.last ? 'ok' : 'off';
  return (
    <nav className="as-nav">
      {LISTS.map((l) => (
        <button key={l.id} className={list === l.id ? 'active' : ''} onClick={() => { setView({ list: l.id, open: null, anchor: null, person: null }); onPick?.(); }}>
          <Icon name={l.icon} /><span>{l.label}</span>{count[l.id] > 0 && <span className="as-count">{count[l.id]}</span>}
        </button>
      ))}
      <div className="as-nav-label">Show</div>
      <div className="as-seg" role="radiogroup" aria-label="Show work, personal or both">
        {FILTERS.map((f) => <button key={f} role="radio" aria-checked={filter === f} className={filter === f ? 'on' : ''} onClick={() => setView({ filter: f })}>{FILTER_LABEL[f]}</button>)}
      </div>
      <button className={`as-nav-sync ${dot}`} title="Sync now" onClick={() => store.syncNow()}><span className="as-dot" /><span>{status}</span></button>
    </nav>
  );
}

export function useTodayCount() {
  const snap = useAssistantData();
  const minute = useMinute();
  const ready = snap.phase === 'ready';
  return useMemo(() => {
    if (!ready) return 0;
    const now = Date.now();
    const s = split(snap.items, 'all', now);
    const endOfDay = new Date(now).setHours(24, 0, 0, 0);
    return s.overdue.length + s.today.length + s.later.filter((r) => atTime(r.at)! < endOfDay).length + s.review.length;
  }, [ready, snap.items, minute]);
}
