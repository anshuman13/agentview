import { useEffect, useState } from 'react';
import { useAssistantStore, useAssistantData } from '../data';
import type { AutopilotConfig, AutopilotState } from '../data/store';
import { WEEKLY_DIGEST, type JobPreset } from '../data/presets';
import { newId, rowKey, type Profile } from '../data/sync';
import type { Job, Run } from '../data/wiki';
import { clock } from '../time';
import { dayLabel, dayStart } from '../data/dates';
import { Icon } from '../../ui/Icon';
import { firstLine, useOnUnmount } from '../../ui/util';
import { ShowMore, useWindow } from '../../ui/useWindow';
import { setView, showSnack, useEscapeBack, useView } from '../view';
import { usePullSync } from '../pullSync';
import { useMinute } from '../split';
import { nextRun } from '../../../../shared/schedule';
import '../../styles/features/wiki.css';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const KINDS = [['hourly', 'Every hour'], ['daily', 'Every day'], ['weekdays', 'Weekdays'], ['weekly', 'Once a week'], ['custom', 'Custom']] as const;
type Kind = (typeof KINDS)[number][0];
const EXAMPLE = 'List my Linear issues that changed since yesterday and add a task for anything that needs me.';


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

function at(t: number, now = Date.now()) {
  const days = Math.round((dayStart(t) - dayStart(now)) / 86400_000);
  const day = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days === -1 ? 'yesterday' : dayLabel(t, true);
  return `${day} ${clock(t)}`;
}

const runsOf = (runs: Run[], j: Job) => runs.filter((r) => !r.deleted && r.profile === j.profile && r.job_id === j.id).sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0));

export const queued = (j: Job, runs: Run[], now: number) => j.next_run_at != null && j.next_run_at <= now && !runsOf(runs, j).some((r) => r.status === 'running');

