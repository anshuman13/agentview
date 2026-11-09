import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ChatEvent, Repeat, RoundOutcome, RunOp, ServerMessage, ServerState, SessionInfo, LoopState } from '../../../shared/protocol.js';
import type { AgentDriver, AgentHost, AskOptions, Cron, DriverFactory, History, TurnResult } from '../agent/types.js';
import { resumePrompt, type Stopped } from '../host/restore.js';
import { Approvals } from './approvals.js';
import { BuildCycle } from './cycle.js';
import { EventLog } from './eventLog.js';
import { Hooks } from './hooks.js';
import { blockedRule } from './events.js';
import { loopOff } from './loop.js';
import { Mcp } from './mcp.js';
import { MessageQueue } from './messageQueue.js';
import { Compaction } from './compaction.js';
import { parseFindings, reviewTarget, saveFindings } from './findings.js';
import { Review } from './review.js';
import { Prompts } from './prompts.js';
import { PR_URL, createsPr } from './pr.js';
import { RepeatController, ROUND_INSTRUCTION } from './repeat.js';
import { RunLinks } from './runLinks.js';
import { Runs } from './runs.js';
import { SessionSettings } from './settings.js';
import { Stopper } from './stopper.js';
import { Turn } from './turn.js';
import { UsageLimit } from './usageLimit.js';
import { Wakeups } from './wakeups.js';

export class AgentSession implements AgentHost {
  readonly driver: AgentDriver;
  closed = false;
  crons: Cron[] = [];
  id = randomUUID();
  title = '';
  onIdle: (() => void) | null = null;
  created = Date.now();
  state: ServerState;
  failed = false;
  // The host replaces this with the one it saves; a chat without a host keeps its runs in memory.
  runs = new Runs();
  // ends: the run ends with this round, so its own end push is the only one.
  roundNote: { outcome: RoundOutcome; line: string; ends: boolean } | null = null;
  readonly approvals: Approvals;
  readonly log: EventLog;
  readonly waiting = new MessageQueue(this);
  readonly turn = new Turn(this);
  readonly cycle = new BuildCycle(this);
  readonly settings = new SessionSettings(this);
  readonly mcp = new Mcp(this);
  readonly limit = new UsageLimit(this);
  readonly wakeups = new Wakeups(this);
  readonly links = new RunLinks(this);
  readonly compaction = new Compaction(this);
  readonly prompts = new Prompts(this);
  readonly stopper = new Stopper(this);
  readonly hooks = new Hooks(this);
  readonly review = new Review(this);
  readonly repeater = new RepeatController(this.links.repeatHost());
  private listeners = new Set<(m: ServerMessage) => void>();
  // PR number or "local" of the last /code-review, so a ReportFindings call knows what it reviewed.
  private reviewTarget: string | null = null;
  constructor(public cwd: string, driver: DriverFactory, sessionId: string | null = null) {
    this.state = {
      session: { id: this.id, sessionId, model: null, effort: 'medium', team: false, cwd, running: false, permissionMode: 'auto', apiKeySource: null, models: [], commands: [], cache: null, context: null, compacting: false, stopping: false, mcp: [], loop: loopOff(), repeat: null, pr: null, account: 'main', accounts: [] },
      status: 'Idle',
      events: [],
      pending: [],
      recentFiles: [],
    };
    this.approvals = new Approvals(this.state, (m) => this.emit(m));
    this.log = new EventLog(this.state, (m) => this.emit(m), (ev) => this.pushEvent(ev));
    this.driver = driver(this);
    this.state.session.provider = this.driver.provider;
    this.state.session.capabilities = this.driver.capabilities;
    this.state.session.account = this.driver.account;
    this.state.session.accounts = this.driver.accounts();
  }

  // The state for a client that opens the chat, with accounts logged in since the chat started.
  view(limit?: number) {
    this.state.session.accounts = this.driver.accounts();
    return this.log.window(limit);
  }

  before(id: string, limit?: number) {
    return this.log.before(id, limit);
  }

