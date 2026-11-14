import type { ChatRun, RoundOutcome } from './protocol.js';
import { specHomeOrder, type SpecHomeItem } from './builds.js';
import { goalCommand } from './goalForm.js';
import { firstRound, roundText } from './goalText.js';

// Long-lived chats the user talks to about any project. Each lives in ~/.agentview/advisors/<id>, whose CLAUDE.md
// holds its role and imports projects.md (an index of the user's repos) and its memory.md, so a new conversation starts with what the earlier ones learned.
export type AdvisorId = 'pm' | 'architect' | 'designer';
export type Advisor = { id: AdvisorId; name: string; hint: string; model: string };

export const ADVISORS: Advisor[] = [
  { id: 'pm', name: 'PM', hint: 'What to build next and why', model: 'sonnet' },
  { id: 'architect', name: 'Architect', hint: 'How it fits the code, cost and risk', model: 'opus' },
  { id: 'designer', name: 'Designer', hint: 'Sketches screens before they are built', model: 'sonnet' },
];

// What the Advisors page shows of each: its memory and its latest conversations.
export type AdvisorInfo = { id: AdvisorId; memory: string; chats: { sessionId: string; title: string; lastModified: number }[] };

export const ADVISOR_DIR = '.agentview/advisors';

export const advisorOf = (cwd: string): Advisor | undefined => ADVISORS.find((a) => cwd.replace(/\/+$/, '').endsWith(`/${ADVISOR_DIR}/${a.id}`));

// The facts in a memory file: its list lines.
export const memoryFacts = (memory: string) => memory.split('\n').filter((l) => /^\s*[-*] /.test(l)).length;

// The project the Advisors page shows before one is picked: the open chat's repo, else the repo with the latest activity.
export const defaultAdvisorRoot = (openRoot: string | null, repos: { cwd: string; last: number }[]): string | null =>
  openRoot && repos.some((r) => r.cwd === openRoot) ? openRoot : repos.reduce<{ cwd: string; last: number } | null>((best, r) => (!best || r.last > best.last ? r : best), null)?.cwd ?? null;

// A project's .claude/backlog.md: one line per item, `<rank>. <slug> | <title> | <why> | <status>`, the PM's ranking of what to build next.
export type BacklogStatus = 'proposed' | 'specced' | 'building' | 'done';
export type BacklogItem = { rank: number; slug: string; title: string; why: string; status: BacklogStatus; spec: boolean };

const BACKLOG_LINE = /^(\d+)\.\s*([\w-]+)\s*\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|\s*(proposed|specced|building|done)\s*$/;

export const parseBacklog = (md: string): Omit<BacklogItem, 'spec'>[] =>
  md.split('\n').flatMap((l) => {
    const m = BACKLOG_LINE.exec(l.trim());
    return m ? [{ rank: Number(m[1]), slug: m[2], title: m[3], why: m[4], status: m[5] as BacklogStatus }] : [];
  });

// An item can be built until a build is running or merged.
export const canBuildItem = (i: Pick<BacklogItem, 'status'>) => i.status === 'proposed' || i.status === 'specced';

export const rankPrompt = (root: string) => `Read ${root}/.claude/backlog.md and the project's code and recent changes, then rank what to build next. Rewrite the backlog file (at most 10 lines) and reply with the top three.`;

export const specItemPrompt = (root: string, item: Pick<BacklogItem, 'slug' | 'title' | 'why'>) => `Write the spec for the backlog item "${item.title}" (${item.why}) to ${root}/.claude/specs/${item.slug}.md and mark its line specced in ${root}/.claude/backlog.md.`;

// Swaps a backlog line with its neighbour (an open line with the nearest open line that way, done lines between stay put) and renumbers the backlog lines 1 to n; null when the slug is not in the file.
export const moveBacklog = (md: string, slug: string, dir: 'up' | 'down'): string | null => {
  const lines = md.split('\n');
  const at = lines.flatMap((l, n) => (BACKLOG_LINE.test(l.trim()) ? [n] : []));
  const from = at.findIndex((n) => BACKLOG_LINE.exec(lines[n].trim())?.[2] === slug);
  if (from < 0) return null;
  const step = dir === 'up' ? -1 : 1;
  const done = (k: number) => BACKLOG_LINE.exec(lines[at[k]].trim())?.[5] === 'done';
  let to = from + step;
  if (!done(from)) while (to >= 0 && to < at.length && done(to)) to += step;
  if (to < 0 || to >= at.length) return md;
  [lines[at[from]], lines[at[to]]] = [lines[at[to]], lines[at[from]]];
  at.forEach((n, i) => { lines[n] = lines[n].replace(/^(\s*)\d+/, `$1${i + 1}`); });
  return lines.join('\n');
};

