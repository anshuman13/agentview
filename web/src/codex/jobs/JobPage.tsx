import { useEffect, useRef, useState } from 'react';
import type { Job } from '../data/wiki/wiki';
import { Button, IconButton } from '../../ui/Button';
import { Section } from '../../ui/Section';
import { useOnUnmount, useReturnFocus } from '../../ui/util';
import { setView, useEscapeBack } from '../view';
import { useMinute } from '../tasks/split';
import { nextRun } from '../../../../shared/schedule';
import { jobEdits, runsOf, tasksOf, useJobs } from './schedule';
import { useAssistantTable } from '../data';
import { Row } from '../../ui/Row';
import { Switch } from './Switch';
import { RunsRow, RunsSheet } from './RunsSheet';
import { JobActions, JobRepo, JobTasks, JobTools, JobWhen, repoName } from './JobParts';

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
    const patch = jobEdits(j, name, prompt);
    if (Object.keys(patch).length) void store.editRow('jobs', j, patch);
  };
  const customOk = nextRun(custom, Date.now()) != null;
  const saveCustom = () => { if (customOk && custom.trim() !== j.schedule) void store.editRow('jobs', j, { schedule: custom.trim(), next_run_at: null }); };
  useOnUnmount(save);
  return { name, setName, prompt, setPrompt, custom, setCustom, customOk, save, saveCustom };
}

export function JobPage({ j }: { j: Job }) {
  useMinute();
  const { runs, store } = useJobs();
  const { name, setName, prompt, setPrompt, custom, setCustom, customOk, save, saveCustom } = useJobEditor(j);
  const [query, setQuery] = useState('');
  const [runsOpen, setRunsOpen] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => { setQuery(''); setRunsOpen(false); }, [j.id]);
  const back = () => setView({ open: null });
  useEscapeBack(runsOpen ? () => {} : back);
  useReturnFocus(runsOpen);
  const list = runsOf(runs, j);
  const tasks = tasksOf(useAssistantTable('items'), j);
  return (
    <div className="wk narrow">
      <header className="wk-head">
        <IconButton icon="arrow-left" label="Back" title="Back to jobs" onClick={back} />
        <Button variant="plain" size="sm" onClick={back}>Jobs</Button>
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
            {!j.repo && <Row plain title="Only push when it found something" meta="A reply starting with NOTHING NEW is kept in the runs but not pushed" trailing={<Switch on={!!j.quiet} label="Only push when it found something" onChange={(on) => void store.editRow('jobs', j, { quiet: on ? 1 : 0 })} />} />}
            <RunsRow latest={list[0]} onOpen={() => setRunsOpen(true)} />
          </div>
          <JobTasks tasks={tasks} id={j.id} />
        </article>
      </div>
      {runsOpen && <RunsSheet job={j} runs={list} query={query} setQuery={setQuery} onClose={() => setRunsOpen(false)} />}
    </div>
  );
}
