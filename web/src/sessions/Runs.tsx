import { useMemo, useState } from 'react';
import { useStore } from '../app/store';
import { useAssistantData } from '../codex/data';
import { rowKey } from '../codex/data/sync';
import { jobState } from '../codex/jobs/schedule';
import { useMinute } from '../codex/tasks/split';
import { setView } from '../codex/view';
import { Button, IconButton } from '../ui/Button';
import { EmptyState } from '../ui/Panel';
import { Row } from '../ui/Row';
import { Section, sectionCount } from '../ui/Section';
import { command, money } from '../ui/util';
import { billing } from '../../../shared/providers';
import type { ChatRun } from '../../../shared/protocol';
import { lastRoundText } from '../../../shared/goalText';
import { OUTCOME_DOT, runLine } from '../chat/composer/composerLogic';
import { openGoal, openRun } from './goalLogic';
import { ReviewCard } from './ReviewCard';
import { runBands, type RunItem } from './runBands';
import { TriesBoard } from './TriesBoard';

export function RunRow({ item, onBoard }: { item: RunItem; onBoard: (id: string) => void }) {
  if (item.kind === 'job') {
    const { job, state } = item;
    const open = () => { setView({ list: 'jobs', open: rowKey(job) }); command('assistant'); };
    return <Row title={job.name || 'Untitled job'} meta={`Job · ${state.reason ?? state.status[0].toUpperCase() + state.status.slice(1)}`} onClick={open} />;
  }
  const { run } = item;
  const last = run.rounds.at(-1);
  const meta = run.pr ? 'PR opened' : (
    <>
      {runLine(run)}
      {last && <> · <span className={`dot ${OUTCOME_DOT[last.outcome]}`} /> {lastRoundText(run, last)}</>}
    </>
  );
  const open = () => (run.kind === 'tries' ? onBoard(run.id) : run.kind === 'goal' ? openGoal(run.id) : openRun(run));
  return <Row title={run.title} meta={meta} trailing={<span className="rn-cost">{money(run.costUsd, billing(run.provider))}</span>} action={run.pr && <IconButton href={run.pr} icon="link-external" label="open" size="sm" />} onClick={open} />;
}

function Band({ label, items, open, onToggle, onBoard }: { label: string; items: RunItem[]; open?: boolean; onToggle?: () => void; onBoard: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <>
      <Section label={label} count={sectionCount(items.length)} open={open} onToggle={onToggle} />
      {(open ?? true) && <div className="ui-group">{items.map((i) => <RunRow key={i.kind === 'run' ? i.run.id : rowKey(i.job)} item={i} onBoard={onBoard} />)}</div>}
    </>
  );
}

export function Runs() {
  const runs = useStore((s) => s.runs);
  const snap = useAssistantData();
  const now = useMinute();
  const [finished, setFinished] = useState(false);
  const [board, setBoard] = useState<string | null>(null);
  const bands = useMemo(() => {
    const jobs = snap.jobs.filter((j) => !j.deleted).map((job) => ({ job, state: jobState(job, snap.runs, now) }));
    return runBands(runs, jobs);
  }, [runs, snap, now]);
  const start = () => openGoal();
  const header = <Section label="Runs" action={<IconButton icon="add" label="New goal" size="sm" onClick={start} />} />;
  if (!bands.review.length && !bands.needs.length && !bands.running.length && !bands.finished.length) return <>{header}<EmptyState size="sm" icon="sync" title="No runs yet" hint="Loops, goals and scheduled jobs you start show here" action={<Button size="sm" onClick={start}>New goal</Button>} /></>;
  return (
    <div className="runs">
      {header}
      {bands.review.length > 0 && <Section label="To review" count={sectionCount(bands.review.length)} />}
      {bands.review.map((run) => <ReviewCard key={run.id} run={run} />)}
      <Band label="Needs you" items={bands.needs} onBoard={setBoard} />
      <Band label="Running" items={bands.running} onBoard={setBoard} />
      <Band label="Finished" items={bands.finished.map((run) => ({ kind: 'run', run }))} open={finished} onToggle={() => setFinished(!finished)} onBoard={setBoard} />
      {board && <TriesBoard runId={board} onClose={() => setBoard(null)} />}
    </div>
  );
}
