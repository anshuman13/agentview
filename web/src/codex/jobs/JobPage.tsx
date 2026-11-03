import { useEffect, useState } from 'react';
import type { Job, Run } from '../data/wiki';
import { Icon } from '../../ui/Icon';
import { firstLine, useOnUnmount } from '../../ui/util';
import { ShowMore, useWindow } from '../../ui/useWindow';
import { setView, showSnack, useEscapeBack } from '../view';
import { useMinute } from '../split';
import { nextRun } from '../../../../shared/schedule';
import { DAYS, DAY_NAMES, KINDS, type Kind, RunStatus, at, parseSchedule, queued, runsOf, scheduleOf, useJobs } from './Jobs';
import { Switch } from './Switch';

const EXAMPLE = 'List my Linear issues that changed since yesterday and add a task for anything that needs me.';

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

export function JobPage({ j }: { j: Job }) {
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
