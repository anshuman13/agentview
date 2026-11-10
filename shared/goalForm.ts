import { clock, span } from './util';

// What the start sheet collects: every in ms (0 for until done), the stop as ms from now or as HH:MM, the weekly cap in percent.
export type GoalForm = { what: string; every: number; stopIn: number | null; stopAt: string | null; capPct: number | null };

export function goalCommand(form: GoalForm, now: number) {
  const stop = form.stopAt ?? (form.stopIn ? clock(now + form.stopIn) : null);
  const what = form.what.trim().replace(/^\/goal\s+/, '');
  return ['/goal', form.every && `every ${span(form.every)}`, stop && `until ${stop}`, form.capPct && `cap ${form.capPct}%`, what].filter(Boolean).join(' ');
}

// The plan path of a goal that runs every task of a plan file, else null.
export const planOf = (what: string) => /^(?:\/goal\s+)?every task in (\S+) is ticked/.exec(what.trim())?.[1] ?? null;
