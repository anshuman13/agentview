import { useAssistantStore, useAssistantData } from '../data';
import { WEEKLY_DIGEST, type JobPreset } from '../data/presets';
import { newId, rowKey, type Profile } from '../data/sync';
import type { Job, Run } from '../data/wiki';
import { clock } from '../time';
import { dayLabel, dayStart } from '../data/dates';
import { Icon } from '../../ui/Icon';
import { firstLine } from '../../ui/util';
import { setView, useView } from '../view';
import { usePullSync } from '../pullSync';
import { useMinute } from '../split';
import '../../styles/features/wiki.css';
import '../../styles/features/jobs.css';
import { Autopilot } from './Autopilot';
import { JobPage } from './JobPage';
import { Switch } from './Switch';

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

export function RunStatus({ r }: { r: Run }) {
  const label = r.status === 'running' ? 'Running' : r.status === 'ok' ? 'Succeeded' : 'Failed';
  return (
    <span role="img" aria-label={label} title={label}>
      {r.status === 'running' ? <Icon name="loading" small spin color="var(--accent)" /> : <Icon name={r.status === 'ok' ? 'check' : 'error'} small color={r.status === 'ok' ? 'var(--ok)' : 'var(--err)'} />}
    </span>
  );
}

export function useJobs() {
  const store = useAssistantStore();
  const snap = useAssistantData();
  const { filter } = useView();
  const jobs = snap.jobs.filter((j) => !j.deleted && (filter === 'all' || j.profile === filter)).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  const enable = (j: Job, on: boolean) => void store.editRow('jobs', j, { enabled: on ? 1 : 0, next_run_at: null });
  return { jobs, runs: snap.runs, store, filter, enable };
}

function JobsList({ onMenu }: { onMenu: () => void }) {
  const pull = usePullSync();
  useMinute();
  const { jobs, runs, store, filter, enable } = useJobs();
  const mixed = new Set(jobs.map((j) => j.profile)).size > 1;
  const add = (preset?: JobPreset) => {
    const t = Date.now();
    const profile: Profile = filter === 'personal' ? 'personal' : 'work';
    const row: Job = { id: newId(), profile, version: 0, updated_at: t, deleted: 0, dirty: 1, field_times: '{}', name: 'New job', schedule: 'weekdays 08:00', prompt: '', enabled: 1, next_run_at: null, tools: null, ...preset };
    void store.editRow('jobs', row, { name: row.name, schedule: row.schedule, prompt: row.prompt, enabled: 1 });
    setView({ open: rowKey(row) });
  };
  return (
    <div className="wk narrow">
      <header className="wk-head">
        <button className="icon-btn as-menu" title="Lists" aria-label="Lists" onClick={onMenu}><Icon name="menu" /></button>
        <h1>Jobs</h1>
        <span className="spacer" />
        <button className="btn primary mt-take" onClick={() => add()}><Icon name="add" small /> <span>New job</span></button>
      </header>
      {pull.indicator}
      <div className="wk-scroll" ref={pull.ref}>
        <div className="mt-list">
          <Autopilot />
          {jobs.length > 0 && (
            <div className="mt-rows">
              {jobs.map((j) => {
                const last = runsOf(runs, j)[0];
                return (
                  <div key={rowKey(j)} role="button" tabIndex={0} className={`mt-row jb-row${j.enabled ? '' : ' off'}`} onClick={() => setView({ open: rowKey(j) })} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setView({ open: rowKey(j) }); } }}>
                    <span className="mt-body">
                      <span className="mt-title">{j.name || 'Untitled job'}{mixed && <span className={`as-prof ${j.profile}`}>{j.profile === 'work' ? 'Work' : 'Personal'}</span>}</span>
                      <span className="wk-meta">
                        <span>{describe(j.schedule)}</span>
                        {!j.enabled ? <span>Off</span> : queued(j, runs, Date.now()) ? <span>Queued</span> : j.next_run_at ? <span>Next {at(j.next_run_at)}</span> : null}
                      </span>
                      {last && <span className="jb-last"><RunStatus r={last} /> {last.status === 'running' ? 'Running now' : `${at(last.started_at ?? 0)}: ${firstLine(last.output) || 'No reply'}`}</span>}
                    </span>
                    <Switch on={!!j.enabled} label={`Run ${j.name ?? 'job'} on schedule`} onChange={(on) => enable(j, on)} />
                  </div>
                );
              })}
            </div>
          )}
          {!jobs.length && <div className="as-empty"><Icon name="history" /><div>No jobs yet.</div><div className="muted small">A job runs a prompt on a schedule, can add tasks, and sends you the result.</div></div>}
          {!jobs.length && <div className="jb-presets"><button className="btn sm" onClick={() => add(WEEKLY_DIGEST)}><Icon name="sparkle" small /> Weekly digest</button></div>}
        </div>
      </div>
    </div>
  );
}


export function Jobs({ onMenu }: { onMenu: () => void }) {
  const { open } = useView();
  const snap = useAssistantData();
  const j = open ? snap.jobs.find((x) => !x.deleted && rowKey(x) === open) : undefined;
  if (j) return <JobPage j={j} />;
  return <JobsList onMenu={onMenu} />;
}
