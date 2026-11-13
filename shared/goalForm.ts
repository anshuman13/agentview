import { clock, span } from './util.js';

// What the start sheet collects: every in ms (0 for until done), the stop as ms from now or as HH:MM, the weekly cap in percent, the builds limit.
export type GoalForm = { what: string; every: number; stopIn: number | null; stopAt: string | null; capPct: number | null; builds: number | null };

export function goalCommand(form: GoalForm, now: number) {
  const stop = form.stopAt ?? (form.stopIn ? clock(now + form.stopIn) : null);
  const what = form.what.trim().replace(/^\/goal\s+/, '');
  return ['/goal', form.every && `every ${span(form.every)}`, stop && `until ${stop}`, form.capPct && `cap ${form.capPct}%`, form.builds && `builds ${form.builds}`, what].filter(Boolean).join(' ');
}

// A standing goal checks at most every 10 minutes and at least once a week.
export const MIN_EVERY = 10 * 60_000;
export const MAX_EVERY = 7 * 24 * 3_600_000;

// A custom How often such as "45m", "45 min" or "3h", in ms; null when it is not one or out of range.
export function parseEvery(text: string) {
  const m = /^(\d+)\s*(m|min|h)$/i.exec(text.trim());
  const ms = m ? Number(m[1]) * (m[2].toLowerCase() === 'h' ? 3_600_000 : 60_000) : 0;
  return ms >= MIN_EVERY && ms <= MAX_EVERY ? ms : null;
}

// The plan path of a goal that runs every task of a plan file, else null.
export const planOf = (what: string) => /^(?:\/goal\s+)?(?:every task in (\S+) is ticked|every step of the plan in (\S+) is done)/.exec(what.trim())?.slice(1).find(Boolean) ?? null;
