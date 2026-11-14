import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Account, Provider, ChatEvent, Repeat, RoundOutcome, RunEdit, RunOp, ServerMessage, ServerState, SessionInfo, LoopState, LiveNow } from '../../../shared/protocol.js';
import type { AgentDriver, AgentHost, AskOptions, Cron, DriverFactory, History, TurnResult } from '../agent/types.js';
import { resumePrompt, type Stopped } from './resume.js';
import { Approvals } from './approvals.js';
import { buildStageOf } from '../../../shared/builds.js';
import { recordBuild, recordHistory } from './builds.js';
import { BuildCycle } from './cycle.js';
import { EventLog } from './eventLog.js';
import { Hooks } from './hooks.js';
import { blockedRule } from './events.js';
import { expandChatMentions } from './chatMentions.js';
import { loopOff } from './loop.js';
import { Mcp } from './mcp.js';
import { MessageQueue } from './messageQueue.js';
import { Compaction } from './compaction.js';
import { parseFindings, reviewTarget, saveFindings } from './findings.js';
import { Review } from './review.js';
import { Prompts } from './prompts.js';
import { PR_URL, createsPr } from './pr.js';
import { parseGoal, RepeatController, ROUND_INSTRUCTION } from './repeat.js';
import { SKETCH_COMMAND, sketchPrompt } from '../../../shared/sketches.js';
import { SPEC_REVIEW_COMMAND, specReviewPrompt } from '../../../shared/specTasks.js';
import { RunLinks } from './runLinks.js';
import { Runs } from './runs.js';
import { SessionSettings } from './settings.js';
import { Stopper } from './stopper.js';
import { Turn } from './turn.js';
import { UsageLimit } from './usageLimit.js';
import { Wakeups } from './wakeups.js';

// The tools whose call carries a review's findings.
const FINDINGS_TOOLS = new Set(['ReportFindings', 'mcp__agentview__report_findings']);

