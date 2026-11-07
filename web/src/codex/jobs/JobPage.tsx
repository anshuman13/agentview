import { useEffect, useMemo, useRef, useState } from 'react';
import type { Job, Run } from '../data/wiki';
import { Icon } from '../../ui/Icon';
import { EmptyState } from '../../ui/Panel';
import { SearchedOutput } from '../../ui/SearchedOutput';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import { Button, IconButton } from '../../ui/Button';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { useOnUnmount } from '../../ui/util';
import { copyText, setView, useEscapeBack } from '../view';
import { useMinute } from '../split';
import { nextRun } from '../../../../shared/schedule';
import { DAYS, DAY_NAMES, KINDS, type Kind, at, canRunNow, jobState, parseSchedule, removeJob, runMeta, runNow, runsOf, scheduleOf, useJobs } from './schedule';

const EXAMPLE = 'List my Linear issues that changed since yesterday and add a task for anything that needs me.';

function CopyOutput({ r }: { r: Run }) {
  return <button className="icon-btn" title="Copy output" aria-label="Copy output" onClick={() => copyText(r.output!, 'Output copied')}><Icon name="copy" small /></button>;
}

function RunRow({ r, latest, query, setQuery }: { r: Run; latest: boolean; query: string; setQuery: (q: string) => void }) {
  const [open, setOpen] = useState(latest);
  const meta = runMeta(r);
  return (
    <div className="jb-run">
      <Row
        plain={!r.output}
        title={at(r.started_at ?? 0)}
        meta={meta || undefined}
        trailing={<><span className={`badge ${r.status === 'running' ? 'running' : r.status === 'ok' ? 'quiet' : 'waiting'}`}>{r.status === 'running' ? 'Running' : r.status === 'ok' ? 'Succeeded' : 'Failed'}</span>{r.output && <Icon name={open ? 'chevron-down' : 'chevron-right'} small />}</>}
        aria-expanded={r.output ? open : undefined}
        onClick={r.output ? () => setOpen(!open) : undefined}
      />
      {open && r.output && (
        <div className="jb-run-body">
          <div className="jb-run-tools"><CopyOutput r={r} /></div>
          {latest ? <SearchedOutput text={r.output} query={query} setQuery={setQuery} label="Search output" className="jb-output" /> : <div className="jb-output">{r.output}</div>}
        </div>
      )}
    </div>
  );
}

export function JobPage({ j }: { j: Job }) {
  useMinute();
  const { runs, store, enable } = useJobs();
  const [name, setName] = useState(j.name ?? '');
  const [prompt, setPrompt] = useState(j.prompt ?? '');
  const [tools, setTools] = useState(j.tools ?? '');
  const [custom, setCustom] = useState(j.schedule ?? '');
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => setQuery(''), [j.id]);
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
  const now = Date.now();
  const canRun = canRunNow({ ...j, prompt }, runs, now);
  const state = jobState(j, runs, now);
  const remove = () => {
    removeJob(store, j);
    back();
  };
  const pick = (fn: () => void) => () => { setMenu(false); fn(); };
  return (
    <div className="wk narrow">
      <header className="wk-head">
        <button className="icon-btn" title="Back to jobs" aria-label="Back" onClick={back}><Icon name="arrow-left" /></button>
        <nav className="wk-crumbs"><button onClick={back}>Jobs</button></nav>
      </header>
      <div className="wk-scroll">
        <article className="mt-page">
          <input ref={nameInput} className="wk-title jb-name" value={name} placeholder="Job name" aria-label="Job name" onChange={(e) => setName(e.target.value)} onBlur={save} />
          <Section
            label={j.profile === 'work' ? 'Work account' : 'Personal account'}
            action={
              <span className="jb-actions">
                {state && <span className={`badge ${state[1]}`}>{state[0]}</span>}
                <Button size="sm" variant="filled" icon="play" disabled={!canRun} onClick={() => runNow(store, j)}>Run now</Button>
                <span className="jb-more">
                  <IconButton ref={more} size="sm" icon="kebab-horizontal" label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
                  {menu && (
                    <Menu trigger={more} onClose={() => setMenu(false)}>
                      <MenuItem icon="edit" onClick={pick(() => { nameInput.current?.focus(); nameInput.current?.select(); })}>Edit</MenuItem>
                      <MenuItem icon={j.enabled ? 'circle-slash' : 'play'} onClick={pick(() => enable(j, !j.enabled))}>{j.enabled ? 'Disable' : 'Enable'}</MenuItem>
                      <MenuSeparator />
                      <MenuItem icon="trash" danger onClick={pick(remove)}>Delete</MenuItem>
                    </Menu>
                  )}
                </span>
              </span>
            }
          />
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
            {list.length > 0 && <div className="jb-runs">{list.slice(0, 10).map((r, i) => <RunRow key={r.id} r={r} latest={i === 0} query={query} setQuery={setQuery} />)}</div>}
            {!list.length && <EmptyState size="sm" title="Not run yet" />}
          </section>
        </article>
      </div>
    </div>
  );
}
