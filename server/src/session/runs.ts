import { randomUUID } from 'node:crypto';
import { readJsonSync, writeJsonSync } from '../json.js';
import { roundOf } from '../../../shared/edits.js';
import type { ChatRun, Round, RoundOutcome } from '../../../shared/protocol.js';

export const WAITING = 'waiting for your approval';
export const READY = 'Ready for review';

const KEEP_ENDED = 100;
const KEEP_ROUNDS = 50;
const SAVE_MS = 1000;

type NewRun = Pick<ChatRun, 'kind' | 'sessionId' | 'chatId' | 'title' | 'what' | 'provider'> & Partial<Pick<ChatRun, 'round' | 'max' | 'nextAt' | 'every' | 'endAt' | 'capPct' | 'maxBuilds' | 'builds' | 'tries' | 'jobId' | 'branch' | 'repo' | 'worktree' | 'paseo'>>;

export const firstSentence = (text: string, max = 120) => text.trim().split(/(?<=[.!?])\s|\n/)[0].slice(0, max).trim();

// The outcome of a loop round or goal round from its reply: the ROUND line, else progress with the first sentence.
export function roundResult(text: string, { failed = false, met = false } = {}): { outcome: RoundOutcome; line: string } {
  const parsed = roundOf(text);
  if (failed) return { outcome: 'failed', line: parsed?.line || firstSentence(text) };
  if (met) return { outcome: 'done', line: parsed?.line || 'Goal met' };
  return parsed ?? { outcome: 'progress', line: firstSentence(text) };
}

// The tries still in the run: Keep drops the others.
export const openTries = (run: ChatRun) => (run.tries ?? []).filter((t) => !t.dropped);

const allReported = (run: ChatRun) => openTries(run).every((t) => run.rounds.some((r) => r.n === t.n));

// A blocked or question round, or a pause for approval, until a later round or a message from the user.
const mark = (r: ChatRun) => {
  r.needsYou = r.state !== 'done' && (Boolean(r.asked) || r.review === 'pending' || (r.state === 'paused' && r.why === WAITING));
};

// All runs of the host. Active ones and the latest ended ones are saved to file, each with its last rounds.
export class Runs {
  private runs: ChatRun[];
  private timer: NodeJS.Timeout | null = null;

  constructor(private file: string | null = null, private onChange: () => void = () => {}, private onEnd: (run: ChatRun) => void = () => {}, private onReported: (run: ChatRun) => void = () => {}) {
    const saved = file ? readJsonSync<unknown>(file, []) : [];
    this.runs = Array.isArray(saved) ? saved.filter((r): r is ChatRun => typeof r?.id === 'string' && Array.isArray(r.rounds)) : [];
    for (const r of this.runs) mark(r);
  }

  list() {
    return this.runs;
  }

  get(id: string | undefined) {
    return this.runs.find((r) => r.id === id);
  }

  // The run a chat is on now, if any.
  activeFor(chatId: string) {
    return this.runs.filter((r) => r.chatId === chatId && r.state !== 'done').at(-1);
  }

  // The scheduled coding job a chat is working on, until it ends.
  jobFor(chatId: string) {
    return this.runs.find((r) => r.kind === 'job' && r.chatId === chatId && r.state !== 'done');
  }

  // The open job run of a Claude session, which stays the same across restarts.
  jobOfSession(sessionId: string | null | undefined) {
    return sessionId ? this.runs.find((r) => r.kind === 'job' && r.sessionId === sessionId && r.state !== 'done') : undefined;
  }

  start(init: NewRun) {
    const run: ChatRun = { round: 0, max: 0, nextAt: null, ...init, id: randomUUID(), startedAt: Date.now(), endedAt: null, state: 'running', why: '', costUsd: 0, rounds: [], needsYou: false };
    this.runs.push(run);
    this.touch();
    return run.id;
  }

