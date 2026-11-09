import { useState } from 'react';
import { send, useStore } from '../app/store';
import { Badge, type BadgeSpec } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Confirm, type ConfirmRequest } from '../ui/Confirm';
import { Section, sectionCount } from '../ui/Section';
import { Sheet } from '../ui/Sheet';
import { money } from '../ui/util';
import type { ChatRun, LiveChat, Try } from '../../../shared/protocol';

export type TryColumn = { n: number; branch: string; state: BadgeSpec; line: string; edits?: LiveChat['edits']; cost: number; archived: boolean };

// One column of the board: the try's chat state, its last report, the diff size and cost.
export function tryColumn(run: ChatRun, t: Try, live: LiveChat[]): TryColumn {
  const chat = live.find((c) => c.sessionId === t.sessionId);
  const rounds = run.rounds.filter((r) => r.n === t.n);
  const last = rounds.at(-1);
  const state: BadgeSpec = t.dropped
    ? { status: 'skipped', reason: 'Archived' }
    : chat?.pending || last?.outcome === 'blocked' || last?.outcome === 'question'
      ? { status: 'waiting', label: 'Needs you' }
      : chat?.running || !last
        ? { status: 'running' }
        : { status: last.outcome === 'failed' ? 'failed' : 'done' };
  return {
    n: t.n,
    branch: t.branch,
    state,
    line: last?.line.replace(/^Try \d+: /, '') ?? chat?.last ?? '',
    edits: chat?.edits,
    cost: chat?.cost ?? rounds.reduce((sum, r) => sum + r.costUsd, 0),
    archived: Boolean(t.dropped),
  };
}

export function TriesColumns({ run, live, onOpen, onKeep }: { run: ChatRun; live: LiveChat[]; onOpen: (n: number) => void; onKeep: (n: number) => void }) {
  const tries = run.tries ?? [];
  return (
    <div className="tb-grid" style={{ ['--tries' as string]: tries.length }}>
      {tries.map((t) => {
        const c = tryColumn(run, t, live);
        return (
          <div key={c.n} className="tb-col">
            <div className="tb-head"><span className="tb-branch">{c.branch}</span><Badge {...c.state} /></div>
            <div className="tb-line">{c.line || 'No report yet'}</div>
            <div className="tb-meta">{c.edits ? `+${c.edits.add} -${c.edits.del}` : 'No edits'} · {money(c.cost)}</div>
            {!c.archived && (
              <div className="tb-actions">
                <Button size="sm" onClick={() => onOpen(c.n)}>Open</Button>
                <Button size="sm" variant="tinted" onClick={() => onKeep(c.n)}>Keep try {c.n}</Button>
              </div>
            )}
          </div>
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
          <input className="tb-input" value={text} placeholder="Message to every open try" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && sendAll()} />
          <Button variant="filled" size="sm" disabled={!text.trim()} onClick={sendAll}>Send to all</Button>
        </div>
      )}
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </Sheet>
  );
}
