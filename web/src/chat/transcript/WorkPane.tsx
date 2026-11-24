import { useMemo, useState } from 'react';
import { useStore } from '../../app/store';
import { PhoneHeader } from '../../app/shell/PhoneHeader';
import { EmptyState } from '../../ui/Panel';
import { plural } from '../../ui/util';
import { createTranscriptBuilder, firstLine } from './steps';
import { Row } from './Transcript';
import { foldTurns } from './workFold';

// One turn's tool calls and Claude's text between them, in the order they ran, in their own tab.
export function WorkPane({ turn, onBack }: { turn: string; onBack: () => void }) {
  const events = useStore((s) => s.events);
  const cwd = useStore((s) => s.session.cwd);
  const running = useStore((s) => s.session.running);
  const [build] = useState(createTranscriptBuilder);
  const items = useMemo(() => build(events), [build, events]);
  const fold = useMemo(() => foldTurns(items, events).find((r) => r.kind === 'fold' && r.id === turn), [items, events, turn]);
  const prompt = items.find((it) => it.id === turn);
  const title = prompt?.kind === 'user' ? firstLine(prompt.text) : 'Tool calls';
  const hidden = fold?.kind === 'fold' ? fold.hidden : [];
  const waiting = useStore((s) => s.pending.length > 0);
  const last = items.filter((it) => it.kind === 'user').at(-1)?.id === turn;
  const [word, cls] = last && waiting ? ['Needs input', 'input'] : last && running ? ['Working', 'working'] : ['Done', 'review'];
  return (
    <div className="page page-work">
      <PhoneHeader title={title} sub={<span className={`ov-word ${cls}`}>{word}</span>} onBack={onBack} />
      <div className="work-head desktop-only"><b>{title}</b><span className={`ov-word ${cls}`}>{word}</span><span>{plural(hidden.length, 'step')}</span></div>
      <div className="work-label">{word === 'Done' ? 'What Claude did' : 'What Claude is doing'}</div>
      <div className="tr">
        <div className="tr-rows">
          {hidden.length === 0
            ? <EmptyState size="md" icon="list-tree" title="No tool calls" hint="This turn is not in the loaded chat, or it ran no tools" />
            : hidden.map((it) => <Row key={it.id} it={it} cwd={cwd} settled={!running} />)}
        </div>
      </div>
    </div>
  );
}
