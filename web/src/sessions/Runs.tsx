import { useMemo, useState } from 'react';
import { getState, send, useStore } from '../app/store';
import { useAssistantData } from '../codex/data';
import { rowKey } from '../codex/data/sync';
import { jobState } from '../codex/jobs/schedule';
import { useMinute } from '../codex/split';
import { setView } from '../codex/view';
import { EmptyState } from '../ui/Panel';
import { Row } from '../ui/Row';
import { Section, sectionCount } from '../ui/Section';
import { command, money } from '../ui/util';
import type { ChatRun } from '../../../shared/protocol';
import { OUTCOME_DOT, runLine } from '../chat/composerLogic';
import { lastUserAt, runBands, type RunItem } from './runBands';

function openRun(run: ChatRun) {
  const { live } = getState();
  const chat = live.find((c) => c.id === run.chatId) ?? live.find((c) => c.sessionId === run.sessionId);
  send(chat ? { type: 'view', id: chat.id } : { type: 'open_session', sessionId: run.sessionId });
}

function RunRow({ item }: { item: RunItem }) {
  if (item.kind === 'job') {
    const { job, state } = item;
    const open = () => { setView({ list: 'jobs', open: rowKey(job) }); command('assistant'); };
    return <Row title={job.name || 'Untitled job'} meta={`Job · ${state.reason ?? state.status[0].toUpperCase() + state.status.slice(1)}`} onClick={open} />;
  }
  const { run } = item;
  const last = run.rounds.at(-1);
  const meta = (
    <>
      {runLine(run)}
      {last && <> · <span className={`dot ${OUTCOME_DOT[last.outcome]}`} /> {last.line || last.outcome}</>}
    </>
  );
  return <Row title={run.title} meta={meta} trailing={<span className="rn-cost">{money(run.costUsd)}</span>} onClick={() => openRun(run)} />;
}

function Band({ label, items, open, onToggle }: { label: string; items: RunItem[]; open?: boolean; onToggle?: () => void }) {
  if (!items.length) return null;
  return (
    <>
      <Section label={label} count={sectionCount(items.length)} open={open} onToggle={onToggle} />
      {(open ?? true) && <div className="ui-group">{items.map((i) => <RunRow key={i.kind === 'run' ? i.run.id : rowKey(i.job)} item={i} />)}</div>}
    </>
  );
}

export function Runs() {
  const runs = useStore((s) => s.runs);
  const viewing = useStore((s) => s.session.id);
  const userAt = useStore((s) => lastUserAt(s.events));
  const snap = useAssistantData();
  const now = useMinute();
  const [finished, setFinished] = useState(false);
  const bands = useMemo(() => {
    const jobs = snap.jobs.filter((j) => !j.deleted).map((job) => ({ job, state: jobState(job, snap.runs, now) }));
    return runBands(runs, jobs, (chat) => (chat === viewing ? userAt : 0));
  }, [runs, snap, now, viewing, userAt]);
  if (!bands.needs.length && !bands.running.length && !bands.finished.length) return <EmptyState size="sm" icon="sync" title="No runs yet" hint="Loops, goals and scheduled jobs you start show here" />;
  return (
    <div className="runs">
      <Band label="Needs you" items={bands.needs} />
      <Band label="Running" items={bands.running} />
      <Band label="Finished" items={bands.finished.map((run) => ({ kind: 'run', run }))} open={finished} onToggle={() => setFinished(!finished)} />
    </div>
  );
}
