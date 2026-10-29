import { useEffect, useState } from 'react';
import { useAssistant } from '../data';
import { WEEKLY_DIGEST, type JobPreset } from '../data/presets';
import { newId, type Profile } from '../data/sync';
import type { Job, Run } from '../data/wiki';
import { clock } from '../time';
import { Icon } from '../../ui/Icon';
import { setView, showSnack, useEscapeBack, useView } from '../view';
import '../../styles/features/wiki.css';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const KINDS = [['hourly', 'Every hour'], ['daily', 'Every day'], ['weekdays', 'Weekdays'], ['weekly', 'Once a week']] as const;
type Kind = (typeof KINDS)[number][0];
const EXAMPLE = 'List my Linear issues that changed since yesterday and add a task for anything that needs me.';

const jobKey = (j: Job) => `${j.profile}:${j.id}`;

// The hub reads the same "hourly", "daily HH:MM", "weekdays HH:MM" and "weekly <day> HH:MM" (assistant/src/jobs.ts).
export function parseSchedule(s: string | null): { kind: Kind; day: string; time: string } {
  const m = /^(hourly|daily|weekdays|weekly)(?: (sun|mon|tue|wed|thu|fri|sat))?(?: (\d{1,2}:\d{2}))?$/.exec((s ?? '').trim().toLowerCase());
  return { kind: (m?.[1] as Kind) ?? 'weekdays', day: m?.[2] ?? 'mon', time: m?.[3]?.padStart(5, '0') ?? '08:00' };
}

export const scheduleOf = (kind: Kind, day: string, time: string) => (kind === 'hourly' ? 'hourly' : kind === 'weekly' ? `weekly ${day} ${time}` : `${kind} ${time}`);

export function describe(s: string | null) {
  const { kind, day, time } = parseSchedule(s);
  if (kind === 'hourly') return 'Every hour';
  if (kind === 'daily') return `Every day at ${time}`;
  if (kind === 'weekdays') return `Weekdays at ${time}`;
  return `${DAY_NAMES[DAYS.indexOf(day)]} at ${time}`;
}

function at(t: number, now = Date.now()) {
  const days = Math.round((new Date(t).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86400_000);
  const day = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days === -1 ? 'yesterday' : new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day} ${clock(t)}`;
}

const runsOf = (runs: Run[], j: Job) => runs.filter((r) => !r.deleted && r.profile === j.profile && r.job_id === j.id).sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0));
const firstLine = (s: string | null) => s?.split('\n').find((l) => l.trim())?.trim() ?? '';

function RunStatus({ r }: { r: Run }) {
  if (r.status === 'running') return <Icon name="loading" small spin color="var(--accent)" />;
  return <Icon name={r.status === 'ok' ? 'check' : 'error'} small color={r.status === 'ok' ? 'var(--ok)' : 'var(--err)'} />;
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} className={`jb-switch${on ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); onChange(!on); }}><span /></button>;
}

function useJobs() {
  const { snap, store } = useAssistant();
  const { filter } = useView();
  const jobs = snap.jobs.filter((j) => !j.deleted && (filter === 'all' || j.profile === filter)).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  const enable = (j: Job, on: boolean) => void store.editRow('jobs', j, { enabled: on ? 1 : 0, next_run_at: null });
  return { jobs, runs: snap.runs, store, filter, enable };
}