  update(id: string | undefined, patch: Partial<Pick<ChatRun, 'chatId' | 'sessionId' | 'state' | 'why' | 'round' | 'max' | 'nextAt' | 'every' | 'endAt' | 'capPct' | 'maxBuilds' | 'builds' | 'usage' | 'review' | 'pr'>>) {
    const run = this.get(id);
    if (!run || run.state === 'done') return;
    Object.assign(run, patch);
    this.touch();
  }

  // A chat that has no Claude session yet gets one with its first turn.
  bind(chatId: string, sessionId: string) {
    for (const r of this.runs) {
      if (r.chatId === chatId && !r.sessionId) r.sessionId = sessionId;
      for (const t of r.tries ?? []) if (t.chatId === chatId && !t.sessionId) t.sessionId = sessionId;
    }
  }

  addRound(id: string | undefined, round: Omit<Round, 'at'>) {
    const run = this.get(id);
    if (!run || run.state === 'done') return;
    run.rounds.push({ ...round, at: Date.now() });
    run.costUsd += round.costUsd;
    run.asked = round.outcome === 'blocked' || round.outcome === 'question';
    this.touch();
  }

  // A turn of a try chat ends: its report is a round of the tries run. The last try to report fires onReported once.
  reportTry(sessionId: string, report: { outcome: RoundOutcome; line: string; costUsd: number }) {
    const run = this.runs.find((r) => r.state !== 'done' && openTries(r).some((t) => t.sessionId === sessionId));
    const n = run && openTries(run).find((t) => t.sessionId === sessionId)?.n;
    if (!run || !n) return;
    const before = allReported(run);
    this.addRound(run.id, { n, ...report, line: `Try ${n}: ${report.line}` });
    if (!before && allReported(run)) this.onReported(run);
  }

  // The kept try stays; the other tries are archived, which ends the run if it is still going.
  keep(id: string | undefined, n: number) {
    const run = this.get(id);
    if (!run?.tries?.some((t) => t.n === n)) return;
    for (const t of run.tries) t.dropped = t.n !== n;
    this.end(id, `kept try ${n}`);
    this.touch();
  }

  end(id: string | undefined, why: string) {
    const run = this.get(id);
    if (!run || run.state === 'done') return;
    Object.assign(run, { state: 'done', why, endedAt: Date.now(), nextAt: null });
    this.touch();
    this.onEnd(run);
  }

  // A message from the user in the chat answers a blocked or question round.
  answer(chatId: string) {
    const asked = this.runs.filter((r) => r.chatId === chatId && r.asked);
    for (const r of asked) r.asked = false;
    // A new turn on the chat of a run waiting for review takes it back from review.
    const reviewed = this.runs.filter((r) => r.kind === 'job' && r.chatId === chatId && r.review === 'pending');
    for (const r of reviewed) Object.assign(r, { state: 'running', why: '', review: undefined });
    if (asked.length || reviewed.length) this.touch();
  }

  // A stopped run starts again with its rounds and cost.
  reopen(id: string | undefined) {
    const run = this.get(id);
    if (!run || run.state !== 'done') return;
    Object.assign(run, { state: 'running', why: '', endedAt: null });
    this.touch();
  }

  // After a restart, a run no chat took back is over.
  endExcept(keep: (string | undefined)[], why: string) {
    for (const r of this.runs) if (r.state !== 'done' && !keep.includes(r.id)) this.end(r.id, why);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.file) writeJsonSync(this.file, this.runs);
  }

  private touch() {
    const ended = this.runs.filter((r) => r.state === 'done').sort((a, b) => b.endedAt! - a.endedAt!);
    const drop = new Set(ended.slice(KEEP_ENDED));
    this.runs = this.runs.filter((r) => !drop.has(r));
    for (const r of this.runs) if (r.rounds.length > KEEP_ROUNDS) r.rounds = r.rounds.slice(-KEEP_ROUNDS);
    for (const r of this.runs) mark(r);
    this.onChange();
    if (this.file && !this.timer) {
      this.timer = setTimeout(() => this.flush(), SAVE_MS);
      this.timer.unref();
    }
  }
}
