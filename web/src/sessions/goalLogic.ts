import { getState, send, setUi } from '../app/store';
import { track } from '../app/featureUse';
import type { BadgeSpec } from '../ui/Badge';
import type { ChatRun, RunOp } from '../../../shared/protocol';
import { nextClock } from '../../../shared/util';
import { buildsLine, goalEnd } from '../../../shared/goalText';
import { ADVISOR_LOOP_EVERY } from '../../../shared/advisors';
import { stoppedText } from './runLogic';
import { showSnack } from '../codex/view';

const HOUR = 3_600_000;

export const EVERY = [
  { label: 'Until done', ms: 0 },
  { label: 'Every 30m', ms: 30 * 60_000 },
  { label: 'Every 1h', ms: HOUR },
  { label: 'Every 2h', ms: 2 * HOUR },
  { label: 'Every 4h', ms: ADVISOR_LOOP_EVERY },
];

export type Stop = { stopIn?: number; stopAt?: string };

export const STOPS: (Stop & { label: string })[] = [
  { label: 'None' },
  { label: 'In 1 hour', stopIn: HOUR },
  { label: 'In 4 hours', stopIn: 4 * HOUR },
  { label: '07:00', stopAt: '07:00' },
];

export const CAPS = [{ label: '50', pct: 50 }, { label: '70', pct: 70 }, { label: '90', pct: 90 }, { label: 'Off', pct: null }];

export const CAPS_USD = [{ label: '$1', usd: 1 }, { label: '$5', usd: 5 }, { label: '$10', usd: 10 }, { label: 'Off', usd: null }];

export const BUILDS = [{ label: 'None', n: null }, { label: '3', n: 3 }, { label: '5', n: 5 }, { label: '10', n: 10 }];

export function stopAtMs({ stopIn, stopAt }: Stop, now: number) {
  if (stopIn) return now + stopIn;
  if (!stopAt) return null;
  const [h, m] = stopAt.split(':').map(Number);
  return nextClock(h, m, now);
}

export function goalBadge(run: ChatRun): BadgeSpec {
  if (run.state === 'done') {
    const end = goalEnd(run.why);
    return end === 'done' ? { status: 'done' } : { status: end, reason: run.why };
  }
  if (run.needsYou) return { status: 'waiting', label: 'Needs you' };
  if (run.state === 'paused') return { status: 'waiting', reason: run.why };
  return { status: 'running' };
}

export function usageLine(run: ChatRun) {
  const { week, fiveHour } = run.usage ?? {};
  const parts = [week && `Week ${week.pct}%${run.capPct ? ` of ${run.capPct}% cap` : ''}`, fiveHour && `5-hour ${fiveHour.pct}%`].filter(Boolean);
  const builds = buildsLine(run);
  const cost = run.capUsd ? `$${run.costUsd.toFixed(2)} of $${run.capUsd} cap` : '';
  const usage = parts.length ? parts.join(' · ') : run.capPct ? `${run.capPct}% cap` : cost || builds ? '' : 'No cap';
  return [usage, cost, builds].filter(Boolean).join(' · ');
}

// The prompt of a round is in the transcript; it may take a moment to show after the chat opens.
// Returns a function that stops the retries.
export function showTurn(id: string, onFound?: (el: HTMLElement) => void) {
  let timer: ReturnType<typeof setTimeout>;
  const look = (tries: number) => {
    const el = document.getElementById(`turn-${id}`);
    if (el) { onFound?.(el); el.scrollIntoView({ block: 'center' }); }
    else if (tries) timer = setTimeout(() => look(tries - 1), 100);
  };
  look(20);
  return () => clearTimeout(timer);
}

export function openChat(ids: { chatId?: string | null; sessionId?: string | null }, report?: string) {
  const { live } = getState();
  const chat = live.find((c) => c.id === ids.chatId) ?? live.find((c) => c.sessionId === ids.sessionId);
  if (chat) send({ type: 'view', id: chat.id });
  else if (ids.sessionId) send({ type: 'open_session', sessionId: ids.sessionId });
  if (report) showTurn(report);
}

export function showChat(ids: { chatId?: string | null; sessionId?: string | null }) {
  openChat(ids);
  window.dispatchEvent(new Event('agentview:chat'));
}

// Pause, resume, run now or stop a run (Android Hub.runControl). Stop offers Undo for goals and loops, which keep their state to restore.
export function runControl(run: ChatRun, op: RunOp, running = false) {
  send({ type: 'run', run: run.id, op });
  if (op !== 'stop') return;
  const restorable = run.kind === 'goal' || run.kind === 'loop';
  showSnack(stoppedText(run, running), restorable ? () => send({ type: 'run', run: run.id, op: 'restore' }) : undefined);
}

export const openGoal = (run?: string) => setUi({ goalSheet: run ? { mode: 'detail', run } : { mode: 'start' } });

// The start sheet, for a plan file, for this chat or filled from an ended run (Android GoalStartSheet callers track the same).
export function startGoal(opts: { plan?: string; here?: boolean; from?: ChatRun } = {}) {
  if (opts.plan) track('action:runAsGoal');
  setUi({ goalSheet: { mode: 'start', ...opts } });
}

export const openRun = (run: ChatRun, report = run.rounds.at(-1)?.report) => openChat(run, report);
