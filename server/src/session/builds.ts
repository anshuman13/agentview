import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildStageOf, buildSummary, criteriaOf, findingsOf, verdictOf, type BuildCommit, type BuildEntry, type BuildStage } from '../../../shared/builds.js';
import type { ChatEvent } from '../../../shared/protocol.js';
import { jsonFile, readJson } from '../json.js';
import { MAX_BRANCH_DIFF, defaultBase, git, parseNumstat } from '../workspace/git.js';
import { mainCheckout } from '../workspace/tries.js';
import type { AgentSession } from './session.js';

const MAX_REPORT = 20_000;

const buildsDir = (repo: string) => path.join(process.env.AGENTVIEW_BUILDS ?? path.join(os.homedir(), '.agentview', 'builds'), encodeURIComponent(repo));

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

type Snap = { id: string; stage: BuildStage; slug: string; round: number | null; status: BuildEntry['status']; startedAt: number; endedAt: number | null; report?: string; chat: string; session: string | null; cwd: string };

async function write(s: Snap) {
  const repo = await mainCheckout(s.cwd);
  await jsonFile<BuildEntry[]>(path.join(buildsDir(repo), `${s.slug}.json`), []).update(async (cur) => {
    const old = cur.find((e) => e.id === s.id);
    const report = s.report ?? old?.report ?? '';
    const commit = s.stage !== 'implement' ? undefined : old?.commit && old.report === report ? old.commit : report ? await commitIn(repo, report) : undefined;
    const entry: BuildEntry = {
      id: s.id, stage: s.stage, round: old?.round ?? s.round ?? cur.filter((e) => e.stage === s.stage).length + 1,
      status: s.status, startedAt: s.startedAt, endedAt: s.endedAt, report, chat: s.chat, session: s.session, ...(commit && { commit }),
    };
    return old ? cur.map((e) => (e === old ? entry : e)) : [...cur, entry];
  });
}

// Records run in the order they were emitted, so a hand-back's second emit never lands before its first.
let queue: Promise<unknown> = Promise.resolve();

// A build agent's start, end or report, from the event the chat emits.
export function recordBuild(session: AgentSession, ev: ChatEvent) {
  const agent = ev.kind === 'agent' ? ev : ev.kind === 'tool_result' ? session.log.agent(ev.toolUseId) : undefined;
  const target = agent && buildStageOf(agent.subagentType, agent.description, agent.prompt);
  if (!agent || !target) return;
  const report = ev.kind === 'tool_result' && agent.status !== 'running' ? ev.text.slice(0, MAX_REPORT) : undefined;
  const snap: Snap = { ...target, id: agent.toolUseId, status: agent.status, startedAt: agent.startedAt, endedAt: agent.endedAt, report, chat: session.id, session: session.state.session.sessionId, cwd: session.cwd };
  queue = queue.then(() => write(snap)).catch(() => {});
}

const SLUG = /^[\w.-]+$/;

const readEntries = (repo: string, slug: string) => readJson<BuildEntry[]>(path.join(buildsDir(repo), `${slug}.json`), []);

const specOf = (repo: string, slug: string) => readFile(path.join(repo, '.claude', 'specs', `${slug}.md`), 'utf8').catch(() => null);

const titleOf = (spec: string | null, slug: string) => /^# (.+)$/m.exec(spec ?? '')?.[1].trim() || slug;

const lastCommit = (entries: BuildEntry[]) => entries.filter((e) => e.stage === 'implement').at(-1)?.commit;

// The default branch holds a commit with this subject made after the build's commit: the build was cherry-picked or merged.
async function merged(repo: string, commit: BuildCommit | undefined) {
  if (!commit) return false;
  const base = (await defaultBase(repo)).replace(/^origin\//, '');
  const log = await git(repo, ['log', base, '--fixed-strings', `--grep=${commit.subject}`, '--format=%ct%x09%s']).catch(() => '');
  return log.split('\n').some((l) => Number(l.split('\t')[0]) * 1000 > commit.date && l.split('\t').slice(1).join('\t') === commit.subject);
}

export async function listBuilds(cwd: string) {
  const repo = await mainCheckout(cwd).catch(() => null);
  if (!repo) return [];
  const dir = buildsDir(repo);
  const slugs = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  const builds = await Promise.all(slugs.map(async (slug) => {
    const entries = await readEntries(repo, slug);
    const title = titleOf(await specOf(repo, slug), slug);
    return { slug, title, ...buildSummary(entries, await merged(repo, lastCommit(entries))), updatedAt: Math.max(0, ...entries.map((e) => e.endedAt ?? e.startedAt)) };
  }));
  return builds.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function buildOne(cwd: string, slug: string) {
  const repo = await mainCheckout(cwd);
  const entries = SLUG.test(slug) && !slug.includes('..') ? await readEntries(repo, slug) : [];
  if (!entries.length) return { status: 404, body: { error: 'No such build' } };
  const spec = await specOf(repo, slug);
  const commit = lastCommit(entries);
  const [numstat, diff] = commit ? await Promise.all([git(repo, ['show', '--numstat', '--format=', commit.sha]), git(repo, ['show', '--format=', commit.sha])]).catch(() => ['', '']) : ['', ''];
  return {
    slug,
    title: titleOf(spec, slug),
    summary: buildSummary(entries, await merged(repo, commit)),
    spec,
    entries: entries.map((e) => ({ ...e, verdict: verdictOf(e.report), criteria: criteriaOf(e.report), findings: findingsOf(e.report) })),
    commit: commit ? { files: parseNumstat(numstat), diff: diff.length > MAX_BRANCH_DIFF ? '' : diff } : null,
  };
}