// A project's newest .claude/audits/<date>.md: one line per finding, `<rank>. <screen> | <problem> | <severity> | <fix>[ | fixed <slug> | open]`, the Designer's usability audit.
export type AuditSeverity = 'high' | 'med' | 'low';
export type AuditFinding = { rank: number; screen: string; problem: string; severity: AuditSeverity; fix: string; status: 'open' | 'fixed'; by: string };
export type Audit = { date: string; path: string; findings: AuditFinding[] };

const AUDIT_LINE = /^(\d+)\.\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(high|med|low)\s*\|\s*([^|]+?)\s*(?:\|\s*(.+?)\s*)?$/;

export const parseAudit = (md: string): AuditFinding[] =>
  md.split('\n').flatMap((l) => {
    const m = AUDIT_LINE.exec(l.trim());
    if (!m) return [];
    const fixed = /^fixed\s+(\S+)$/.exec(m[6] ?? '');
    const extra = m[6] && !fixed && m[6] !== 'open' ? ` | ${m[6]}` : '';
    return [{ rank: Number(m[1]), screen: m[2], problem: m[3], severity: m[4] as AuditSeverity, fix: m[5] + extra, status: fixed ? 'fixed' : 'open', by: fixed?.[1] ?? '' }];
  });

export const auditPrompt = (root: string) => `Audit the usability of the app in ${root}. If it has no running app, say so and write no file. Otherwise start it with the project's own start command, then walk each screen in headless Chrome on port 9334 (never 9333) at 390px wide, then at 1280px, and clean up the browser and the app when done. Write ${root}/.claude/audits/<YYYY-MM-DD>.md with today's date: at most 15 findings, ranked, one per line as \`<rank>. <screen> | <problem in one line> | <severity high|med|low> | <fix in one line>\`. Reply with the top three.`;

export const specsFromAuditPrompt = (root: string) => `Read the newest file in ${root}/.claude/audits and add its top findings to ${root}/.claude/backlog.md as \`proposed\` lines, with the audit line as the why. Skip findings marked fixed and ones a done backlog line names. A spec written from a finding has a line Fixes: <audit date> #<rank>, #<rank> under its title. Keep the existing lines, reread the file before you edit it and renumber the ranks. Reply with the lines you added.`;

const HOUR = 3_600_000;

export const ADVISOR_LOOP_EVERY = 4 * HOUR;
export const ADVISOR_LOOP_CAP = 70;
export const ADVISOR_LOOP_BUILDS = 5;

export const advisorLoopGoal = (root: string) => `Advisor loop for ${root}, never met on its own. Each round, as PM: reread ${root}/.claude/backlog.md. If fewer than 2 items are specced, write the spec for the top proposed item to ${root}/.claude/specs/<slug>.md and mark it specced; for a UI change ask the Designer advisor for a sketch, and say in the ROUND line if you cannot reach it. If a spec awaits my approval, end with ROUND: question <what needs approval>. Once I approve, start the build (/agentview:build <slug>, the build card's Build action) and mark the item building; one build in flight per project; mark it done when merged, and if its spec has a Fixes: line ask the Designer advisor to recheck those findings, and say in the ROUND line if you cannot reach it. A claimed finding the Designer leaves open goes back to proposed, keeping its slug: next round move that line from done back to proposed and note the finding in the why. If the backlog is empty, ask the Designer for an audit when the newest ${root}/.claude/audits/*.md is over 7 days old, else end with ROUND: nothing.`;

export const advisorLoopCommand = (root: string, now: number) =>
  goalCommand({ what: advisorLoopGoal(root), every: ADVISOR_LOOP_EVERY, stopIn: null, stopAt: null, capPct: ADVISOR_LOOP_CAP, builds: ADVISOR_LOOP_BUILDS }, now);

// The running or paused goal that is the Advisor loop of a project: the newest one started with advisorLoopGoal(root).
export const advisorLoopOf = (runs: ChatRun[], root: string): ChatRun | undefined => {
  const head = `Advisor loop for ${root.replace(/\/+$/, '')},`;
  return runs.filter((r) => r.kind === 'goal' && r.state !== 'done' && r.what.startsWith(head)).sort((a, b) => b.startedAt - a.startedAt)[0];
};

export const advisorLoopLine = (run: ChatRun): string => {
  const last = run.rounds.at(-1);
  if (run.state === 'paused') return run.why ? `Paused · ${run.why}` : 'Paused';
  if (!last) return run.nextAt ? firstRound(run.nextAt) : 'Waiting for its first round';
  return last.report ? 'Weekly report' : roundText(last);
};

