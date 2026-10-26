import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { ATTENTION_LABEL, type AttentionItem, type AttentionKind, type DeployStatus, type GitStatus, type PullRequest } from '../../../shared/protocol.js';
import { listIssues, listPrs, type Issue } from './github.js';
import { gitStatus } from '../workspace/git.js';
import { deployWatch } from './deploy.js';
import { post } from './notify.js';

const FILE = path.join(os.homedir(), '.agentview/attention.json');
const EVERY = 15 * 60_000;
const EDIT_AGE = 10 * 60_000;
const STALE_AFTER = 2 * 24 * 60 * 60_000;
const FORGET = 7 * 24 * 60 * 60_000;
const LAST = new Set<AttentionKind>(['review', 'stale']);

function promptFor(kind: Exclude<AttentionKind, 'commit' | 'deploy'>, p: { number: number; title: string; url: string; branch?: string }) {
  const n = p.number;
  const ref = `#${n} "${p.title}" (${p.url})`;
  switch (kind) {
    case 'ci':
      return `Checks are failing on my PR ${ref}. Run \`gh pr checks ${n}\`, read the failing logs with \`gh run view <id> --log-failed\`, find the cause and fix it on branch ${p.branch}. Do not push until you have told me what you changed.`;
    case 'changes':
      return `A reviewer requested changes on my PR ${ref}. Read the review with \`gh pr view ${n} --comments\` and \`gh api repos/{owner}/{repo}/pulls/${n}/comments\`, address each point on branch ${p.branch} and summarise what you changed. Do not reply on GitHub.`;
    case 'review':
      return `/code-review ${n}`;
    case 'ready':
      return `My PR ${ref} is approved and green. Read \`gh pr view ${n}\` and \`gh pr diff ${n}\`, check nothing looks unsafe to merge, and tell me. Do not merge.`;
    case 'stale':
      return `My PR ${ref} has had no activity for days. Check \`gh pr view ${n}\` for requested reviewers and comments, check \`gh pr view ${n} --json mergeable,mergeStateStatus\` for conflicts, and tell me who to ping or what to do. Do not post anything to GitHub.`;
    case 'issue':
      return `Issue ${ref} is assigned to me. Read it with \`gh issue view ${n} --comments\`, find the relevant code and propose a plan to fix it. Wait for my go before changing files.`;
  }
}

export function itemsFor(cwd: string, prs: PullRequest[], issues: Issue[], now = Date.now()): AttentionItem[] {
  const repo = path.basename(cwd);
  const out: AttentionItem[] = [];
  const add = (kind: Exclude<AttentionKind, 'commit' | 'deploy'>, p: { number: number; title: string; url: string; branch?: string; sha?: string }) =>
    out.push({ id: `${kind}:${p.url}`, kind, repo, cwd, number: p.number, title: p.title, url: p.url, since: now, prompt: promptFor(kind, p), sha: p.sha });
  for (const p of prs) {
    if (p.mine && p.checks === 'failure') add('ci', p);
    if (p.mine && p.review === 'CHANGES_REQUESTED') add('changes', p);
    if (p.reviewRequested && !p.mine) add('review', p);
    if (p.mine && !p.draft && p.review === 'APPROVED' && (p.checks === 'success' || p.checks === 'none')) add('ready', p);
    if (p.mine && !p.draft && !['APPROVED', 'CHANGES_REQUESTED'].includes(p.review) && now - Date.parse(p.updatedAt) > STALE_AFTER) add('stale', p);
  }
  for (const i of issues) add('issue', i);
  return out;
}

export type Edited = { cwd: string; chatId: string; at: number };
export type Sources = { cwds: string[]; edited: Edited[] };

// An idle chat left changes in the tree a while ago and nobody committed them.
export function commitItem(e: Edited, status: GitStatus, now = Date.now()): AttentionItem | null {
  if (!status.files.length || now - e.at < EDIT_AGE) return null;
  const repo = path.basename(e.cwd);
  const n = status.files.length;
  const title = `${n} changed file${n === 1 ? '' : 's'} on ${status.branch || 'detached HEAD'}`;
  const prompt = `There are uncommitted changes in ${repo} (${title}) from an earlier chat. Run \`git status\` and \`git diff\`, review them and propose a commit message. Do not commit until I confirm.`;
  return { id: `commit:${e.cwd}`, kind: 'commit', repo, cwd: e.cwd, number: 0, title, url: '', since: now, prompt, chatId: e.chatId };
}

// The newest deployment of an environment ended in failure or error. Pending and inactive ones are left alone.
export function deployItems(cwd: string, d: DeployStatus, now = Date.now()): AttentionItem[] {
  const repo = path.basename(cwd);
  return d.envs
    .filter((e) => e.latest && ['failure', 'error'].includes(e.latest.state))
    .map((e) => {
      const l = e.latest!;
      const sha = l.sha.slice(0, 7);
      const back = e.rollbackTo ? ` or roll back to ${e.rollbackTo.sha.slice(0, 7)}` : '';
      const prompt = `The latest deployment of ${d.app} to ${e.label} failed: ${l.description || l.state} (${l.url}), commit ${sha} by ${l.by}. Read the deploy log at that URL, compare with the deployed commit, and tell me whether to fix forward${back}. Do not deploy or roll back yourself.`;
      return { id: `deploy:${d.repo}:${e.name}:${l.id}`, kind: 'deploy' as const, repo, cwd, number: 0, title: `${e.label}: ${l.description || l.state} (${sha})`, url: l.url, since: now, prompt };
    });
}

