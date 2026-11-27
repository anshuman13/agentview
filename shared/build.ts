import { isSpecPath, specPrompt } from './specTasks.js';

export const BUILD_COMMAND = { name: 'build', description: 'Build a request or spec task by task: [auto] [until HH:MM] <request or spec path>' };

export const BUILD_USAGE = 'Usage: /build [auto] [until HH:MM] <request or .claude/specs/<slug>.md>. Without auto it waits for Build all after the spec and for you when a task is blocked; with until it finds more work for the goal until that time. /build until HH:MM alone moves the stop time of a running build.';

export const BUILD_CAP_PCT = 60;

export type BuildArgs = { auto: boolean; until: string | null; spec: string | null; request: string };

// `/build [auto] [until HH:MM] <request or spec path>`; 'usage' when nothing follows, null for any other text.
export function parseBuild(text: string): BuildArgs | 'usage' | null {
  const m = /^\/build(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return null;
  let rest = (m[1] ?? '').trim();
  let auto = false;
  let until: string | null = null;
  for (;;) {
    const a = /^auto\b\s*/i.exec(rest);
    const u = /^until\s+(\d{1,2}):(\d{2})\b\s*/i.exec(rest);
    if (a) { auto = true; rest = rest.slice(a[0].length); }
    else if (u && +u[1] < 24 && +u[2] < 60) { until = `${u[1].padStart(2, '0')}:${u[2]}`; rest = rest.slice(u[0].length); }
    else break;
  }
  if (!rest) return until && !auto ? { auto, until, spec: null, request: '' } : 'usage';
  const spec = !/\s/.test(rest) && isSpecPath(rest) ? rest : null;
  return { auto, until, spec, request: spec ? '' : rest };
}

// The next time the clock shows hh:mm, today or tomorrow.
export function untilAt(hhmm: string, now = Date.now()) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export const hhmm = (t: number) => new Date(t).toTimeString().slice(0, 5);

export const notesPath = (spec: string) => spec.replace(/\.(md|markdown|mdx)$/i, '.notes.md');

export const buildSpecPrompt = (request: string) => `${specPrompt(request)}\n\nStart the spec with a "Goal:" line saying what done looks like.`;

export function taskBrief(spec: string, n: number, of: number, auto: boolean) {
  const notes = notesPath(spec);
  const stuck = auto
    ? 'If you cannot finish it, change its box to [~] with the reason after the task, add that to the notes, and finish with ROUND: blocked.'
    : 'If you cannot finish it or need a decision from me, say what you need and finish with ROUND: blocked or ROUND: question.';
  return `Build run, task ${n} of ${of}. Read ${spec} and ${notes} if it exists, then do only the first unchecked task: make the change, run this repo's checks, and commit without pushing. Then tick its box in the spec and add 2 to 4 lines to ${notes}: what changed, the commit, and what the next task needs to know. ${stuck}`;
}

export const moreBrief = (spec: string, until: number) =>
  `Build run: every task in ${spec} is done and there is time until ${hhmm(until)}. Read the spec's goal and ${notesPath(spec)}, check what was built, and find more work that serves the goal: bugs, rough edges, missing pieces, next steps. Add 1 to 3 new "- [ ]" tasks at the end of the Tasks section and stop without building them. If nothing worthwhile is left, add none and say so.`;

export const recapBrief = (spec: string, why: string) =>
  `Build run finished: ${why}. Read ${spec} and ${notesPath(spec)} and write a short recap: what was built with its commits, what was skipped and why, and anything I must decide, such as whether to push. Do not change any code.`;

export type BuildStep =
  | { kind: 'task' }
  | { kind: 'more' }
  | { kind: 'recap'; why: string }
  | { kind: 'pause'; why: string };

export const PAUSED_BY_YOU = 'Paused by you';
export const BLOCKED = 'Needs you: a task is blocked';
export const APPROVE = 'Approve the spec: Build all';
export const FAILED = 'The last turn failed';

// What a build run does after a turn of its task phase.
export function nextStep(o: { pausing: boolean; asked: boolean; failed: boolean; auto: boolean; open: number; until: number | null; idle: number; weekPct: number | null; now: number }): BuildStep {
  if (o.pausing) return { kind: 'pause', why: PAUSED_BY_YOU };
  if (o.failed) return { kind: 'pause', why: FAILED };
  if (o.asked && !o.auto) return { kind: 'pause', why: BLOCKED };
  if (o.weekPct !== null && o.weekPct >= BUILD_CAP_PCT) return { kind: 'recap', why: `weekly usage reached ${o.weekPct}%` };
  if (o.until !== null && o.now >= o.until) return { kind: 'recap', why: `reached ${hhmm(o.until)}` };
  if (o.open > 0) return { kind: 'task' };
  if (o.until !== null && o.idle < 2) return { kind: 'more' };
  return { kind: 'recap', why: 'all tasks done' };
}