export class AgentSession implements AgentHost {
  readonly driver: AgentDriver;
  closed = false;
  crons: Cron[] = [];
  id = randomUUID();
  title = '';
  onIdle: (() => void) | null = null;
  onJobTurn: ((runId: string, failed: boolean) => void) | null = null;
  startChat?: (cwd: string, text: string) => Promise<string>;
  created = Date.now();
  state: ServerState;
  failed = false;
  // The host replaces this with the one it saves; a chat without a host keeps its runs in memory.
  runs = new Runs();
  // The host sets the provider registry's lookups, which a session must not import.
  transcriptPath: (id: string) => string | null = () => null;
  resumeLine: (provider: Provider, cwd: string, sessionId: string, account: Account) => string | null = () => null;
  // ends: the run ends with this round, so its own end push is the only one.
  roundNote: { outcome: RoundOutcome; line: string; goal: boolean; ends: boolean } | null = null;
  readonly approvals: Approvals;
  readonly log: EventLog;
  readonly waiting = new MessageQueue(this);
  readonly turn = new Turn(this);
  readonly cycle = new BuildCycle(this);
  readonly settings = new SessionSettings(this);
  readonly mcp = new Mcp(this);
  readonly usage = new UsageLimit(this);
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
  private reported = new Set<string>();
  private sent: Pick<SessionInfo, 'commands' | 'mcp'> | null = null;
  constructor(public cwd: string, driver: DriverFactory, sessionId: string | null = null) {
    this.state = {
      session: { id: this.id, sessionId, model: null, effort: 'medium', cwd, running: false, permissionMode: 'auto', apiKeySource: null, models: [], commands: [], cache: null, context: null, compacting: false, stopping: false, mcp: [], loop: loopOff(), repeat: null, pr: null, account: 'main', accounts: [] },
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
    this.state.session.instructionFiles = this.driver.instructionFiles;
    this.state.session.account = this.driver.account;
    this.state.session.accounts = this.driver.accounts();
    this.setResumeCommand();
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
    if (m.type === 'event') {
      recordBuild(this, m.event);
      this.countBuild(m.event);
    }
    for (const l of this.listeners) l(m);
  }

  // The first live running event of an implementer counts its slug toward the loop's build limit; a replayed or restored one is older than a minute.
  private countBuild(ev: ChatEvent) {
    if (ev.kind !== 'agent' || ev.status !== 'running' || Date.now() - ev.startedAt > 60_000) return;
    const target = buildStageOf(ev.subagentType, ev.description, ev.prompt);
    if (target?.stage !== 'implement') return;
    this.repeater.noteBuild(target.slug);
  }

  pushEvent(ev: ChatEvent, opts?: { release?: boolean }) {
    this.log.add(ev);
    if (ev.kind === 'user' && !ev.auto) this.runs.answer(this.id);
    this.emit({ type: 'event', event: ev });
    this.noteTool(ev);
    if (ev.kind === 'tool_result' && !ev.parent && opts?.release !== false) this.waiting.release();
  }

  // What a top-level tool step means to the session, whichever driver ran it: a review's findings, a plan change to pass on, or the PR a command opened.
  private noteTool(ev: ChatEvent) {
    if (ev.kind === 'tool_use' && FINDINGS_TOOLS.has(ev.name) && !this.reported.has(ev.id)) {
      this.reported.add(ev.id);
      this.reportFindings(ev.input);
    }
    if (ev.kind === 'tool_use' && !ev.parent) this.injectPlanChange();
    if (ev.kind !== 'tool_result' || ev.parent) return;
    const pr = PR_URL.exec(ev.text)?.[1];
    const use = pr ? this.log.get(ev.toolUseId) : undefined;
    if (pr && use && createsPr(use)) this.setSession({ pr: Number(pr) });
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

  setStatus(text: string, { done, next }: { done?: string; next?: string[] } = {}) {
    this.state.status = text;
    this.emit({ type: 'status', text });
    const at = Date.now();
    this.pushEvent({ id: randomUUID(), kind: 'status', text, at, ...(done && { done }), ...(next && { next }) });
  }

  goal(line: string) {
    const parsed = parseGoal(line);
    return parsed !== null && parsed !== 'usage' && this.repeater.command(line, () => undefined);
  }

  private setResumeCommand() {
    const { sessionId, account } = this.state.session;
    this.state.session.resumeCommand = sessionId ? this.resumeLine(this.driver.provider, this.cwd, sessionId, account) : null;
  }

  setSession(patch: Partial<SessionInfo>) {
    const wasRunning = this.state.session.running;
    this.state.session = { ...this.state.session, ...patch };
    if ('sessionId' in patch || 'account' in patch || 'provider' in patch) this.setResumeCommand();
    if (patch.sessionId) this.runs.bind(this.id, patch.sessionId);
    if (wasRunning && patch.running === false) this.driver.settled();
    const { commands, mcp, ...rest } = this.state.session;
    const last = this.sent;
    const now = (this.sent = { commands, mcp });
    // Commands and MCP tool lists are large, so they go only when a patch set them to something new.
    const changed = (key: 'commands' | 'mcp') => !last || (key in patch && now[key] !== last[key] && JSON.stringify(now[key]) !== JSON.stringify(last[key]));
    this.emit({ type: 'session', session: { ...rest, ...(changed('commands') && { commands }), ...(changed('mcp') && { mcp }) } });
  }

  noteFile(rel: string, source: 'tool' | 'watcher') {
    this.state.recentFiles = [rel, ...this.state.recentFiles.filter((f) => f !== rel)].slice(0, 30);
    this.emit({ type: 'file_changed', path: rel, source });
    if (source === 'tool') this.hooks.noteEdit();
  }

  captureEdit(file: string) {
    this.review.capture(file);
  }

  fileChangedExternally(rel: string, othersRunning = false) {
    this.noteFile(rel, 'watcher');
    this.hooks.saved(rel, othersRunning);
  }

  watchHistory(on: boolean) {
    this.driver.watchHistory(on);
  }

  replaceHistory(h: History) {
    this.log.replace(h);
    recordHistory(this, h.unshown);
  }

  async loadHistory() {
    const h = await this.driver.loadHistory();
    if (h) this.log.append(h);
    recordHistory(this, h?.unshown);
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

  // A plan change made mid-turn reaches the agent at its next step; when the agent cannot take it, it goes as a prompt.
  private injectPlanChange() {
    const plan = this.turn.takePlanChange();
    if (plan) void this.driver.inject(plan).then((taken) => taken || this.sendPrompt(plan));
  }

  private reportFindings(input: unknown) {
    void saveFindings(this.cwd, this.reviewTarget ?? 'local', parseFindings(input)).then((review) => this.emit({ type: 'findings', review }), () => {});
  }

  sendPrompt(text: string, id: string = randomUUID(), mark?: { auto: 'loop' | 'goal'; round: number }) {
    this.pushEvent({ id, kind: 'user', text, at: Date.now(), ...mark });
    if (mark) this.turn.roundTurn = true;
    this.enqueue(mark ? `${text}\n\n${ROUND_INSTRUCTION}` : text, id);
  }

  enqueue(text: string, id?: string) {
    const [, name, args = ''] = /^\/([\w-]+)(?:\s+(.*))?$/s.exec(text.trim()) ?? [];
    if (name === 'compact') return this.compact(args);
    const specReview = name === SPEC_REVIEW_COMMAND && /^\S+$/.test(args);
    const asPrompt = name === 'code-review' || name === SKETCH_COMMAND.name || specReview;
    if (name && !asPrompt && this.driver.command(name, args)) return;
    this.reviewTarget = reviewTarget(text) ?? this.reviewTarget;
    this.begin();
    if (name === 'code-review' && /^\d*$/.test(args)) this.driver.review(args ? Number(args) : 'local', id);
    else {
      const prompt = name === SKETCH_COMMAND.name ? sketchPrompt(args) : specReview ? specReviewPrompt(args) : expandChatMentions(text, this.transcriptPath);
      this.driver.send(prompt, id);
    }
  }

  compact(instructions?: string) {
    this.begin();
    this.compaction.start(true);
    this.driver.compact(instructions);
  }

  private begin() {
    this.start();
    this.turn.start();
    this.failed = false;
    this.setSession({ running: true });
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

  runEdit(run: string, edit: RunEdit) {
    this.links.edit(run, edit);
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

  limit(until: number) {
    return this.usage.note(until);
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