  onMessage(fn: (m: ServerMessage) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(m: ServerMessage) {
    if (m.type === 'pending') this.links.waitingOnUser(true);
    else if (m.type === 'resolved' && !this.state.pending.length) this.links.waitingOnUser(false);
    for (const l of this.listeners) l(m);
  }

  pushEvent(ev: ChatEvent, opts?: { release?: boolean }) {
    this.log.add(ev);
    if (ev.kind === 'user' && !ev.auto) this.runs.answer(this.id);
    this.emit({ type: 'event', event: ev });
    if (ev.kind === 'tool_result' && !ev.parent && opts?.release !== false) this.waiting.release();
  }

  queueNext(text: string, id?: string) {
    return this.prompts.queueNext(text, id);
  }

  sendNow(id: string) {
    return this.prompts.sendNow(id);
  }

  system(text: string, error?: boolean) {
    this.pushEvent({ id: randomUUID(), kind: 'system', text, at: Date.now(), ...(error && { error }) });
  }

  setStatus(text: string) {
    this.state.status = text;
    this.emit({ type: 'status', text });
    this.pushEvent({ id: randomUUID(), kind: 'status', text, at: Date.now() });
  }

  setSession(patch: Partial<SessionInfo>) {
    const wasRunning = this.state.session.running;
    this.state.session = { ...this.state.session, ...patch };
    if (patch.sessionId) this.runs.bind(this.id, patch.sessionId);
    if (wasRunning && patch.running === false) this.driver.settled();
    this.emit({ type: 'session', session: this.state.session });
  }

  noteFile(rel: string, source: 'tool' | 'watcher') {
    this.state.recentFiles = [rel, ...this.state.recentFiles.filter((f) => f !== rel)].slice(0, 30);
    this.emit({ type: 'file_changed', path: rel, source });
    if (source === 'tool') this.hooks.noteEdit();
  }

  captureEdit(file: string) {
    this.review.capture(file);
  }

  fileChangedExternally(rel: string) {
    this.noteFile(rel, 'watcher');
    this.hooks.saved(rel);
  }

  watchHistory(on: boolean) {
    this.driver.watchHistory(on);
  }

  replaceHistory(h: History) {
    this.log.replace(h);
  }

  async loadHistory() {
    const h = await this.driver.loadHistory();
    if (h) this.log.append(h);
  }

  close() {
    this.closed = true;
    this.stopper.close();
    this.links.endAll();
    this.repeater.stop();
    this.wakeups.close();
    this.listeners.clear();
    this.approvals.denyAll();
    this.driver.close();
  }

  start() {
    this.driver.start();
  }

  async refreshUsage() {
    await this.driver.refreshUsage?.();
  }

  setModel(model: string) {
    return this.settings.setModel(model);
  }

  setEffort(level: string) {
    return this.settings.setEffort(level);
  }

  setAccount(a: string) {
    this.settings.setAccount(a);
  }

  setPermissionMode(mode: string) {
    return this.settings.setPermissionMode(mode);
  }

  setReview(on: boolean) {
    this.settings.setReview(on);
  }

  canUseTool(toolName: string, input: Record<string, unknown>, opts: AskOptions) {
    return this.cycle.planDone(toolName, input, opts) ?? this.approvals.ask(toolName, input, opts);
  }

  ask(toolName: string, input: Record<string, unknown>, opts: AskOptions) {
    return this.approvals.ask(toolName, input, opts);
  }

  answerPermission(id: string, allow: boolean, always?: boolean) {
    this.approvals.answerPermission(id, allow, always);
  }

  eventById(id: string) {
    return this.log.get(id);
  }

  agentOf(toolUseId: string) {
    return this.log.agent(toolUseId);
  }

  blocked(toolUseId: string, tool: string, reason: string) {
    const rule = blockedRule(this.log.get(toolUseId), tool);
    if (rule) this.pushEvent({ id: `${toolUseId}:blocked`, kind: 'blocked', rule, reason, allowed: false, at: Date.now() });
  }

  async allowBlocked(id: string) {
    const ev = this.log.get(id);
    if (ev?.kind !== 'blocked' || ev.allowed) return;
    const added = await this.driver.allow(ev.rule);
    this.log.allow(ev.rule);
    if (added) void this.prompt(`I allowed ${ev.rule} for this chat. Retry it.`);
  }

  reportFindings(input: unknown) {
    void saveFindings(this.cwd, this.reviewTarget ?? 'local', parseFindings(input)).then((review) => this.emit({ type: 'findings', review }), () => {});
  }

  notePr(toolUseId: string, text: string) {
    const pr = PR_URL.exec(text)?.[1];
    const use = pr ? this.log.get(toolUseId) : undefined;
    if (pr && use && createsPr(use)) this.setSession({ pr: Number(pr) });
  }

  sendPrompt(text: string, id: string = randomUUID(), mark?: { auto: 'loop' | 'goal'; round: number }) {
    this.pushEvent({ id, kind: 'user', text, at: Date.now(), ...mark });
    if (mark) this.turn.roundTurn = true;
    this.enqueue(mark ? `${text}\n\n${ROUND_INSTRUCTION}` : text, id);
  }

  enqueue(text: string, id?: string) {
    this.reviewTarget = reviewTarget(text) ?? this.reviewTarget;
    this.start();
    this.turn.start();
    this.failed = false;
    this.setSession({ running: true });
    if (/^\/compact\b/.test(text.trim())) this.compaction.start();
    this.driver.send(text, id);
  }

  async rewind(id: string) {
    if (this.state.session.running) return this.system('Stop Claude before rewinding files');
    const r = await this.driver.rewind(id);
    if (!r.canRewind) return this.system(`Rewind failed: ${r.error ?? 'no checkpoint for that prompt'}`);
    const files = r.filesChanged ?? [];
    this.system(`Rewound ${files.length} ${files.length === 1 ? 'file' : 'files'} to before that prompt`);
    for (const f of files) this.noteFile(path.relative(this.cwd, f), 'tool');
  }

  interrupt() {
    return this.stopper.interrupt();
  }

  stopTask(toolUseId: string) {
    return this.stopper.task(toolUseId);
  }

  adopt(toolUseId: string) {
    this.log.adopt(toolUseId);
  }

  // Messages waiting behind a turn, saved when the host exits so a restart does not drop them.
  get queuedMessages() {
    return this.waiting.messages;
  }

  resumeStopped(stopped: Stopped) {
    this.prompts.orQueue(resumePrompt(stopped));
  }

  restarted(why: string) {
    this.log.orphanRunning();
    if (this.crons.length) this.wakeups.restore(this.crons, why);
  }

  prompt(text: string, id?: string) {
    return this.prompts.prompt(text, id);
  }

  retryLast() {
    return this.prompts.retryLast();
  }

  runControl(run: string, op: RunOp) {
    this.links.control(run, op);
  }

  setLoop(on: boolean, max?: number) {
    this.cycle.set(on, max);
  }

  restoreLoop(loop: LoopState) {
    this.cycle.restore(loop);
  }

  steer(text: string, id?: string) {
    return this.prompts.steer(text, id);
  }

  resumeRepeat(r: Repeat) {
    this.repeater.resume(r);
  }

  changePlan(next: string[]) {
    this.turn.changePlan(next);
  }

  takePlanChange() {
    return this.turn.takePlanChange();
  }

  startCompacting() {
    this.compaction.start();
  }

  compacted(pre: number, post: number | null | undefined) {
    this.compaction.done(pre, post);
  }

  compactFailed(error: string) {
    this.compaction.fail(error);
  }

  turnStarted(why?: string) {
    this.turn.started(why);
  }

  noteLimit(text: string) {
    this.limit.note(text);
  }

  overage(until: number) {
    this.limit.overage(until);
  }

  turnResult(r: TurnResult) {
    this.turn.result(r);
  }

  turnEnded() {
    this.turn.ended();
  }

  exited() {
    this.turn.exited();
  }
}
