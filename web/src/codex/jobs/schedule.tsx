import { useAssistantStore, useAssistantData } from '../data';
import type { Job, Run } from '../data/wiki';
import { clock } from '../time';
import { dayLabel, dayStart } from '../data/dates';
import { money } from '../../ui/util';
import { showSnack, useView } from '../view';
import { type BadgeSpec } from '../../ui/Badge';

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const DAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
export const KINDS = [['hourly', 'Every hour'], ['daily', 'Every day'], ['weekdays', 'Weekdays'], ['weekly', 'Once a week'], ['custom', 'Custom']] as const;
export type Kind = (typeof KINDS)[number][0];

// The simple schedules get pickers; a one-off ("once YYYY-MM-DD HH:MM") or a cron line is Custom (shared/schedule.ts).
export function parseSchedule(s: string | null): { kind: Kind; day: string; time: string } {
  const t = (s ?? '').trim().toLowerCase();
  const m = /^(hourly|daily|weekdays|weekly)(?: (sun|mon|tue|wed|thu|fri|sat))?(?: (\d{1,2}:\d{2}))?$/.exec(t);
  return { kind: (m?.[1] as Kind) ?? (t ? 'custom' : 'weekdays'), day: m?.[2] ?? 'mon', time: m?.[3]?.padStart(5, '0') ?? '08:00' };
}

export const scheduleOf = (kind: Kind, day: string, time: string) => (kind === 'hourly' ? 'hourly' : kind === 'weekly' ? `weekly ${day} ${time}` : `${kind} ${time}`);

export function describe(s: string | null) {
  const { kind, day, time } = parseSchedule(s);
  if (kind === 'custom') {
    const once = /^once (\S+) (\S+)$/i.exec(s!.trim());
    return once ? `Once, ${dayLabel(new Date(`${once[1]}T00:00`).getTime(), true)} at ${once[2]}` : `Cron ${s!.trim()}`;
  }
  if (kind === 'hourly') return 'Every hour';
  if (kind === 'daily') return `Every day at ${time}`;
  if (kind === 'weekdays') return `Weekdays at ${time}`;
  return `${DAY_NAMES[DAYS.indexOf(day)]} at ${time}`;
}

export function at(t: number, now = Date.now()) {
  const days = Math.round((dayStart(t) - dayStart(now)) / 86400_000);
  const day = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days === -1 ? 'yesterday' : dayLabel(t, true);
  return `${day} ${clock(t)}`;
}

export const runsOf = (runs: Run[], j: Job) => runs.filter((r) => !r.deleted && r.profile === j.profile && r.job_id === j.id).sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0));

export const queued = (j: Job, runs: Run[], now: number) => j.next_run_at != null && j.next_run_at <= now && !runsOf(runs, j).some((r) => r.status === 'running');

export const jobState = (j: Job, runs: Run[], now: number): BadgeSpec | null => {
  const latest = runsOf(runs, j)[0]?.status;
  return latest === 'running' ? { status: 'running' } : queued(j, runs, now) ? { status: 'waiting', reason: 'Queued' } : latest === 'error' ? { status: 'failed' } : !j.enabled ? { status: 'skipped', reason: 'Off' } : null;
};

export const rowMeta = (j: Job, runs: Run[], now: number) => (queued(j, runs, now) ? 'Queued' : !j.enabled ? 'Off' : j.next_run_at ? `Next ${at(j.next_run_at)}` : null);

export const canRunNow = (j: Job, runs: Run[], now: number) => !!j.prompt?.trim() && runsOf(runs, j)[0]?.status !== 'running' && !queued(j, runs, now);

type Store = ReturnType<typeof useAssistantStore>;

export function runNow(store: Store, j: Job) {
  void store.editRow('jobs', j, { next_run_at: Date.now() });
  showSnack('Starts within a minute');
}

export function removeJob(store: Store, j: Job) {
  void store.editRow('jobs', j, { deleted: 1 });
  showSnack(`Deleted ${j.name || 'job'}`, () => void store.editRow('jobs', j, { deleted: 0 }));
}

export function runMeta(r: Run) {
  if (r.status === 'running') return 'Running';
  const secs = r.finished_at && r.started_at ? Math.max(1, Math.round((r.finished_at - r.started_at) / 1000)) : 0;
  const dur = !secs ? '' : secs < 60 ? `${secs} s` : `${Math.floor(secs / 60)} min ${secs % 60} s`;
  return [dur, r.cost ? money(r.cost) : ''].filter(Boolean).join(' · ');
}

export function useJobs() {
  const store = useAssistantStore();
  const snap = useAssistantData();
  const { filter } = useView();
  const jobs = snap.jobs.filter((j) => !j.deleted && (filter === 'all' || j.profile === filter)).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  const enable = (j: Job, on: boolean) => void store.editRow('jobs', j, { enabled: on ? 1 : 0, next_run_at: null });
  return { jobs, runs: snap.runs, store, filter, enable };
}

