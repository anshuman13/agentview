import type { BadgeSpec } from '../ui/Badge';
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
