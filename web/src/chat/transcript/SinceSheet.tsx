import { useState } from 'react';
import { clock } from '../../codex/tasks/time';
import { openGoal } from '../../sessions/goalLogic';
import { Button } from '../../ui/Button';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import { Sheet } from '../../ui/Sheet';
import type { ChatRun, Round } from '../../../../shared/protocol';
import { OUTCOME_DOT, showTurn } from '../composer/composerLogic';
import { foldedRounds, outcomeCounts } from './recap';

const unfolded = new Set<string>();
const word = (text: string) => text[0].toUpperCase() + text.slice(1);

export function SinceSheet({ chat, recap, rounds, run, onClose }: { chat: string; recap: string; rounds: Round[]; run?: ChatRun; onClose: () => void }) {
  const [, redraw] = useState(0);
  const shown = foldedRounds(rounds, unfolded.has(chat));
  const goal = run?.kind === 'goal';
  const label = <>Since you left{rounds.length > 0 && <span className="ss-time">{clock(rounds[0].at)}</span>}</>;
  const counts = outcomeCounts(rounds).map((c) => `${c.n} ${c.outcome === 'quiet' ? 'nothing' : c.outcome}`);
  return (
    <Sheet label="Since you left" onClose={onClose} className="ss-sheet">
      <Section label={label} count={counts.length ? counts : undefined} action={goal && <Button size="sm" variant="plain" onClick={() => { onClose(); openGoal(run.id); }}>Open goal</Button>} />
      <div className="ui-group">
        <Row plain lines={2} title={recap} className="ss-recap" />
      </div>
      {rounds.length > 0 && (
        <div className="ui-group">
          {shown.map((r) => (
            <Row
              key={r.at}
              plain={!r.report}
              leading={<span className={`dot ${OUTCOME_DOT[r.outcome]}`} />}
              title={r.report ? 'Weekly report' : r.line || r.outcome}
              meta={`${clock(r.at)} \u00b7 ${word(r.outcome)}`}
              onClick={r.report ? () => { onClose(); showTurn(r.report!); } : undefined}
            />
          ))}
          {shown.length < rounds.length && <Row plain title={<Button size="sm" variant="gray" onClick={() => { unfolded.add(chat); redraw((n) => n + 1); }}>Show all {rounds.length}</Button>} />}
        </div>
      )}
    </Sheet>
  );
}
