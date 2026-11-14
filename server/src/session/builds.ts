import { appendFile, readFile, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { REVIEW_PHASES, buildStageOf, isReviewPhase, buildSummary, criteriaOf, findingsOf, flowOf, inOrder, isHeld, lastCommit, pipelineOf, reviewDecision, reviewLine, sectionsOf, slugOk, specCriteria, verdictOf, type BuildCommit, type BuildEntry, type BuildPhase, type BuildReview, type BuildStage, type BuildSummary, type SpecHomeItem, type ReviewPhase, type SpecCriterion, type SpecPhase } from '../../../shared/builds.js';
import type { ChatEvent } from '../../../shared/protocol.js';
import { jsonFile, readJson } from '../json.js';
import { MAX_BRANCH_DIFF, defaultBase, git, parseNumstat } from '../workspace/git.js';
import { mainCheckout } from '../workspace/tries.js';
import type { AgentSession } from './session.js';

const MAX_REPORT = 20_000;
const MAX_NOTE = 2000;

export const buildsRoot = () => process.env.AGENTVIEW_BUILDS ?? path.join(os.homedir(), '.agentview', 'builds');

const buildsDir = (repo: string) => path.join(buildsRoot(), encodeURIComponent(repo));

// The first 7 to 40 char hex token of a report that is a commit of the repo, with what the commit changed.
async function commitIn(repo: string, report: string): Promise<BuildCommit | undefined> {
  for (const token of report.match(/\b[0-9a-f]{7,40}\b/g) ?? []) {
    if ((await git(repo, ['cat-file', '-t', token]).catch(() => '')).trim() !== 'commit') continue;
    const [info, numstat, refs] = await Promise.all([
      git(repo, ['show', '-s', '--format=%H%x09%ct%x09%s', token]),
      git(repo, ['show', '--numstat', '--format=', token]),
      git(repo, ['for-each-ref', '--points-at', token, '--format=%(refname:short)']),
    ]);
    const [sha, date, ...subject] = info.trim().split('\t');
    return { sha, subject: subject.join('\t'), date: Number(date) * 1000, branch: refs.split('\n')[0] || null, files: parseNumstat(numstat).map((f) => ({ path: f.path, additions: f.add, deletions: f.del })) };
  }
}

type Snap = { id: string; tokens?: number; stage: BuildStage; slug: string; round: number | null; status: BuildEntry['status']; startedAt: number; endedAt: number | null; report?: string; chat: string; session: string | null; cwd: string };

async function write(s: Snap) {
  const repo = await mainCheckout(s.cwd);
  await jsonFile<BuildEntry[]>(path.join(buildsDir(repo), `${s.slug}.json`), []).update(async (cur) => {
    const old = cur.find((e) => e.id === s.id);
    const report = s.report ?? old?.report ?? '';
    const tokens = s.tokens ?? old?.tokens;
    if (old && old.status === s.status && old.endedAt === s.endedAt && old.report === report && old.tokens === tokens) return cur;
    const commit = s.stage !== 'implement' ? undefined : old?.commit && old.report === report ? old.commit : report ? await commitIn(repo, report) : undefined;
    const entry: BuildEntry = {
      id: s.id, stage: s.stage, round: old?.round ?? s.round ?? cur.filter((e) => e.stage === s.stage).length + 1,
      status: s.status, startedAt: s.startedAt, endedAt: s.endedAt, report, chat: s.chat, session: s.session, ...(commit && { commit }), ...(tokens !== undefined && { tokens }),
    };
    return old ? cur.map((e) => (e === old ? entry : e)) : [...cur, entry];
  });
}

// Records run in the order they were emitted, so a hand-back's second emit never lands before its first.
let queue: Promise<unknown> = Promise.resolve();
// A running agent re-emits its event on every progress tick, and a history load replays every event; only a change is worth a write.
const lastStatus = new Map<string, string>();

// A build agent's start, end or report, from the event the chat emits.
export function recordBuild(session: AgentSession, ev: ChatEvent, agentOf = (id: string) => session.log.agent(id)) {
  const agent = ev.kind === 'agent' ? ev : ev.kind === 'tool_result' ? agentOf(ev.toolUseId) : undefined;
  const target = agent && buildStageOf(agent.subagentType, agent.description, agent.prompt);
  if (!agent || !target) return;
  const report = ev.kind === 'tool_result' && agent.status !== 'running' ? ev.text.slice(0, MAX_REPORT) : undefined;
  const key = `${agent.toolUseId}:${ev.kind}`;
  const tokens = agent.status === 'running' ? undefined : agent.usage?.tokens;
  const seen = `${agent.status}:${report?.length ?? ''}:${tokens ?? ''}`;
  if (lastStatus.get(key) === seen) return;
  lastStatus.set(key, seen);
  const snap: Snap = { ...target, id: agent.toolUseId, tokens, status: agent.status, startedAt: agent.startedAt, endedAt: agent.endedAt, report, chat: session.id, session: session.state.session.sessionId, cwd: session.cwd };
  queue = queue.then(() => write(snap)).catch(() => {});
}

// Records the build agents of a loaded history and of its unshown runs, so a record a restart, a compaction or a missed live event left behind catches up.
export function recordHistory(session: AgentSession, unshown: ChatEvent[] = []) {
  for (const ev of session.state.events) if (ev.kind === 'agent' || ev.kind === 'tool_result') recordBuild(session, ev);
  const agents = new Map(unshown.flatMap((e) => (e.kind === 'agent' ? [[e.toolUseId, e] as const] : [])));
  for (const ev of unshown) if (ev.kind === 'agent' || ev.kind === 'tool_result') recordBuild(session, ev, (id) => agents.get(id));
}

const SLUG = /^\w[\w.-]*$/;

const slugValid = (slug: string) => SLUG.test(slug) && slugOk(slug);

const readEntries = (repo: string, slug: string) => readJson<BuildEntry[]>(path.join(buildsDir(repo), `${slug}.json`), []);

const reviewsPath = (repo: string, slug: string) => path.join(buildsDir(repo), `${slug}.reviews.json`);

const readReviews = (repo: string, slug: string) => readJson<BuildReview[]>(reviewsPath(repo, slug), []);

// jsonFile serialises writes per instance, so every write to one file goes through the same one.
const reviewStores = new Map<string, ReturnType<typeof jsonFile<BuildReview[]>>>();

const reviewStore = (repo: string, slug: string) => {
  const file = reviewsPath(repo, slug);
  if (!reviewStores.has(file)) reviewStores.set(file, jsonFile<BuildReview[]>(file, []));
  return reviewStores.get(file)!;
};

const titleOf = (spec: string | null, slug: string) => /^# (.+)$/m.exec(spec ?? '')?.[1].trim() || slug;

const PHASE_OF = new Map<string, SpecPhase>([
  ['problem', 'requirements'], ['behaviour', 'requirements'], ['requirements', 'requirements'], ['non-goals', 'requirements'],
  ['design', 'design'], ['touches', 'design'], ['open questions', 'design'],
  ['tasks', 'tasks'], ['acceptance criteria', 'tasks'],
]);
const NOTES = 'review notes';

export function splitPhases(markdown: string): BuildPhase[] {
  const lines: Record<SpecPhase, string[]> = { requirements: [], design: [], tasks: [] };
  let phase: SpecPhase | null = 'requirements';
  for (const s of sectionsOf(markdown)) {
    if (s.heading !== null) phase = s.heading === NOTES ? null : PHASE_OF.get(s.heading) ?? phase;
    if (phase) lines[phase].push(...s.lines);
  }
  return REVIEW_PHASES.map((key) => ({ key, markdown: lines[key].join('\n').trim() })).filter((p) => p.markdown);
}

const withoutNotes = (markdown: string) => sectionsOf(markdown).filter((s) => s.heading !== NOTES).flatMap((s) => s.lines).join('\n').trim();

const MAX_SKETCH = 1_000_000;

// The build's sketch, written by the designer from the spec, is one more phase to approve; its HTML is the phase text.
async function readSketch(repo: string, slug: string) {
  const file = path.join(repo, '.claude', 'sketches', `${slug}.html`);
  const st = await stat(file).catch(() => null);
  return st?.isFile() && st.size <= MAX_SKETCH ? readFile(file, 'utf8').catch(() => null) : null;
}

type Spec = { title: string; phases: BuildPhase[]; mtime: number; file: string; kiro: boolean };

// A spec file in .claude/specs, else a Kiro folder in .kiro/specs with one file per phase.
async function loadSpec(repo: string, slug: string): Promise<Spec | null> {
  const file = path.join(repo, '.claude', 'specs', `${slug}.md`);
  const text = await readFile(file, 'utf8').catch(() => null);
  if (text !== null) {
    const sketch = await readSketch(repo, slug);
    const phases = [...splitPhases(text), ...(sketch ? [{ key: 'sketch' as const, markdown: sketch }] : [])];
    return { title: titleOf(text, slug), phases, mtime: Math.round((await stat(file)).mtimeMs), file, kiro: false };
  }
  const parts = await Promise.all(REVIEW_PHASES.map(async (key) => {
    const f = path.join(repo, '.kiro', 'specs', slug, `${key}.md`);
    const [body, st] = await Promise.all([readFile(f, 'utf8').catch(() => null), stat(f).catch(() => null)]);
    return { key, file: f, body, mtime: Math.round(st?.mtimeMs ?? 0) };
  }));
  const first = parts.find((p) => p.body !== null);
  if (!first) return null;
  const phases = parts.flatMap((p) => (p.body === null ? [] : [{ key: p.key, markdown: withoutNotes(p.body) }])).filter((p) => p.markdown);
  return { title: titleOf(parts[0].body, slug), phases, mtime: Math.max(...parts.map((p) => p.mtime)), file: first.file, kiro: true };
}

const DRAFT: BuildSummary = { stage: 'pm', state: 'done', conclusion: 'Not started' };

const mergedCache = new Map<string, { tip: string; done: Map<string, string | false> }>();

// The default branch holds a commit with this subject made after the build's commit: the build was cherry-picked or merged.
// Answers are kept per repo while the default branch stays at the same commit, so a new commit on it drops them.
async function mergedIn(repo: string) {
  const base = (await defaultBase(repo)).replace(/^origin\//, '');
  const tip = await git(repo, ['rev-parse', base]).catch(() => '');
  let cache = mergedCache.get(repo);
  if (!cache || cache.tip !== tip) mergedCache.set(repo, (cache = { tip, done: new Map() }));
  const { done } = cache;
  return async (commit: BuildCommit | undefined) => {
    if (!commit) return false as const;
    const known = done.get(commit.sha);
    if (known !== undefined) return known;
    const log = await git(repo, ['log', base, '--fixed-strings', `--grep=${commit.subject}`, '--format=%H%x09%ct%x09%s']).catch(() => '');
    const hit = log.split('\n').map((l) => l.split('\t')).find(([, ct, ...s]) => Number(ct) * 1000 > commit.date && s.join('\t') === commit.subject);
    const result = hit ? hit[0] : false;
    if (tip) done.set(commit.sha, result);
    return result;
  };
}

// The spec's acceptance criteria with the latest test report's result for each; test lines the spec does not list come last.
function criteriaFor(spec: Spec | null, entries: BuildEntry[]): SpecCriterion[] {
  const tasks = spec && !spec.kiro ? spec.phases.find((p) => p.key === 'tasks') : undefined;
  if (!tasks) return [];
  const test = inOrder(entries).filter((e) => e.stage === 'test' && e.report.trim()).at(-1);
  const lines = new Map((test ? criteriaOf(test.report) : []).reverse().map((c) => [c.n, c]));
  const listed = specCriteria(tasks.markdown).map((c) => ({ ...c, result: lines.get(c.n)?.result ?? 'pending', evidence: lines.get(c.n)?.evidence ?? '' }));
  const extra = [...lines.values()].filter((c) => !listed.some((l) => l.n === c.n)).sort((a, b) => a.n - b.n);
  return [...listed, ...extra.map((c) => ({ ...c, text: `Criterion ${c.n}`, ui: false }))];
}

export async function buildOne(cwd: string, slug: string) {
  const repo = await mainCheckout(cwd).catch(() => null);
  const [entries, reviews, spec] = repo && slugValid(slug) ? await Promise.all([readEntries(repo, slug), readReviews(repo, slug), loadSpec(repo, slug)]) : [[], [], null];
  if (!repo || (!entries.length && !spec)) return { status: 404, body: { error: 'No such build' } };
  const commit = lastCommit(entries);
  const done = await (await mergedIn(repo))(commit);
  const [numstat, diff] = commit ? await Promise.all([git(repo, ['show', '--numstat', '--format=', commit.sha]), git(repo, ['show', '--format=', commit.sha])]).catch(() => ['', '']) : ['', ''];
  return {
    slug,
    title: spec?.title ?? slug,
    summary: entries.length ? buildSummary(entries, done) : DRAFT,
    pipeline: pipelineOf(entries, done, reviews),
    updatedAt: Math.max(spec?.mtime ?? 0, ...entries.map((e) => e.endedAt ?? e.startedAt)),
    specFile: spec && !spec.kiro ? `.claude/specs/${slug}.md` : null,
    phases: spec?.phases ?? [],
    criteria: criteriaFor(spec, entries),
    flow: flowOf(entries, reviews, spec?.phases ?? [], done),
    reviews,
    hold: isHeld(reviews),
    codeReview: reviewDecision(reviews, 'code') ?? null,
    entries: entries.map((e) => ({ ...e, verdict: verdictOf(e.report), criteria: criteriaOf(e.report), findings: findingsOf(e.report) })),
    commit: commit ? { files: parseNumstat(numstat), diff: diff.length > MAX_BRANCH_DIFF ? '' : diff } : null,
  };
}

const MAX_LISTED = 20;

// The newest specs of the project's main checkout with where each build stands, without the commit diff.
export async function buildList(cwd: string): Promise<SpecHomeItem[]> {
  const repo = await mainCheckout(cwd).catch(() => null);
  if (!repo) return [];
  const dir = path.join(repo, '.claude', 'specs');
  const names = (await readdir(dir).catch(() => [])).filter((n) => n.endsWith('.md') && slugValid(n.slice(0, -3)));
  const stats = await Promise.all(names.map(async (n) => ({ slug: n.slice(0, -3), mtime: (await stat(path.join(dir, n)).catch(() => null))?.mtimeMs ?? 0 })));
  const newest = stats.sort((a, b) => b.mtime - a.mtime).slice(0, MAX_LISTED);
  const merged = await mergedIn(repo);
  return Promise.all(newest.map(async ({ slug }) => {
    const [entries, reviews, spec] = await Promise.all([readEntries(repo, slug), readReviews(repo, slug), loadSpec(repo, slug)]);
    const done = await merged(lastCommit(entries));
    const newestEntry = inOrder(entries).at(-1);
    const summary = entries.length ? buildSummary(entries, done) : DRAFT;
    return {
      slug,
      title: spec?.title ?? slug,
      pipeline: pipelineOf(entries, done, reviews),
      state: summary.state,
      conclusion: summary.conclusion,
      updatedAt: Math.max(spec?.mtime ?? 0, ...entries.map((e) => e.endedAt ?? e.startedAt)),
      hold: isHeld(reviews),
      waiting: flowOf(entries, reviews, spec?.phases ?? [], done).some((f) => f.key === 'approval' && f.state === 'waiting'),
      chat: newestEntry?.chat ?? null,
      session: newestEntry?.session ?? null,
      built: entries.some((e) => e.stage === 'implement'),
    };
  }));
}

const unapproved = (spec: Spec, reviews: BuildReview[]) => spec.phases.filter((p) => reviewDecision(reviews, p.key)?.decision !== 'approve');

// The title and first sentence of the Problem section of a spec that still has phases to approve, else null.
export async function approvalOf(cwd: string, slug: string) {
  const repo = await mainCheckout(cwd).catch(() => null);
  if (!repo || !slugValid(slug)) return null;
  const [spec, reviews] = await Promise.all([loadSpec(repo, slug), readReviews(repo, slug)]);
  if (!spec || isHeld(reviews) || !unapproved(spec, reviews).length) return null;
  const problem = sectionsOf(spec.phases.find((p) => p.key === 'requirements')?.markdown ?? '').find((s) => s.heading === 'problem')?.lines.slice(1).join('\n').trim();
  return { title: spec.title, body: problem?.split(/(?<=[.!?])\s|\n/)[0].slice(0, 200) || `Spec ${slug} is ready` };
}

const ignored = (repo: string, file: string) => git(repo, ['check-ignore', '-q', '--', file]).then(() => true, () => false);

const two = (n: number) => String(n).padStart(2, '0');

// One line at the end of the spec file, appended without reading it back for a rewrite so an agent editing it at the same time loses nothing.
async function appendNote(file: string, r: BuildReview) {
  const text = await readFile(file, 'utf8');
  const d = new Date(r.at);
  const lead = sectionsOf(text).some((s) => s.heading === NOTES) ? (text.endsWith('\n') ? '' : '\n') : '\n## Review notes\n';
  const when = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
  await appendFile(file, `${lead}- ${when} ${reviewLine(r)}\n`);
}

const isPhase = (v: unknown): v is ReviewPhase | 'code' => v === 'code' || isReviewPhase(v);

// The user's decision on one phase of a spec or its code, or a hold or release: the JSON record the UI reads, and for a git-ignored spec file also the line agents read.
// Phase `all` approves every phase of the spec not yet approved, never the code.
export async function reviewBuild(cwd: string, body: { slug?: unknown; phase?: unknown; decision?: unknown; note?: unknown }) {
  const { slug, phase, decision } = body;
  const note = typeof body.note === 'string' ? body.note.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE) : '';
  const at = Date.now();
  const all = phase === 'all' && decision === 'approve';
  const review: BuildReview | null =
    all ? { phase: 'requirements', decision, note: '', at }
    : phase === undefined && (decision === 'hold' || decision === 'release') ? { phase: 'hold', decision, note: '', at }
    : isPhase(phase) && (decision === 'approve' || (decision === 'changes' && note)) ? { phase, decision, note, at }
    : null;
  if (typeof slug !== 'string' || !slugValid(slug) || !review) return { status: 400, body: { error: 'Bad review' } };
  const repo = await mainCheckout(cwd).catch(() => null);
  const spec = repo && (await loadSpec(repo, slug));
  if (!repo || !spec) return { status: 404, body: { error: 'No such spec' } };
  if (review.phase === 'code' && !(await readEntries(repo, slug)).some((e) => e.stage === 'implement')) return { status: 400, body: { error: 'No implementation to review' } };
  let held = false;
  let added = 0;
  await reviewStore(repo, slug).update(async (cur) => {
    held = all && isHeld(cur);
    const adds = held ? [] : all ? unapproved(spec, cur).map((p) => ({ ...review, phase: p.key })) : [review];
    added = adds.length;
    if (!adds.length) return cur;
    if (await ignored(repo, spec.file)) for (const r of adds) await appendNote(spec.file, r);
    return [...cur, ...adds];
  });
  if (held) return { status: 400, body: { error: 'Held' } };
  return { ok: true, ...(all && !added && { already: true }) };
}
