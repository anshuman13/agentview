import type { ChatRun, Round } from './protocol.js';
import { clock } from './util.js';

// The run a chat is on now: its last open run, as on the server (Runs.activeFor).
export const activeRun = (runs: ChatRun[], chatId: string) => runs.filter((r) => r.chatId === chatId && r.state !== 'done').at(-1);

const roundOutcome = ({ outcome, line }: Pick<Round, 'outcome' | 'line'>) => (outcome === 'quiet' ? 'nothing to do' : line ? `${outcome}: ${line}` : outcome);

export const roundText = ({ n, at, outcome, line }: Pick<Round, 'n' | 'at' | 'outcome' | 'line'>) =>
  `Round ${n} · ${clock(at)} · ${roundOutcome({ outcome, line })}`;

export const firstRound = (at: number | null) => `First round${at ? ` ${clock(at)}` : ''}`;

export const nextRound = (at: number | null) => `Next round${at ? ` ${clock(at)}` : ''}`;
