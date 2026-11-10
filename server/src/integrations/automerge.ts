import path from 'node:path';
import { jsonFile } from '../json.js';
import { checkState, type Check } from './github.js';

export type Method = 'squash' | 'merge' | 'rebase';
type Entry = { cwd: string; number: number; method: Method; since: number; error?: string };
type View = { state: string; title?: string; isDraft?: boolean; mergeable?: string; reviewDecision?: string; statusCheckRollup?: Check[]; headRefOid?: string };
type Step = { kind: 'delete' } | { kind: 'wait'; note: string } | { kind: 'merge'; sha: string };
type Gh = (cwd: string, ...args: string[]) => Promise<string>;
type Post = (title: string, subtitle: string, body: string) => void;

const VIEW = 'state,title,isDraft,mergeable,reviewDecision,statusCheckRollup,headRefOid';
const FIRST_NOTE = 'Waiting for checks';
const wait = (note: string): Step => ({ kind: 'wait', note });

export function autoMergeStep(view: View): Step {
  if (view.state === 'MERGED' || view.state === 'CLOSED') return { kind: 'delete' };
  if (view.isDraft) return wait('Draft');
  if (view.mergeable === 'CONFLICTING') return wait('Conflict');
  if (view.reviewDecision === 'CHANGES_REQUESTED') return wait('Changes requested');
  if (view.reviewDecision === 'REVIEW_REQUIRED') return wait('Waiting for review');
  const checks = view.statusCheckRollup ?? [];
  const states = checks.map(checkState);
  if (states.includes('failure')) return wait('Checks failed · waiting for a new commit or a re-run');
  if (states.includes('pending') || view.mergeable === 'UNKNOWN') return wait(FIRST_NOTE);
  if (!checks.some((c) => (c.conclusion || c.state || '').toUpperCase() === 'SUCCESS') || !view.headRefOid) return wait('No passing checks');
  return { kind: 'merge', sha: view.headRefOid };
}

const same = (e: Entry, cwd: string, number: number) => e.cwd === cwd && e.number === number;
const keyOf = (e: Entry) => `${e.cwd}#${e.number}`;

export function createAutoMerge(deps: { gh: Gh; post: Post; file: string; changed: (cwd: string) => void }) {
  const { gh, post, file, changed } = deps;
  const store = jsonFile<Entry[]>(file, []);
  const notes = new Map<string, string>();
  const merging = new Set<string>();
  const drop = (e: Entry) => {
    notes.delete(keyOf(e));
    return store.update((cur) => cur.filter((x) => !same(x, e.cwd, e.number)));
  };
  const fail = (e: Entry, error: string) => store.update((cur) => cur.map((x) => (same(x, e.cwd, e.number) ? { ...x, error } : x)));

  async function turn(cwd: string, number: number, on: boolean, method: Method) {
    const existing = (await store.read()).find((e) => same(e, cwd, number));
    if (!on) {
      if (existing) await drop(existing);
      return { ok: true };
    }
    if (existing && !existing.error) return { ok: true };
    if (JSON.parse(await gh(cwd, 'pr', 'view', String(number), '--json', 'state')).state !== 'OPEN') throw new Error('This pull request is not open');
    await store.update((cur) => {
      const now = cur.find((e) => same(e, cwd, number));
      if (!now) return [...cur, { cwd, number, method, since: Date.now() }];
      return now.error ? cur.map((e) => (e === now ? { cwd, number, method, since: e.since } : e)) : cur;
    });
    return { ok: true };
  }

  async function check(e: Entry) {
    const k = keyOf(e);
    if (merging.has(k)) return;
    merging.add(k);
    try {
      let view: View;
      try {
        view = JSON.parse(await gh(e.cwd, 'pr', 'view', String(e.number), '--json', VIEW));
      } catch {
        return;
      }
      const step = autoMergeStep(view);
      if (step.kind === 'delete') return void (await drop(e));
      if (step.kind === 'wait') return void notes.set(k, step.note);
      if (!(await store.read()).some((x) => same(x, e.cwd, e.number) && !x.error)) return;
      const repo = path.basename(e.cwd);
      try {
        await gh(e.cwd, 'pr', 'merge', String(e.number), `--${e.method}`, '--match-head-commit', step.sha);
      } catch (err) {
        const error = (err as Error).message.split('\n')[0];
        await fail(e, error);
        post(`Auto-merge failed in ${repo}`, `#${e.number}`, error);
        return;
      }
      await drop(e);
      changed(e.cwd);
      post(`Merged in ${repo}`, `#${e.number}`, view.title ?? '');
    } finally {
      merging.delete(k);
    }
  }

  async function poll() {
    await Promise.all((await store.read()).filter((e) => !e.error).map(check));
  }

  async function state(cwd: string) {
    const out = new Map<number, { note: string; error?: string }>();
    for (const e of await store.read()) if (e.cwd === cwd) out.set(e.number, { note: notes.get(keyOf(e)) ?? FIRST_NOTE, ...(e.error ? { error: e.error } : {}) });
    return out;
  }

  const start = () => setInterval(() => void poll().catch(() => {}), 60_000).unref();

  return { turn, poll, state, start };
}

export type AutoMerge = ReturnType<typeof createAutoMerge>;
