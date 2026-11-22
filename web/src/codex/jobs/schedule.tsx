import { useAssistantStore, useAssistantData, useSyncStatus } from '../data';
import type { Job, Run } from '../data/wiki/wiki';
import { madeAt, newId, type ItemRow, type Paused, type Profile } from '../data/sync';
import type { JobPreset } from '../data/tasks/presets';
import { clock } from '../tasks/time';
import { dayLabel, dayStart } from '../data/dates';
import { showSnack, useView } from '../view';
import { type BadgeSpec } from '../../ui/Badge';
import { queued, runMeta, runsOf } from '../../../../shared/jobRuns';

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

export { queued, runMeta, runsOf };

// The tasks a job's add_task wrote (source job, people the job name): open first, then done, newest first.
export const tasksOf = (items: ItemRow[], j: Job) => items
  .filter((i) => !i.deleted && i.profile === j.profile && i.source === 'job' && i.people === j.name)
  .sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || madeAt(b) - madeAt(a));

// A job the user just added: the preset's name, schedule and prompt, else a blank weekday 08:00 job.
export const newJob = (profile: Profile, preset?: JobPreset): Job => ({ id: newId(), profile, version: 0, updated_at: Date.now(), deleted: 0, dirty: 1, field_times: '{}', name: 'New job', schedule: 'weekdays 08:00', prompt: '', enabled: 1, next_run_at: null, tools: null, repo: null, quiet: null, account: null, ...preset });

// The fields a name and prompt edit changes: a blank name saves as "Untitled job", a blank prompt stays blank.
export function jobEdits(j: Pick<Job, 'name' | 'prompt'>, name: string, prompt: string) {
  const patch: { name?: string; prompt?: string } = {};
  if (name !== (j.name ?? '')) patch.name = name.trim() || 'Untitled job';
  if (prompt !== (j.prompt ?? '')) patch.prompt = prompt;
  return patch;
}

// Until when the hub holds the job's runs for its profile's usage limit (the `jobs:<profile>` pause), or null.
export const heldUntil = (j: Job, paused: Paused[], now: number) => paused.find((p) => p.scan === `jobs:${j.profile}` && p.until > now)?.until ?? null;

const heldText = (j: Job, paused: Paused[], now: number) => {
  const held = heldUntil(j, paused, now);
  return held ? `Usage limit until ${clock(held)}` : null;
};

const queuedText = (j: Job, paused: Paused[], now: number) => heldText(j, paused, now) ?? 'Queued';

export const jobState = (j: Job, runs: Run[], now: number, paused: Paused[]): BadgeSpec | null => {
  const latest = runsOf(runs, j)[0]?.status;
  return latest === 'running' ? { status: 'running' } : queued(j, runs, now) ? { status: 'waiting', reason: queuedText(j, paused, now) } : latest === 'error' ? { status: 'failed' } : !j.enabled ? { status: 'skipped', reason: 'Off' } : null;
};

// The line under a job's schedule: why it is held, or when it runs next; the badge already says Queued and Off.
export const rowNote = (j: Job, runs: Run[], now: number, paused: Paused[]) => (queued(j, runs, now) ? heldText(j, paused, now) : j.enabled && j.next_run_at ? `Next ${at(j.next_run_at)}` : null);

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

export function useJobs() {
  const store = useAssistantStore();
  const snap = useAssistantData();
  const { paused } = useSyncStatus();
  const { filter } = useView();
  const jobs = snap.jobs.filter((j) => !j.deleted && (filter === 'all' || j.profile === filter)).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  const enable = (j: Job, on: boolean) => void store.editRow('jobs', j, { enabled: on ? 1 : 0, next_run_at: null });
  return { jobs, runs: snap.runs, paused, store, filter, enable };
}