function JobsList({ onMenu }: { onMenu: () => void }) {
  const { jobs, runs, store, filter, enable } = useJobs();
  const hasDigest = jobs.some((j) => j.name === WEEKLY_DIGEST.name);
  const add = (preset?: JobPreset) => {
    const t = Date.now();
    const profile: Profile = filter === 'personal' ? 'personal' : 'work';
    const row: Job = { id: newId(), profile, version: 0, updated_at: t, deleted: 0, dirty: 1, field_times: '{}', name: 'New job', schedule: 'weekdays 08:00', prompt: '', enabled: 1, next_run_at: null, ...preset };
    void store.editRow('jobs', row, { name: row.name, schedule: row.schedule, prompt: row.prompt, enabled: 1 });
    setView({ open: jobKey(row) });
  };
  return (
    <div className="wk narrow">
      <header className="wk-head">
        <button className="icon-btn as-menu" title="Lists" aria-label="Lists" onClick={onMenu}><Icon name="menu" /></button>
        <h1>Jobs</h1>
        <span className="spacer" />
        <button className="btn primary mt-take" onClick={() => add()}><Icon name="add" small /> <span>New job</span></button>
      </header>
      <div className="wk-scroll">
        <div className="mt-list">
          {jobs.length > 0 && (
            <div className="mt-rows">
              {jobs.map((j) => {
                const last = runsOf(runs, j)[0];
                return (
                  <div key={jobKey(j)} role="button" tabIndex={0} className={`mt-row jb-row${j.enabled ? '' : ' off'}`} onClick={() => setView({ open: jobKey(j) })} onKeyDown={(e) => e.key === 'Enter' && setView({ open: jobKey(j) })}>
                    <span className="mt-body">
                      <span className="mt-title">{j.name || 'Untitled job'}<span className={`as-prof ${j.profile}`}>{j.profile === 'work' ? 'Work' : 'Personal'}</span></span>
                      <span className="wk-meta">
                        <span>{describe(j.schedule)}</span>
                        {j.enabled && j.next_run_at ? <span>Next {at(j.next_run_at)}</span> : null}
                        {!j.enabled && <span>Off</span>}
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
          <div className="jb-presets">
            {!hasDigest && <button className="btn sm" onClick={() => add(WEEKLY_DIGEST)}><Icon name="sparkle" small /> Weekly digest</button>}
            <button className="btn sm" onClick={() => add({ name: 'Linear changes', schedule: 'weekdays 08:00', prompt: EXAMPLE })}><Icon name="add" small /> Example</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function JobPage({ j }: { j: Job }) {
  const { runs, store, enable } = useJobs();
  const [name, setName] = useState(j.name ?? '');
  const [prompt, setPrompt] = useState(j.prompt ?? '');
  useEffect(() => setName(j.name ?? ''), [j.name]);
  useEffect(() => setPrompt(j.prompt ?? ''), [j.prompt]);
  const back = () => setView({ open: null });
  useEscapeBack(back);
  const sched = parseSchedule(j.schedule);
  const setSchedule = (p: Partial<typeof sched>) => {
    const n = { ...sched, ...p };
    void store.editRow('jobs', j, { schedule: scheduleOf(n.kind, n.day, n.time), next_run_at: null });
  };
  const list = runsOf(runs, j);
  const running = list[0]?.status === 'running';
  const runNow = () => {
    void store.editRow('jobs', j, { next_run_at: Date.now() });
    showSnack('Starts within a minute');
  };
  const remove = () => {
    void store.editRow('jobs', j, { deleted: 1 });
    back();
    showSnack(`Deleted ${j.name || 'job'}`, () => void store.editRow('jobs', j, { deleted: 0 }));
  };
  return (
    <div className="wk narrow">
      <header className="wk-head">
        <button className="icon-btn" title="Back to jobs" aria-label="Back" onClick={back}><Icon name="arrow-left" /></button>
        <nav className="wk-crumbs"><button onClick={back}>Jobs</button></nav>
        <span className="spacer" />
        <button className="btn sm" disabled={running || !prompt.trim()} onClick={runNow}><Icon name="play" small /> Run now</button>
        <button className="icon-btn" title="Delete job" aria-label="Delete job" onClick={remove}><Icon name="trash" /></button>
      </header>
      <div className="wk-scroll">
        <article className="mt-page">
          <input className="wk-title jb-name" value={name} placeholder="Job name" aria-label="Job name" onChange={(e) => setName(e.target.value)} onBlur={() => name !== (j.name ?? '') && void store.editRow('jobs', j, { name: name.trim() || 'Untitled job' })} />
          <div className="wk-meta mt-when">
            <span className={`as-prof ${j.profile}`}>{j.profile === 'work' ? 'Work account' : 'Personal account'}</span>
            {j.enabled && j.next_run_at ? <span>Next {at(j.next_run_at)}</span> : null}
          </div>
          <section className="mt-sec">
            <h2>When</h2>
            <div className="jb-when">
              <select value={sched.kind} aria-label="How often" onChange={(e) => setSchedule({ kind: e.target.value as Kind })}>
                {KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
              {sched.kind === 'weekly' && (
                <select value={sched.day} aria-label="Day" onChange={(e) => setSchedule({ day: e.target.value })}>
                  {[1, 2, 3, 4, 5, 6, 0].map((i) => <option key={i} value={DAYS[i]}>{DAY_NAMES[i].slice(0, -1)}</option>)}
                </select>
              )}
              {sched.kind !== 'hourly' && <input type="time" value={sched.time} aria-label="Time" onChange={(e) => e.target.value && setSchedule({ time: e.target.value })} />}
              <span className="jb-on">{j.enabled ? 'On' : 'Off'}<Switch on={!!j.enabled} label="Run on schedule" onChange={(on) => enable(j, on)} /></span>
            </div>
          </section>
          <section className="mt-sec">
            <h2>Prompt</h2>
            <textarea className="jb-prompt" rows={4} value={prompt} placeholder={EXAMPLE} aria-label="Prompt" onChange={(e) => setPrompt(e.target.value)} onBlur={() => prompt !== (j.prompt ?? '') && void store.editRow('jobs', j, { prompt })} />
            <div className="muted small">Runs on the {j.profile} Claude account. It can only read, add tasks to Codex, and send you its reply.</div>
          </section>
          <section className="mt-sec">
            <h2>Runs</h2>
            {list.map((r) => (
              <div key={r.id} className="jb-run">
                <div className="wk-meta"><span><RunStatus r={r} /> {at(r.started_at ?? 0)}</span>{r.finished_at && r.started_at ? <span>{Math.max(1, Math.round((r.finished_at - r.started_at) / 1000))} s</span> : null}</div>
                {r.output && <div className="jb-output">{r.output}</div>}
              </div>
            ))}
            {!list.length && <div className="muted small">Not run yet.</div>}
          </section>
        </article>
      </div>
    </div>
  );
}

export function Jobs({ onMenu }: { onMenu: () => void }) {
  const { open } = useView();
  const { snap } = useAssistant();
  const j = open ? snap.jobs.find((x) => !x.deleted && jobKey(x) === open) : undefined;
  if (j) return <JobPage j={j} />;
  return <JobsList onMenu={onMenu} />;
}
