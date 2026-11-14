import { useState } from 'react';
import { send, useStore } from '../app/store';
import { Badge } from '../ui/Badge';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';
import { Confirm, type ConfirmRequest } from '../ui/Confirm';
import { Section, sectionCount } from '../ui/Section';
import { Sheet } from '../ui/Sheet';
import { money } from '../ui/util';
import { billing } from '../../../shared/providers';
import type { ChatRun, LiveChat } from '../../../shared/protocol';
import { tryColumn } from './triesLogic';

function TriesColumns({ run, live, onOpen, onKeep }: { run: ChatRun; live: LiveChat[]; onOpen: (n: number) => void; onKeep: (n: number) => void }) {
  const tries = run.tries ?? [];
  return (
    <div className="tb-grid" style={{ ['--tries' as string]: tries.length }}>
      {tries.map((t) => {
        const c = tryColumn(run, t, live);
        return (
          <Panel key={c.n} padding="sm" className="tb-col">
            <div className="tb-head"><span className="tb-branch">{c.branch}</span><Badge {...c.state} /></div>
            <div className="tb-line">{c.line || 'No report yet'}</div>
            <div className="tb-meta">{c.edits ? `+${c.edits.add} -${c.edits.del}` : 'No edits'} · {money(c.cost, billing(run.provider))}</div>
            {!c.archived && (
              <div className="tb-actions">
                <Button size="sm" onClick={() => onOpen(c.n)}>Open</Button>
                <Button size="sm" variant="tinted" onClick={() => onKeep(c.n)}>Keep try {c.n}</Button>
              </div>
            )}
          </Panel>
        );
      })}
    </div>
  );
}

export function TriesBoard({ runId, onClose }: { runId: string; onClose: () => void }) {
  const run = useStore((s) => s.runs.find((r) => r.id === runId));
  const live = useStore((s) => s.live);
  const [text, setText] = useState('');
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  if (!run?.tries) return null;
  const open = run.tries.filter((t) => !t.dropped).length;
  const openTry = (n: number) => {
    const t = run.tries!.find((x) => x.n === n)!;
    const chat = live.find((c) => c.sessionId === t.sessionId);
    send(chat ? { type: 'view', id: chat.id } : { type: 'open_session', sessionId: t.sessionId });
    onClose();
  };
  const keep = (n: number) => setAsk({
    title: `Keep try ${n}?`,
    detail: `Archive the other ${open - 1} chats? Their worktrees stay on disk.`,
    action: `Keep try ${n}`,
    run: async () => send({ type: 'tries_keep', run: run.id, n }),
  });
  const sendAll = () => {
    if (!text.trim()) return;
    send({ type: 'tries_send', run: run.id, text: text.trim() });
    setText('');
  };
  return (
    <Sheet label="Tries" onClose={onClose}>
      <Section label={run.title} count={sectionCount(run.tries.length)} />
      <TriesColumns run={run} live={live} onOpen={openTry} onKeep={keep} />
      {open > 0 && (
        <div className="tb-send">
          <input value={text} placeholder="Message to every open try" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && sendAll()} />
          <Button variant="filled" size="sm" disabled={!text.trim()} onClick={sendAll}>Send to all</Button>
        </div>
      )}
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </Sheet>
  );
}
