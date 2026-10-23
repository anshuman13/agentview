import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { ATTENTION_LABEL, type AttentionItem, type AttentionKind, type GitStatus, type PullRequest } from '../../shared/protocol.js';
import { listIssues, listPrs, type Issue } from './github.js';
import { gitStatus } from './git.js';
import { post } from './notify.js';

const FILE = path.join(os.homedir(), '.agentview/attention.json');
const EVERY = 5 * 60_000;
const EDIT_AGE = 10 * 60_000;
const FORGET = 7 * 24 * 60 * 60_000;

function promptFor(kind: Exclude<AttentionKind, 'commit'>, p: { number: number; title: string; url: string; branch?: string }) {
  const n = p.number;
  const ref = `#${n} "${p.title}" (${p.url})`;
  switch (kind) {
    case 'ci':
      return `Checks are failing on my PR ${ref}. Run \`gh pr checks ${n}\`, read the failing logs with \`gh run view <id> --log-failed\`, find the cause and fix it on branch ${p.branch}. Do not push until you have told me what you changed.`;
    case 'changes':
      return `A reviewer requested changes on my PR ${ref}. Read the review with \`gh pr view ${n} --comments\` and \`gh api repos/{owner}/{repo}/pulls/${n}/comments\`, address each point on branch ${p.branch} and summarise what you changed. Do not reply on GitHub.`;
    case 'review':
      return `Review PR ${ref}. Read it with \`gh pr view ${n}\` and \`gh pr diff ${n}\`, then list correctness bugs and risky changes with file and line references. Do not post anything to GitHub.`;
    case 'ready':
      return `My PR ${ref} is approved and green. Read \`gh pr view ${n}\` and \`gh pr diff ${n}\`, check nothing looks unsafe to merge, and tell me. Do not merge.`;
    case 'issue':
      return `Issue ${ref} is assigned to me. Read it with \`gh issue view ${n} --comments\`, find the relevant code and propose a plan to fix it. Wait for my go before changing files.`;
  }
}

export function itemsFor(cwd: string, prs: PullRequest[], issues: Issue[], now = Date.now()): AttentionItem[] {
  const repo = path.basename(cwd);
  const out: AttentionItem[] = [];
  const add = (kind: Exclude<AttentionKind, 'commit'>, p: { number: number; title: string; url: string; branch?: string }) =>
    out.push({ id: `${kind}:${p.url}`, kind, repo, cwd, number: p.number, title: p.title, url: p.url, since: now, prompt: promptFor(kind, p) });
  for (const p of prs) {
    if (p.mine && p.checks === 'failure') add('ci', p);
    if (p.mine && p.review === 'CHANGES_REQUESTED') add('changes', p);
    if (p.reviewRequested && !p.mine) add('review', p);
    if (p.mine && !p.draft && p.review === 'APPROVED' && (p.checks === 'success' || p.checks === 'none')) add('ready', p);
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

type Saved = { seen: Record<string, number>; dismissed: string[] };

let items: AttentionItem[] = [];
let seen = new Map<string, number>();
let dismissed = new Set<string>();
let loaded: Promise<void> | null = null;
let onChange: (items: AttentionItem[]) => void = () => {};
let seeded = false;

async function load() {
  const saved: Saved | null = await readFile(FILE, 'utf8').then(JSON.parse).catch(() => null);
  seeded = saved !== null;
  seen = new Map(Object.entries(saved?.seen ?? {}));
  dismissed = new Set(saved?.dismissed ?? []);
}

async function save() {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify({ seen: Object.fromEntries(seen), dismissed: [...dismissed] } satisfies Saved));
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
  for (const id of dismissed) if (!current.has(id)) dismissed.delete(id);
  items = [...current.values()].filter((it) => !dismissed.has(it.id)).sort((a, b) => b.since - a.since);
  return fresh;
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
    ...[...byCwd.values()].map(async (e) => {
      try {
        const it = commitItem(e, await gitStatus(e.cwd));
        if (it) found.push(it);
      } catch {}
    }),
  ]);
  const fresh = merge(found);
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

export function startAttention(src: () => Sources) {
  void refreshAttention(src());
  setInterval(() => void refreshAttention(src()), EVERY).unref();
}