type Saved = { seen: Record<string, number>; dismissed: string[]; autofix?: string[] | false };

let items: AttentionItem[] = [];
let seen = new Map<string, number>();
let dismissed = new Set<string>();
let autofix: string[] | false = false;
let fixer: ((item: AttentionItem) => Promise<string>) | null = null;
let loaded: Promise<void> | null = null;
let onChange: (items: AttentionItem[]) => void = () => {};
let seeded = false;

async function load() {
  const saved: Saved | null = await readFile(FILE, 'utf8').then(JSON.parse).catch(() => null);
  seeded = saved !== null;
  seen = new Map(Object.entries(saved?.seen ?? {}));
  dismissed = new Set(saved?.dismissed ?? []);
  autofix = saved?.autofix ?? false;
}

async function save() {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify({ seen: Object.fromEntries(seen), dismissed: [...dismissed], autofix } satisfies Saved));
}

export const attention = () => items;

export function onAttention(fn: (items: AttentionItem[]) => void) {
  onChange = fn;
}

// Merges a fresh poll into the known set: new items keep "since", vanished ones free their id so a repeat alerts again.
export function merge(found: AttentionItem[], now = Date.now()) {
  const current = new Map<string, AttentionItem>();
  for (const it of found) if (!current.has(it.id)) current.set(it.id, it);
  const fresh: AttentionItem[] = [];
  for (const it of current.values()) {
    const since = seen.get(it.id);
    if (since === undefined) {
      seen.set(it.id, now);
      fresh.push(it);
    } else it.since = since;
  }
  for (const id of seen.keys()) if (!current.has(id) && now - (seen.get(id) ?? 0) > FORGET) seen.delete(id);
  // A dismissal outlives a missed poll; it goes when the item has been gone for the forget period.
  for (const id of dismissed) if (!current.has(id) && !seen.has(id)) dismissed.delete(id);
  items = [...current.values()].filter((it) => !dismissed.has(it.id)).sort((a, b) => Number(LAST.has(a.kind)) - Number(LAST.has(b.kind)) || b.since - a.since);
  return fresh;
}

const fixes = new Map<string, string>();

// One fix chat per failing head commit; the chat ids live in memory only. The autofix key in attention.json
// lists repo names, an empty list means every repo, false or missing turns it off.
export async function fixCi(list: AttentionItem[], repos: string[] | false, fix: (item: AttentionItem) => Promise<string>, started = fixes) {
  if (repos === false) return;
  for (const it of list) {
    if (it.kind !== 'ci' || !it.sha) continue;
    if (!started.has(it.sha) && (!repos.length || repos.includes(it.repo))) started.set(it.sha, await fix(it).catch(() => ''));
    it.fixing = started.get(it.sha) || undefined;
  }
}

let polling: Promise<AttentionItem[]> | null = null;

export function refreshAttention(src: Sources) {
  return (polling ??= poll(src).finally(() => (polling = null)));
}

async function poll(src: Sources) {
  await (loaded ??= load());
  const found: AttentionItem[] = [];
  const byCwd = new Map(src.edited.map((e) => [e.cwd, e]));
  await Promise.all([
    ...[...new Set(src.cwds)].map(async (cwd) => {
      try {
        const [prs, issues] = await Promise.all([listPrs(cwd, true), listIssues(cwd).catch(() => [])]);
        found.push(...itemsFor(cwd, prs, issues));
      } catch {}
    }),
    ...[...new Set(src.cwds)].map(async (cwd) => {
      try {
        const d = await deployWatch(cwd);
        if (d) found.push(...deployItems(cwd, d));
      } catch {}
    }),
    ...[...byCwd.values()].map(async (e) => {
      try {
        const it = commitItem(e, await gitStatus(e.cwd));
        if (it) found.push(it);
      } catch {}
    }),
  ]);
  const fresh = merge(found);
  if (fixer) await fixCi(items, autofix, fixer);
  if (seeded) for (const it of fresh) if (!dismissed.has(it.id)) post(`${ATTENTION_LABEL[it.kind]} in ${it.repo}`, it.number ? `#${it.number}` : it.repo, it.title);
  seeded = true;
  await save().catch(() => {});
  onChange(items);
  return items;
}

export function dismissAttention(id: string) {
  dismissed.add(id);
  items = items.filter((it) => it.id !== id);
  void save().catch(() => {});
  onChange(items);
  return items;
}

export function startAttention(src: () => Sources, fix: (item: AttentionItem) => Promise<string>) {
  fixer = fix;
  void refreshAttention(src());
  setInterval(() => void refreshAttention(src()), EVERY).unref();
}
