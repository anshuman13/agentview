import { useRef, useState } from 'react';
import { useAssistantData } from '../data';
import { WEEKLY_DIGEST, type JobPreset } from '../data/presets';
import { newId, rowKey, type Profile } from '../data/sync';
import type { Job, Run } from '../data/wiki';
import { Icon } from '../../ui/Icon';
import { EmptyState } from '../../ui/Panel';
import { Row } from '../../ui/Row';
import { IconButton } from '../../ui/Button';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { setView, useView } from '../view';
import { usePullSync } from '../pullSync';
import { useMinute } from '../split';
import '../../styles/features/wiki.css';
import '../../styles/features/meetings.css';
import '../../styles/features/jobs.css';
import { Autopilot } from './Autopilot';
import { AutopilotPage } from './AutopilotPage';
import { JobPage } from './JobPage';
import { canRunNow, describe, jobState, removeJob, rowMeta, runNow, useJobs } from './schedule';
import { Badge } from '../../ui/Badge';

type Jobs = ReturnType<typeof useJobs>;

export function JobRow({ j, runs, now, store, enable }: { j: Job; runs: Run[]; now: number; store: Jobs['store']; enable: Jobs['enable'] }) {
  const [open, setOpen] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const choose = (fn: () => void) => () => { setOpen(false); fn(); };
  const meta = rowMeta(j, runs, now);
  const state = jobState(j, runs, now);
  return (
    <div className={`ui-row-wrap${j.enabled ? '' : ' off'}`}>
      <Row
        title={j.name || 'Untitled job'}
        meta={[describe(j.schedule), meta?.startsWith('Next') && meta].filter(Boolean).join(' · ')}
        trailing={state && <Badge {...state} />}
        onClick={() => setView({ open: rowKey(j) })}
        onLongPress={() => setOpen(true)}
      />
      <span className="jb-more">
        <IconButton ref={more} size="sm" icon="kebab-horizontal" label="More" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} />
        {open && (
          <Menu trigger={more} onClose={() => setOpen(false)}>
            <MenuItem icon="play" disabled={!canRunNow(j, runs, now)} onClick={choose(() => runNow(store, j))}>Run now</MenuItem>
            <MenuItem icon="edit" onClick={choose(() => setView({ open: rowKey(j) }))}>Edit</MenuItem>
            <MenuItem icon={j.enabled ? 'circle-slash' : 'play'} onClick={choose(() => enable(j, !j.enabled))}>{j.enabled ? 'Disable' : 'Enable'}</MenuItem>
            <MenuSeparator />
            <MenuItem icon="trash" danger onClick={choose(() => removeJob(store, j))}>Delete</MenuItem>
          </Menu>
        )}
      </span>
    </div>
  );
}

function JobsList({ onMenu }: { onMenu: () => void }) {
  const pull = usePullSync();
  useMinute();
  const { jobs, runs, store, filter, enable } = useJobs();
  const now = Date.now();
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
        <div className="mt-page">
          <Autopilot />
          {jobs.length > 0 && (
            <div className="ui-group">
              {jobs.map((j) => <JobRow key={rowKey(j)} j={j} runs={runs} now={now} store={store} enable={enable} />)}
            </div>
          )}
          {!jobs.length && <EmptyState size="md" icon="history" title="No jobs yet" hint="A job runs a prompt on a schedule, can add tasks, and sends you the result" />}
          {!jobs.length && <div className="jb-presets"><button className="btn sm" onClick={() => add(WEEKLY_DIGEST)}><Icon name="sparkle" small /> Weekly digest</button></div>}
        </div>
      </div>
    </div>
  );
}


export function Jobs({ onMenu }: { onMenu: () => void }) {
  const { open } = useView();
  const snap = useAssistantData();
  if (open === 'autopilot') return <AutopilotPage />;
  const j = open ? snap.jobs.find((x) => !x.deleted && rowKey(x) === open) : undefined;
  if (j) return <JobPage j={j} />;
  return <JobsList onMenu={onMenu} />;
}
