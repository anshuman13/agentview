import { useMemo, useState } from 'react';
import { useAssistantStore, useAssistantData, useCodex, useSyncStatus } from './data';
import { reviewCount } from './data/wiki';
import { atTime } from './data/engine';
import { Icon } from '../ui/Icon';
import { ago } from '../ui/util';
import { FILTER_LABEL, setView, useView, type Filter, type List } from './view';
import { sharedSplit, useMinute, useSplit } from './split';
import { dayEnd } from './data/dates';
import { clock } from './time';
import type { Paused, ScanHealth } from './data/sync';

export const LISTS: { id: List; icon: string; label: string }[] = [
  { id: 'today', icon: 'home', label: 'Overview' },
  { id: 'tasks', icon: 'checklist', label: 'Tasks' },
  { id: 'meetings', icon: 'record', label: 'Meetings' },
  { id: 'jobs', icon: 'history', label: 'Jobs' },
  { id: 'wiki', icon: 'book', label: 'Wiki' },
];
const taskCount = (s: ReturnType<typeof sharedSplit>, endOfDay: number) => s.overdue.length + s.today.length + s.later.filter((r) => atTime(r.at)! < endOfDay).length + s.review.length;
const FILTERS: Filter[] = ['all', 'work', 'personal'];

const SCAN_NAME: Record<string, string> = { slack: 'Slack', gmail: 'Gmail', calendar: 'Calendar', 'calendar:work': 'Calendar (work)', 'calendar:personal': 'Calendar (personal)' };

function pausedText(paused: Paused[], now = Date.now()) {
  const on = paused.filter((p) => p.until > now);
  if (!on.length) return '';
  const names = [...new Set(on.map((p) => SCAN_NAME[p.scan] ?? p.scan))];
  const scans = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  return `${scans[0].toUpperCase()}${scans.slice(1)} scans paused: ${on[0].reason} until ${clock(Math.max(...on.map((p) => p.until)))}`;
}

const when = (t: number) => (t >= new Date().setHours(0, 0, 0, 0) ? clock(t) : new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' }));

function scanText(h: ScanHealth) {
  const name = SCAN_NAME[h.scan] ?? h.scan;
  if (h.missing) return { text: `${name} not set up`, bad: false };
  if (h.error && (h.failed ?? 0) >= (h.ok ?? 0)) return { text: `${name} ${when(h.failed!)} failed: ${h.error}`, bad: true };
  if (!h.ok) return { text: `${name} not run yet`, bad: false };
  const counts = Object.entries(h.counts ?? {}).map(([k, n]) => `${n} ${n === 1 ? k.replace(/s$/, '') : k}`).join(', ');
  return { text: `${name} ${when(h.ok)}${counts ? ` · ${counts}` : ''}`, bad: false };
}

function ScanLines({ scans }: { scans: ScanHealth[] }) {
  const store = useAssistantStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const scan = (name: 'slack' | 'gmail') => {
    setBusy(name);
    setFailed((f) => ({ ...f, [name]: '' }));
    store.scanNow(name).catch((err) => setFailed((f) => ({ ...f, [name]: (err as Error).message }))).finally(() => setBusy(null));
  };
  const sorted = Object.keys(SCAN_NAME).flatMap((k) => scans.filter((h) => h.scan === k));
  return sorted.map((h) => {
    const { text, bad } = failed[h.scan] ? { text: `${SCAN_NAME[h.scan]}: ${failed[h.scan]}`, bad: true } : scanText(h);
    return (
      <div key={h.scan} className={`as-nav-scan${bad ? ' bad' : ''}`}>
        <span title={text} className={open === h.scan ? 'open' : ''} onClick={() => setOpen(open === h.scan ? null : h.scan)}>{text}</span>
        {(h.scan === 'slack' || h.scan === 'gmail') && !h.missing && (
          <button className="as-scan-now" disabled={busy !== null} onClick={() => scan(h.scan as 'slack' | 'gmail')}>{busy === h.scan ? 'Scanning' : 'Scan now'}</button>
        )}
      </div>
    );
  });
}

export function AssistantNav({ onPick }: { onPick?: () => void }) {
  const { list, filter } = useView();
  const store = useAssistantStore();
  const snap = useAssistantData();
  const s = useSplit();
  const { facts, pages } = useCodex();
  const count: Record<List, number> = { today: 0, tasks: taskCount(s, s.endOfDay), summary: 0, meetings: 0, jobs: 0, wiki: reviewCount(pages, facts) };
  const sync = useSyncStatus();
  const waiting = sync.pending ? ` · ${sync.pending} ${sync.pending === 1 ? 'change' : 'changes'} waiting` : '';
  const base = sync.error ? `Sync failed: ${sync.error}` : sync.last ? `Synced ${ago(sync.last, ' ago')}` : sync.syncing ? 'Syncing' : 'Not synced yet';
  const status = base + waiting + (sync.saveError ? ' · Not saved on this device' : '');
  const paused = pausedText(sync.paused);
  const dot = sync.error || sync.saveError ? 'bad' : sync.syncing ? 'busy' : sync.last ? 'ok' : 'off';
  return (
    <nav className="as-nav">
      {LISTS.map((l) => (
        <button key={l.id} className={list === l.id ? 'active' : ''} aria-current={list === l.id ? 'page' : undefined} onClick={() => { setView({ list: l.id, open: null, anchor: null, person: null }); onPick?.(); }}>
          <Icon name={l.icon} /><span>{l.label}</span>{count[l.id] > 0 && <span className="as-count">{count[l.id]}</span>}
        </button>
      ))}
      <div className="as-nav-label">Show</div>
      <div className="as-seg" role="radiogroup" aria-label="Show work, personal or both">
        {FILTERS.map((f) => <button key={f} role="radio" aria-checked={filter === f} className={filter === f ? 'on' : ''} onClick={() => setView({ filter: f })}>{FILTER_LABEL[f]}</button>)}
      </div>
      <button className={`as-nav-sync ${dot}`} title="Sync now" onClick={() => store.syncNow()}><span className="as-dot" /><span>{status}</span></button>
      {paused && <div className="as-nav-paused">{paused}</div>}
      <ScanLines scans={sync.scans} />
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
    const s = sharedSplit(snap.items, 'all', now);
    const endOfDay = dayEnd(now);
    return taskCount(s, endOfDay);
  }, [ready, snap.items, minute]);
}

export function AssistantBadge() {
  const n = useTodayCount();
  return n > 0 ? <span className="badge">{n}</span> : null;
}
