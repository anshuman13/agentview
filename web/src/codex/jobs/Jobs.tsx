import { useAssistantData } from '../data';
import { WEEKLY_DIGEST, type JobPreset } from '../data/presets';
import { newId, rowKey, type Profile } from '../data/sync';
import type { Job } from '../data/wiki';
import { Icon } from '../../ui/Icon';
import { firstLine } from '../../ui/util';
import { setView, useView } from '../view';
import { usePullSync } from '../pullSync';
import { useMinute } from '../split';
import '../../styles/features/wiki.css';
import '../../styles/features/meetings.css';
import '../../styles/features/jobs.css';
import { Autopilot } from './Autopilot';
import { JobPage } from './JobPage';
import { Switch } from './Switch';
import { RunStatus, at, describe, rowMeta, runsOf, useJobs } from './schedule';

function JobsList({ onMenu }: { onMenu: () => void }) {
  const pull = usePullSync();
  useMinute();
  const { jobs, runs, store, filter, enable } = useJobs();
  const now = Date.now();
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
                const meta = rowMeta(j, runs, now);
                const last = runsOf(runs, j)[0];
                return (
                  <div key={rowKey(j)} role="button" tabIndex={0} className={`mt-row jb-row${j.enabled ? '' : ' off'}`} onClick={() => setView({ open: rowKey(j) })} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setView({ open: rowKey(j) }); } }}>
                    <span className="mt-body">
                      <span className="mt-title">{j.name || 'Untitled job'}{mixed && <span className={`as-prof ${j.profile}`}>{j.profile === 'work' ? 'Work' : 'Personal'}</span>}</span>
                      <span className="wk-meta">
                        <span>{describe(j.schedule)}</span>
                        {meta !== null && <span>{meta}</span>}
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