export const advisorLoopBuilds = (run: Pick<ChatRun, 'builds' | 'maxBuilds'>): string =>
  run.maxBuilds ? `Builds ${run.builds ?? 0} of ${run.maxBuilds}` : '';

export const auditCountLine = (findings: { status: string }[]): string => {
  if (!findings.length) return 'No findings';
  const open = findings.filter((f) => f.status !== 'fixed').length;
  return open === findings.length ? `${open} open` : `${open} open of ${findings.length}`;
};

const NEEDS_YOU: RoundOutcome[] = ['blocked', 'question', 'failed'];
export const runNeedsYou = (run: ChatRun) => {
  const last = run.rounds.at(-1)?.outcome;
  return run.needsYou || (!!last && NEEDS_YOU.includes(last));
};

export type BoardStage = 'ideas' | 'specced' | 'building' | 'done';
export const BOARD_STAGES: BoardStage[] = ['ideas', 'specced', 'building', 'done'];
export type BoardAction = 'spec-it' | 'approve' | 'open-chat' | 'sketch' | 'build';
export type BoardCard = { slug: string; action: BoardAction | null; needsYou: boolean; item?: BacklogItem; spec?: SpecHomeItem };

const specNeedsYou = (s: SpecHomeItem) => s.waiting || s.hold || s.state === 'waiting';

const stageOf = (item?: BacklogItem, spec?: SpecHomeItem): BoardStage | null =>
  spec?.pipeline === 'merged' || item?.status === 'done' ? 'done'
    : spec?.built || item?.status === 'building' ? 'building'
      : spec || item?.status === 'specced' ? 'specced'
        : item?.status === 'proposed' ? 'ideas' : null;

const actionOf = (stage: BoardStage, spec?: SpecHomeItem): BoardAction | null => {
  if (stage === 'ideas') return 'spec-it';
  if (stage === 'done') return null;
  const chat = (a: 'approve' | 'open-chat') => (spec?.chat || spec?.session ? a : null);
  if (stage === 'building') return spec ? chat('open-chat') : null;
  if (!spec) return 'build';
  if (spec.waiting) return chat('approve');
  if (spec.hold || ['running', 'failed', 'waiting'].includes(spec.state)) return chat('open-chat');
  return spec.sketched ? 'build' : 'sketch';
};

// The Advisors board: a project's backlog lines joined to the specs with the same slug, placed in the stage of the path from idea to merged build, with the one action each card offers.
export const advisorBoard = (backlog: BacklogItem[], specs: SpecHomeItem[], loopNeedsYou: boolean) => {
  const stages: Record<BoardStage, BoardCard[]> = { ideas: [], specced: [], building: [], done: [] };
  const specOf = new Map(specs.map((s) => [s.slug, s]));
  const card = (stage: BoardStage, slug: string, item?: BacklogItem, spec?: SpecHomeItem): BoardCard => ({ slug, action: actionOf(stage, spec), needsYou: stage !== 'done' && !!spec && specNeedsYou(spec), item, spec });
  const lines = [...backlog].sort((a, b) => a.rank - b.rank).flatMap((item) => {
    const spec = specOf.get(item.slug);
    const stage = stageOf(item, spec);
    return stage ? [{ stage, item, spec }] : [];
  });
  const itemOf = new Map(backlog.map((i) => [i.slug, i]));
  for (const stage of ['ideas', 'specced'] as const) {
    for (const l of lines) if (l.stage === stage) stages[stage].push(card(stage, l.item.slug, l.item, l.spec));
  }
  const ordered = specHomeOrder(specs).map((s) => ({ spec: s, item: itemOf.get(s.slug), stage: stageOf(itemOf.get(s.slug), s)! }));
  for (const o of ordered) if (!o.item && o.stage === 'specced') stages.specced.push(card(o.stage, o.spec.slug, undefined, o.spec));
  for (const o of ordered) if (o.stage === 'building' || o.stage === 'done') stages[o.stage].push(card(o.stage, o.spec.slug, o.item, o.spec));
  for (const l of lines) if (!l.spec && (l.stage === 'building' || l.stage === 'done')) stages[l.stage].push(card(l.stage, l.item.slug, l.item));
  const defaultStage = BOARD_STAGES.find((st) => stages[st].some((c) => c.needsYou) || (st === 'building' && loopNeedsYou)) ?? BOARD_STAGES.find((st) => stages[st].length) ?? 'ideas';
  return { stages, defaultStage };
};