function RunStatus({ r }: { r: Run }) {
  const label = r.status === 'running' ? 'Running' : r.status === 'ok' ? 'Succeeded' : 'Failed';
  return (
    <span role="img" aria-label={label} title={label}>
      {r.status === 'running' ? <Icon name="loading" small spin color="var(--accent)" /> : <Icon name={r.status === 'ok' ? 'check' : 'error'} small color={r.status === 'ok' ? 'var(--ok)' : 'var(--err)'} />}
    </span>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} className={`jb-switch${on ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); onChange(!on); }}><span /></button>;
}

const MODE_LINE = { off: 'Off', assist: 'On: each ask with a draft is pushed to you with Send reply', away: 'Away: sure answers go out, the rest get a holding note' };
const SEEN: Record<string, string> = { sent: 'Replied', dry: 'Would reply', error: 'Failed', answer: 'Could answer', hold: 'Needs you', escalate: 'Escalate' };
const when = (t: number) => (t >= new Date().setHours(0, 0, 0, 0) ? clock(t) : dayLabel(t, true));

function scanLine(s: AutopilotState) {
  const parts = [s.config.dms ? 'DMs and mentions' : 'mentions', `${s.covered.length} of ${s.watched.length} channels`];
  const h = s.scan;
  const last = !h ? 'Slack scan not set up' : h.error && (h.failed ?? 0) >= (h.ok ?? 0) ? `last scan ${when(h.failed!)} failed` : h.ok ? `last scan ${when(h.ok)}${h.counts ? `, ${h.counts.messages ?? 0} messages, ${h.counts.asks ?? 0} asks` : ''}` : 'no scan yet';
  return `Watching ${parts.join(' and ')} every 15 min on weekdays · ${last}`;
}

// The switch for replying on my behalf in Slack: what it covers, dry run, the people never to answer, the away dates and what it saw.
function Autopilot() {
  const store = useAssistantStore();
  const [state, setState] = useState<AutopilotState | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [away, setAway] = useState(false);
  const [form, setForm] = useState({ from: '', to: '', backup: '', note: '', escalate: '' });
  const load = (p: Promise<AutopilotState>) => p.then((s) => { setState(s); setForm({ ...s.config.away, escalate: s.config.escalate.join(', ') }); setError(''); }).catch((err) => setError((err as Error).message));
  useEffect(() => void load(store.autopilot()), [store]);
  const save = (patch: Partial<AutopilotConfig>) => load(store.autopilot(patch));
  const saveForm = () => {
    const { escalate, ...a } = form;
    const c = state?.config;
    if (!c || (JSON.stringify(a) === JSON.stringify(c.away) && escalate === c.escalate.join(', '))) return;
    void save({ away: a, escalate: escalate.split(',').map((x) => x.trim()).filter(Boolean) });
  };
  const c = state?.config;
  const toggleChannel = (name: string) => {
    if (!state) return;
    const on = state.covered.includes(name);
    void save({ channels: on ? state.covered.filter((n) => n !== name) : [...state.covered, name] });
  };
  const awayText = c?.away.from && c.away.to ? `${dayLabel(new Date(`${c.away.from}T00:00`).getTime(), true)} to ${dayLabel(new Date(`${c.away.to}T00:00`).getTime(), true)}${c.away.backup ? `, ${c.away.backup} covers` : ''}` : 'not set';
  return (
    <section className="mt-rows jb-auto" aria-label="Autopilot">
      <div className="mt-row jb-row" role="button" tabIndex={0} aria-expanded={open} onClick={() => setOpen(!open)} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(!open); } }}>
        <span className="mt-body">
          <span className="mt-title">Reply for me in Slack</span>
          <span className="wk-meta"><span>{error || (state ? MODE_LINE[state.mode] : 'Loading')}</span>{c?.dry_run && c.enabled && <span>Dry run</span>}</span>
        </span>
        {c && <Switch on={c.enabled} label="Reply for me in Slack" onChange={(on) => void save({ enabled: on })} />}
      </div>
      {open && state && c && (
        <div className="jb-auto-form">
          <div className="muted small">{scanLine(state)}</div>
          <div className="jb-chips" role="group" aria-label="Covers">
            <button className={`jb-chip${c.dms ? ' on' : ''}`} aria-pressed={c.dms} onClick={() => void save({ dms: !c.dms })}>DMs</button>
            {state.watched.map((n) => <button key={n} className={`jb-chip${state.covered.includes(n) ? ' on' : ''}`} aria-pressed={state.covered.includes(n)} onClick={() => toggleChannel(n)}>#{n}</button>)}
          </div>
          <label className="jb-auto-line"><span>Dry run: note the reply on the ask instead of sending it</span><Switch on={c.dry_run} label="Dry run" onChange={(on) => void save({ dry_run: on })} /></label>
          <input aria-label="Never answer" placeholder="Never answer these people (names, comma separated)" value={form.escalate} onChange={(e) => setForm({ ...form, escalate: e.target.value })} onBlur={saveForm} />
          <button className="jb-auto-line jb-fold" aria-expanded={away} onClick={() => setAway(!away)}><span>Away dates: {awayText}</span><Icon name={away ? 'chevron-down' : 'chevron-right'} small /></button>
          {away && (
            <div className="jb-auto-away">
              <div className="jb-when">
                <input type="date" aria-label="Away from" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} onBlur={saveForm} />
                <span>to</span>
                <input type="date" aria-label="Away to" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} onBlur={saveForm} />
              </div>
              <input aria-label="Backup" placeholder="Who covers while you are away" value={form.backup} onChange={(e) => setForm({ ...form, backup: e.target.value })} onBlur={saveForm} />
              <input aria-label="Away note" placeholder="Extra line for the holding note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} onBlur={saveForm} />
              <div className="muted small">Between these dates it answers sure questions itself with an auto-reply marker and sends one holding note per person; outside them it only pushes you drafts.</div>
            </div>
          )}
          {state.replies.length > 0 && (
            <div className="jb-auto-log">
              <div className="muted small">Seen</div>
              {state.replies.map((r) => (
                <div key={r.id} className="jb-run">
                  <div className="wk-meta"><span>{SEEN[r.status] ?? SEEN[r.tier ?? ''] ?? 'Seen'}</span><span>{r.who}{r.chat ? ` · ${r.chat}` : ''}</span><span>{when(r.at)}</span>{r.url && <a href={r.url} target="_blank" rel="noreferrer">Open</a>}</div>
                  {r.text && <div className="jb-output">{r.text}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function useJobs() {
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

function RunRow({ r, latest }: { r: Run; latest: boolean }) {
  const [open, setOpen] = useState(false);
  const secs = r.finished_at && r.started_at ? <span>{Math.max(1, Math.round((r.finished_at - r.started_at) / 1000))} s</span> : null;
  if (latest) {
    return (
      <div className="jb-run">
        <div className="wk-meta"><span><RunStatus r={r} /> {at(r.started_at ?? 0)}</span>{secs}</div>
        {r.output && <div className="jb-output">{r.output}</div>}
      </div>
    );
  }
  return (
    <div className="jb-run">
      <button className="jb-run-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <RunStatus r={r} />
        <span>{at(r.started_at ?? 0)}</span>
        {!open && <span className="jb-run-line">{firstLine(r.output)}</span>}
      </button>
      {open && r.output && <div className="jb-output">{r.output}</div>}
    </div>
  );
}

function JobPage({ j }: { j: Job }) {
  useMinute();
  const { runs, store, enable } = useJobs();
  const [shown, more] = useWindow(j.id, 5);
  const [name, setName] = useState(j.name ?? '');
  const [prompt, setPrompt] = useState(j.prompt ?? '');
  const [tools, setTools] = useState(j.tools ?? '');
  const [custom, setCustom] = useState(j.schedule ?? '');
  useEffect(() => setName(j.name ?? ''), [j.name]);
  useEffect(() => setPrompt(j.prompt ?? ''), [j.prompt]);
  useEffect(() => setTools(j.tools ?? ''), [j.tools]);
  useEffect(() => setCustom(j.schedule ?? ''), [j.schedule]);
  const save = () => {
    if (name !== (j.name ?? '')) void store.editRow('jobs', j, { name: name.trim() || 'Untitled job' });
    if (prompt !== (j.prompt ?? '')) void store.editRow('jobs', j, { prompt });
    if (tools.trim() !== (j.tools ?? '')) void store.editRow('jobs', j, { tools: tools.trim() || null });
  };
  const customOk = nextRun(custom, Date.now()) != null;
  const saveCustom = () => { if (customOk && custom.trim() !== j.schedule) void store.editRow('jobs', j, { schedule: custom.trim(), next_run_at: null }); };
  useOnUnmount(save);
  const back = () => setView({ open: null });
  useEscapeBack(back);
  const sched = parseSchedule(j.schedule);
  const setSchedule = (p: Partial<typeof sched>) => {
    const n = { ...sched, ...p };
    // Custom starts from the current schedule, which the custom field reads too.
    if (n.kind !== 'custom') void store.editRow('jobs', j, { schedule: scheduleOf(n.kind, n.day, n.time), next_run_at: null });
    else if (sched.kind !== 'custom') void store.editRow('jobs', j, { schedule: `once ${new Date(Date.now() + 3_600_000).toLocaleDateString('sv')} ${n.time}`, next_run_at: null });
  };
  const list = runsOf(runs, j);
  const running = list[0]?.status === 'running';
  const isQueued = queued(j, runs, Date.now());
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
        <button className="btn sm" disabled={running || isQueued || !prompt.trim()} onClick={runNow}><Icon name="play" small /> Run now</button>
        <button className="icon-btn" title="Delete job" aria-label="Delete job" onClick={remove}><Icon name="trash" /></button>
      </header>
      <div className="wk-scroll">
        <article className="mt-page">
          <input className="wk-title jb-name" value={name} placeholder="Job name" aria-label="Job name" onChange={(e) => setName(e.target.value)} onBlur={save} />
          <div className="wk-meta mt-when">
            <span className={`as-prof ${j.profile}`}>{j.profile === 'work' ? 'Work account' : 'Personal account'}</span>
            {isQueued && <span>Queued</span>}
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
              {sched.kind === 'custom' && <input className="jb-custom" value={custom} aria-label="Custom schedule" aria-invalid={!customOk} placeholder="*/15 0-8 * * 1-5" onChange={(e) => setCustom(e.target.value)} onBlur={saveCustom} onKeyDown={(e) => e.key === 'Enter' && saveCustom()} />}
              {sched.kind !== 'hourly' && sched.kind !== 'custom' && <input type="time" value={sched.time} aria-label="Time" onChange={(e) => e.target.value && setSchedule({ time: e.target.value })} />}
              <span className="jb-on"><Switch on={!!j.enabled} label="Run on schedule" onChange={(on) => enable(j, on)} /></span>
            </div>
            {sched.kind === 'custom' && <div className="muted small">{customOk ? `Next ${at(nextRun(custom, Date.now())!)}. ` : 'This never runs. '}Use "once 2026-11-02 09:00" for one run, or a cron line: minute, hour, day, month, weekday.</div>}
          </section>
          <section className="mt-sec">
            <h2>Prompt</h2>
            <textarea className="jb-prompt" rows={4} value={prompt} placeholder={EXAMPLE} aria-label="Prompt" onChange={(e) => setPrompt(e.target.value)} onBlur={save} />
            <div className="muted small">Runs on the {j.profile} Claude account. It reads, adds tasks to Codex, can push you a notification, and sends you its reply.</div>
          </section>
          <section className="mt-sec">
            <h2>Allowed tools</h2>
            <input className="jb-tools" value={tools} placeholder="browser, mcp__claude_ai_Slack__slack_send_message" aria-label="Allowed tools" onChange={(e) => setTools(e.target.value)} onBlur={save} />
            <div className="muted small">Tools it may use beyond reading, with no one watching: browser for AgentView's own Chrome, or tool names, where * matches the rest.</div>
          </section>
          <section className="mt-sec">
            <h2>Runs</h2>
            {list.slice(0, shown).map((r, i) => <RunRow key={r.id} r={r} latest={i === 0} />)}
            <ShowMore shown={shown} total={list.length} onMore={more} />
            {!list.length && <div className="muted small">Not run yet.</div>}
          </section>
        </article>
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
