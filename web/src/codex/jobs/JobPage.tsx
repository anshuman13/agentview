import { useEffect, useRef, useState } from 'react';
import type { Job } from '../data/wiki/wiki';
import { Icon } from '../../ui/Icon';
import { Section } from '../../ui/Section';
import { useOnUnmount, useReturnFocus } from '../../ui/util';
import { setView, useEscapeBack } from '../view';
import { useMinute } from '../tasks/split';
import { nextRun } from '../../../../shared/schedule';
import { runsOf, useJobs } from './schedule';
import { RunsRow, RunsSheet } from './RunsSheet';
import { JobActions, JobRepo, JobTools, JobWhen, repoName } from './JobParts';

const EXAMPLE = 'List my Linear issues that changed since yesterday and add a task for anything that needs me.';

function useJobEditor(j: Job) {
  const { store } = useJobs();
  const [name, setName] = useState(j.name ?? '');
  const [prompt, setPrompt] = useState(j.prompt ?? '');
  const [custom, setCustom] = useState(j.schedule ?? '');
  useEffect(() => setName(j.name ?? ''), [j.name]);
  useEffect(() => setPrompt(j.prompt ?? ''), [j.prompt]);
  useEffect(() => setCustom(j.schedule ?? ''), [j.schedule]);
  const save = () => {
    if (name !== (j.name ?? '')) void store.editRow('jobs', j, { name: name.trim() || 'Untitled job' });
    if (prompt !== (j.prompt ?? '')) void store.editRow('jobs', j, { prompt });
  };
  const customOk = nextRun(custom, Date.now()) != null;
  const saveCustom = () => { if (customOk && custom.trim() !== j.schedule) void store.editRow('jobs', j, { schedule: custom.trim(), next_run_at: null }); };
  useOnUnmount(save);
  return { name, setName, prompt, setPrompt, custom, setCustom, customOk, save, saveCustom };
}

export function JobPage({ j }: { j: Job }) {
  useMinute();
  const { runs } = useJobs();
  const { name, setName, prompt, setPrompt, custom, setCustom, customOk, save, saveCustom } = useJobEditor(j);
  const [query, setQuery] = useState('');
  const [runsOpen, setRunsOpen] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => { setQuery(''); setRunsOpen(false); }, [j.id]);
  const back = () => setView({ open: null });
  useEscapeBack(runsOpen ? () => {} : back);
  useReturnFocus(runsOpen);
  const list = runsOf(runs, j);
  return (
    <div className="wk narrow">
      <header className="wk-head">
        <button className="icon-btn" title="Back to jobs" aria-label="Back" onClick={back}><Icon name="arrow-left" /></button>
        <nav className="wk-crumbs"><button onClick={back}>Jobs</button></nav>
      </header>
      <div className="wk-scroll">
        <article className="mt-page">
          <input ref={nameInput} className="wk-title jb-name" value={name} placeholder="Job name" aria-label="Job name" onChange={(e) => setName(e.target.value)} onBlur={save} />
          <Section label={j.profile === 'work' ? 'Work account' : 'Personal account'} action={<JobActions j={j} prompt={prompt} nameInput={nameInput} back={back} />} />
          <JobWhen j={j} custom={custom} setCustom={setCustom} customOk={customOk} saveCustom={saveCustom} />
          <section className="mt-sec">
            <h2>Prompt</h2>
            <textarea className="jb-prompt" rows={4} value={prompt} placeholder={EXAMPLE} aria-label="Prompt" onChange={(e) => setPrompt(e.target.value)} onBlur={save} />
            <div className="muted small">{j.repo ? `Runs in a new worktree of ${repoName(j.repo)} on the hub's Mac. Nothing is pushed until you approve it.` : `Runs on the ${j.profile} Claude account. It reads, adds tasks to Codex, can push you a notification, and sends you its reply.`}</div>
          </section>
          <JobRepo j={j} />
          {!j.repo && <JobTools j={j} />}
          <div className="as-group" key={j.id}>
            <RunsRow latest={list[0]} onOpen={() => setRunsOpen(true)} />
          </div>
        </article>
      </div>
      {runsOpen && <RunsSheet runs={list} query={query} setQuery={setQuery} onClose={() => setRunsOpen(false)} />}
    </div>
  );
}
