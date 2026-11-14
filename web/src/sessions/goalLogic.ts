import { getState, send, setUi } from '../app/store';
import { track } from '../app/featureUse';
import type { BadgeSpec } from '../ui/Badge';
import type { ChatRun, RunOp } from '../../../shared/protocol';
import { nextClock } from '../../../shared/util';
import { buildsLine } from '../../../shared/goalText';
import { ADVISOR_LOOP_EVERY } from '../../../shared/advisors';
import { showTurn, stoppedText } from '../chat/composer/composerLogic';
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

export const BUILDS = [{ label: 'None', n: null }, { label: '3', n: 3 }, { label: '5', n: 5 }, { label: '10', n: 10 }];

export function stopAtMs({ stopIn, stopAt }: Stop, now: number) {
  if (stopIn) return now + stopIn;
  if (!stopAt) return null;
  const [h, m] = stopAt.split(':').map(Number);
  return nextClock(h, m, now);
}

const PLANNED_ENDS = ['goal met', 'stopped at', 'usage cap', 'ran for 28 days', 'end time', 'weekly usage cap'];

export function goalBadge(run: ChatRun): BadgeSpec {
  if (run.state === 'done') {
    if (PLANNED_ENDS.some((w) => run.why.toLowerCase().startsWith(w))) return { status: 'done' };
    return { status: run.why === 'you stopped it' ? 'skipped' : 'failed', reason: run.why };
  }
  if (run.needsYou) return { status: 'waiting', label: 'Needs you' };
  if (run.state === 'paused') return { status: 'waiting', reason: run.why };
  return { status: 'running' };
}

export function usageLine(run: ChatRun) {
  const { week, fiveHour } = run.usage ?? {};
  const parts = [week && `Week ${week.pct}%${run.capPct ? ` of ${run.capPct}% cap` : ''}`, fiveHour && `5-hour ${fiveHour.pct}%`].filter(Boolean);
  const builds = buildsLine(run);
  const usage = parts.length ? parts.join(' · ') : run.capPct ? `${run.capPct}% cap` : builds ? '' : 'No cap';
  return [usage, builds].filter(Boolean).join(' · ');
}

export function openChat(ids: { chatId?: string | null; sessionId?: string | null }, report?: string) {
  const { live } = getState();
  const chat = live.find((c) => c.id === ids.chatId) ?? live.find((c) => c.sessionId === ids.sessionId);
  if (chat) send({ type: 'view', id: chat.id });
  else if (ids.sessionId) send({ type: 'open_session', sessionId: ids.sessionId });
  if (report) showTurn(report);
}

// Pause, resume, run now or stop a run (Android Hub.runControl). Stop offers Undo for goals and loops, which keep their state to restore.
export function runControl(run: ChatRun, op: RunOp, running = false) {
  send({ type: 'run', run: run.id, op });
  if (op !== 'stop') return;
  const restorable = run.kind === 'goal' || run.kind === 'loop';
  showSnack(stoppedText(run, running), restorable ? () => send({ type: 'run', run: run.id, op: 'restore' }) : undefined);
}

export const openGoal = (run?: string) => setUi({ goalSheet: run ? { mode: 'detail', run } : { mode: 'start' } });

// The start sheet, for a plan file or for this chat (Android GoalStartSheet callers track the same).
export function startGoal(opts: { plan?: string; here?: boolean } = {}) {
  if (opts.plan) track('action:runAsGoal');
  setUi({ goalSheet: { mode: 'start', ...opts } });
}

export const openRun = (run: ChatRun, report = run.rounds.at(-1)?.report) => openChat(run, report);
