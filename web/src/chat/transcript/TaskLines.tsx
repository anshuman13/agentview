import { memo, useState } from 'react';
import { useStore } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { Button, Chip } from '../../ui/Button';
import { MemoryPick } from '../cards/Memory';
import { proposalState, usedClaimState, type Claim, type FoldRow, type Proposal } from './workFold';
import { shownWork, toggleWork } from '../chatActions';
import { runningStep } from './steps';
import { EditMarks } from './StepRows';
import { useAssistantTable } from '../../codex/data';
import { setView } from '../../codex/view';
import { MEMORY } from '../../codex/wiki/shared';
import { replaceTarget } from '../../../../shared/claimActions';
import { command, plural, pressable } from '../../ui/util';

// A turn's tasks as small lines, and on the right a button that opens the turn's tool calls in their own tab.
// A finished turn shows only the tasks it marked done: the steps it never reached are no longer next.
export const Tasks = memo(function Tasks({ row: { id, hidden, steps: all, now, thought, work, claims, proposed, remembered }, live }: { row: Extract<FoldRow, { kind: 'fold' }>; live: boolean }) {
  const tools = work.tools;
  const [reading, setReading] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [memory, setMemory] = useState(false);
  const cwd = useStore((s) => s.session.cwd);
  const open = shownWork.use((s) => Object.values(s).includes(id));
  const steps = live ? all : all.filter((s) => s.done);
  const done = steps.filter((s) => s.done).length;
  const current = live ? steps.find((s) => !s.done) : undefined;
  const spin = <span className="tr-dots" aria-hidden="true"><i /><i /></span>;
  const doing = live ? runningStep(hidden, cwd) : '';
  const thinking = live ? thought : '';
  if (!tools && !steps.length && !claims.length && !proposed.length && !remembered.length && !thinking) return null;
  return (
    <div id={`turn-work:${id}`} className="tr-steps">
      <div className="tr-steps-head">
        {steps.length > 0 && <span>{done < steps.length ? `Tasks · ${done} of ${steps.length}` : plural(steps.length, 'task')}</span>}
        {claims.length > 0 && <Chip size="sm" on={reading} className="tr-claims-chip" aria-expanded={reading} onClick={() => setReading((v) => !v)}>{`Used ${plural(claims.length, 'claim')}`}</Chip>}
        {proposed.length > 0 && <Chip size="sm" on={proposing} className="tr-claims-chip" aria-expanded={proposing} onClick={() => setProposing((v) => !v)}>{`Proposed ${plural(proposed.length, 'claim')}`}</Chip>}
        {remembered.length > 0 && <Chip size="sm" className="tr-claims-chip" onClick={() => setMemory(true)}>{`Remembered ${plural(remembered.length, 'memory', 'memories')}`}</Chip>}
        {tools > 0 && <button type="button" className={`tr-tools${open ? ' on' : ''}`} aria-pressed={open} title={open ? "Close this turn's tool calls" : "Open this turn's tool calls in a tab"} onClick={() => toggleWork(id)}>{doing ? <>{spin}<span className="tr-doing">{doing}</span></> : `Used ${plural(tools, 'tool')}`}<Icon name="chevron-right" small /></button>}
        {tools > 0 && <EditMarks count={work} />}
      </div>
      {thinking && <div className="tr-thought">{thinking}</div>}
      {reading && <UsedClaims claims={claims} />}
      {proposing && <ProposedClaims proposed={proposed} />}
      {memory && <MemoryPick cwd={cwd} initial={remembered.length === 1 ? remembered[0] : undefined} onClose={() => setMemory(false)} />}
      {steps.length > 0 && <ul className="tr-tasks">
        {steps.map((s) => (
          <li key={s.id} className={s.done ? 'done' : s === current ? 'now' : undefined}>
            {s.done ? <Icon name="check" small /> : s === current ? spin : <Icon name="circle-large-outline" small />}
            <span>{s === current && now ? now : s.title}</span>
          </li>
        ))}
        {live && !current && now && <li className="now">{spin}<span>{now}</span></li>}
      </ul>}
    </div>
  );
});

// The claims a turn read, each with what became of it; a claim that is not Gone opens on its wiki page, a replaced one at the end of its chain.
function UsedClaims({ claims }: { claims: Claim[] }) {
  const facts = useAssistantTable('facts');
  return (
    <ul className="tr-claims">
      {claims.map((c) => {
        const state = usedClaimState(facts, c.id);
        const note = [c.where, state].filter(Boolean).join(' · ');
        const open = state === 'Gone' ? undefined : pressable(() => {
          const own = facts.find((f) => f.id === c.id)!;
          const id = state === 'Replaced' ? replaceTarget(facts, c.id, own.profile) ?? c.id : c.id;
          setView({ list: 'wiki', open: facts.find((f) => f.id === id)?.page_id ?? MEMORY, anchor: id, person: null });
          command('assistant');
        });
        return <li key={c.id} {...open}>{c.text}{note && <span className="tr-claim-where"> ({note})</span>}</li>;
      })}
    </ul>
  );
}

// The claims a turn proposed, each with its state in the hub mirror, and a way to Review while one waits.
function ProposedClaims({ proposed }: { proposed: Proposal[] }) {
  const facts = useAssistantTable('facts');
  const states = proposed.map((p) => proposalState(facts.find((f) => f.id === p.id)));
  return (
    <>
      <ul className="tr-claims">{proposed.map((p, i) => <li key={p.id}>{p.text} <span className="tr-claim-where">({states[i]})</span></li>)}</ul>
      {states.includes('Waiting') && <Button variant="plain" size="sm" className="tr-review" onClick={() => { setView({ list: 'wiki', open: 'review', anchor: null, person: null }); command('assistant'); }}>Review</Button>}
    </>
  );
}
