import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ACCOUNT_LABEL, MAX_GOAL_ROUNDS, ROW_WINDOW, ACCOUNT_NOTE, COMPACT_AT, EFFORT_LEVELS, type Account, type ChatEvent, type Effort, type LoopState, type Repeat, type RoundOutcome, type RunOp, type ServerMessage, type ServerState, type SessionInfo } from '../../../shared/protocol.js';
import { clock, errText } from '../../../shared/util.js';
import { costRise } from '../../../shared/cost.js';
import type { AgentDriver, AgentHost, AskOptions, Cron, Decision, DriverFactory, History, TurnResult } from '../agent/types.js';
import { resumePrompt, type Stopped } from '../host/restore.js';
import { Approvals } from './approvals.js';
import { advance, looping, loopOff, needsApproval, phaseRound, planChangeText, planStep, withLoop, type LoopStep } from './loop.js';
import { RepeatController, ROUND_INSTRUCTION, after, fireTime, goalMet, limitReset, restorePrompt } from './repeat.js';
import { Runs, WAITING, roundResult } from './runs.js';
import { parseFindings, reviewTarget, saveFindings } from './findings.js';
import { EventIndex, MAX_EVENTS, stopAgents, trimHistory } from './events.js';
import { PR_URL, createsPr, prFrom } from './pr.js';

type UserEvent = Extract<ChatEvent, { kind: 'user' }>;

const accountName = (a: Account) => ACCOUNT_LABEL[a];
const CONTINUE = 'You hit a usage limit and now run on another Claude account. Continue where you stopped.';

const RETRY_COMPACT_GROWTH = 20_000;
const STOP_TIMEOUT = 15_000;

export class AgentSession implements AgentHost {
  readonly driver: AgentDriver;
  private closed = false;
  crons: Cron[] = [];
  private wokeAt = 0;

  id = randomUUID();
  title = '';
  created = Date.now();
  state: ServerState;
  private listeners = new Set<(m: ServerMessage) => void>();
  private approvals: Approvals;

  private turns = 0;
  private planChange: string | null = null;
  private queued: UserEvent[] = [];
  // Sent to Claude mid-turn, shown as waiting until Claude reaches its next step.
  private pending: UserEvent[] = [];
  // A message sent mid-turn missed the turn's last step, so the CLI starts a turn for it.
  private expectTurn = false;
  private autoCompact = true;
  private compactFailedAt: number | null = null;
  private lastResult = '';
  private loopPrevModel: string | null = null;
  private planDenied = false;
  // PR number or "local" of the last /code-review, so a ReportFindings call knows what it reviewed.
  private reviewTarget: string | null = null;
  private limitReset: number | null = null;
  private lastError = false;
  failed = false;
  // The host replaces this with the one it saves; a chat without a host keeps its runs in memory.
  runs = new Runs();
  private cycleRun: string | undefined;
  // The last turn was a loop round or goal check; its reply ends with a ROUND line.
  private roundTurn = false;
  // The id of the prompt of the weekly report round of a standing goal, while that round runs.
  private reportTurn: string | undefined;
  // ends: the run ends with this round, so its own end push is the only one.
  roundNote: { outcome: RoundOutcome; line: string; ends: boolean } | null = null;
  private lastCost = 0;
  private turnCost = 0;
  private repeater = new RepeatController({
    repeat: () => this.state.session.repeat,
    running: () => this.state.session.running,
    closed: () => this.closed,
    setSession: (patch) => this.setSession(patch),
    system: (text) => this.system(text),
    startRun: (r) => this.startRun(r),
    resumeRun: (r) => this.resumeRun(r),
    endRun: (id, why) => this.runs.end(id, why),
    reopenRun: (id) => this.runs.reopen(id),
    patchRun: (id, patch) => this.runs.update(id, patch),
    asking: () => this.state.pending.length > 0,
    sendPrompt: (text, auto, round, report) => {
      const id = randomUUID();
      this.reportTurn = report ? id : undefined;
      this.sendPrompt(text, id, { auto, round });
    },
  });
  private orphans = new Set<string>();
  private index = new EventIndex(() => this.state.events);

  constructor(public cwd: string, driver: DriverFactory, sessionId: string | null = null) {
    this.state = {
      session: { id: this.id, sessionId, model: null, effort: 'medium', team: false, cwd, running: false, permissionMode: 'auto', apiKeySource: null, models: [], commands: [], cache: null, context: null, compacting: false, stopping: false, mcp: [], loop: loopOff(), repeat: null, pr: null, account: 'main', accounts: [] },
      status: 'Idle',
      events: [],
      pending: [],
      recentFiles: [],
    };
    this.approvals = new Approvals(this.state, (m) => this.emit(m));
    this.driver = driver(this);
    this.state.session.capabilities = this.driver.capabilities;
    this.state.session.account = this.driver.account;
    this.state.session.accounts = this.driver.accounts();
  }

  // The state for a client that opens the chat, with accounts logged in since the chat started.
  view(limit?: number) {
    this.state.session.accounts = this.driver.accounts();
    if (limit === undefined || this.state.events.length <= limit) return this.state;
    return { ...this.state, events: this.state.events.slice(-limit), earlier: this.state.events.length - limit };
  }

  // The page of events right before one, oldest first, and how many are left before it.
  before(id: string, limit = ROW_WINDOW) {
    const at = this.state.events.findIndex((e) => e.id === id);
    if (at < 0) throw new Error('That event is no longer held');
    const start = Math.max(0, at - Math.min(Math.max(Math.floor(limit), 1), 500));
    return { events: this.state.events.slice(start, at), earlier: start };
  }

  onMessage(fn: (m: ServerMessage) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(m: ServerMessage) {
    if (m.type === 'pending') this.waitingOnUser(true);
    else if (m.type === 'resolved' && !this.state.pending.length) this.waitingOnUser(false);
    for (const l of this.listeners) l(m);
  }

  pushEvent(ev: ChatEvent, opts?: { release?: boolean }) {
    this.state.events.push(ev);
    if (ev.kind === 'user' && !ev.auto) this.runs.answer(this.id);
    this.index.pushed(ev);
    if (this.state.events.length > MAX_EVENTS + 500) this.state.events = trimHistory(this.state.events);
    this.emit({ type: 'event', event: ev });
    if (ev.kind === 'tool_result' && !ev.parent && opts?.release !== false) this.release();
  }

  private release() {
    for (const ev of this.pending.splice(0)) {
      ev.queued = false;
      this.emit({ type: 'event', event: ev });
    }
  }

  // The composer's Enter while Claude works: Claude reads it at its next step and keeps going.
  async queueNext(text: string, id: string = randomUUID()) {
    if (this.known(id)) return;
    const s = this.state.session;
    if (!s.running || s.compacting || s.loop.on || text.trim().startsWith('/') || !this.driver.attached) return this.prompt(text, id);
    this.hold(this.pending, text, id);
    this.driver.send(text, id, 'next');
  }

  private hold(list: UserEvent[], text: string, id: string) {
    const ev: UserEvent = { id, kind: 'user', text, at: Date.now(), queued: true };
    list.push(ev);
    this.pushEvent(ev);
  }

  private removeEvents(drop: (e: ChatEvent) => boolean) {
    this.state.events = this.state.events.filter((e) => !drop(e));
    this.emit({ type: 'init', state: this.state });
  }

  // Stops the current step so a waiting message runs now.
  async sendNow(id: string) {
    const held = this.queued.find((e) => e.id === id);
    if (held) {
      this.queued = this.queued.filter((e) => e !== held);
      this.removeEvents((e) => e === held);
      return this.steer(held.text);
    }
    if (!this.pending.some((e) => e.id === id) || this.state.session.stopping) return;
    await this.stop();
  }

  private async stop(cancelQueued = false) {
    this.setSession({ stopping: true });
    try {
      await this.driver.interrupt(cancelQueued);
      // A CLI stuck in a tool (such as a macOS privacy prompt) never ends the turn, so end the process.
      setTimeout(() => {
        if (!this.state.session.stopping) return;
        this.system('Claude did not stop, so its process was ended');
        this.driver.kill();
      }, STOP_TIMEOUT).unref?.();
    } catch (err) {
      this.setSession({ stopping: false });
      this.system(`Stop failed: ${String(err)}`);
    }
  }

  system(text: string) {
    this.pushEvent({ id: randomUUID(), kind: 'system', text, at: Date.now() });
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
  }

  fileChangedExternally(rel: string) {
    this.noteFile(rel, 'watcher');
  }

  watchHistory(on: boolean) {
    this.driver.watchHistory(on);
  }

  replaceHistory(h: History) {
    this.state.events = this.applyHistory(h);
    this.emit({ type: 'init', state: this.state });
  }

  close() {
    this.closed = true;
    this.runs.end(this.state.session.repeat?.runId, 'chat closed');
    this.runs.end(this.cycleRun, 'chat closed');
    this.repeater.stop();
    this.listeners.clear();
    this.approvals.denyAll();
    this.driver.close();
  }

  async loadHistory() {
    const h = await this.driver.loadHistory();
    if (h) this.state.events.push(...this.applyHistory(h));
  }

  private applyHistory({ events, context, cache }: History) {
    Object.assign(this.state.session, { context, cache, pr: prFrom(events) ?? this.state.session.pr });
    const kept = trimHistory(events);
    return [...kept, ...stopAgents(kept, this.orphans, Date.now())];
  }

  start() {
    this.driver.start();
  }

  async refreshUsage() {
    await this.driver.refreshUsage?.();
  }

  async refreshMcp() {
    const list = await this.driver.mcpStatus();
    if (list) this.setSession({ mcp: list });
  }

  async reconnectMcp(name: string) {
    await this.driver.reconnectMcp(name).catch((err) => this.system(`Reconnecting ${name} failed: ${errText(err)}`));
    await this.refreshMcp();
  }

  async toggleMcp(name: string, enabled: boolean) {
    await this.driver.toggleMcp(name, enabled).catch((err) => this.system(`${enabled ? 'Enabling' : 'Disabling'} ${name} failed: ${errText(err)}`));
    await this.refreshMcp();
  }

  async addMcp(name: string, def: unknown) {
    const r = await this.driver.addMcp(name, def);
    await this.refreshMcp();
    return r;
  }

  loginMcp(name: string) {
    return this.driver.loginMcp(name);
  }

  async setModel(model: string) {
    const r = await this.driver.setModel(model);
    this.setSession(r);
    this.system(r.team ? 'Team mode: Opus plans each task, Sonnet 5.5 builds it with Opus advising, Fable only with your OK' : `Model set to ${model}`);
  }

  async setEffort(level: string) {
    if (!EFFORT_LEVELS.includes(level as Effort)) return;
    await this.driver.setEffort(level as Effort);
    this.setSession({ effort: level as Effort });
    this.system(`Effort set to ${level}`);
  }

  setAccount(a: string) {
    const accounts = this.driver.accounts();
    if (!accounts.includes(a as Account)) return this.system('That Claude account is not logged in. Run ./claude-alt.sh first');
    if (this.state.session.running) return this.system('Stop Claude before switching account');
    if (a === this.driver.account) return;
    this.driver.setAccount(a as Account);
    this.setSession({ account: a as Account, accounts });
    const note = ACCOUNT_NOTE[a as Account];
    this.system(`Switched to the ${accountName(a as Account)} Claude account${note ? `. ${note}` : ''}`);
  }

  // A turn that ended on a usage limit goes on under the other account, if it has usage left.
  private failOver(until: number) {
    const from = this.driver.account;
    const to = this.limitHit(until);
    if (!to) return false;
    this.system(`Usage limit on the ${accountName(from)} account until ${clock(until)}, continuing on the ${accountName(to)} account`);
    this.sendPrompt(CONTINUE);
    return true;
  }

  private limitHit(until: number) {
    const to = this.driver.limitHit(until);
    if (to) this.setSession({ account: to, accounts: this.driver.accounts() });
    return to;
  }

  async setPermissionMode(mode: string) {
    await this.driver.setPermissionMode(mode);
    this.setSession({ permissionMode: mode });
    this.system(`Permission mode: ${mode}`);
  }

  canUseTool(toolName: string, input: Record<string, unknown>, opts: AskOptions) {
    return this.loopPlanDone(toolName, input, opts) ?? this.approvals.ask(toolName, input, opts);
  }

  ask(toolName: string, input: Record<string, unknown>, opts: AskOptions) {
    return this.approvals.ask(toolName, input, opts);
  }

  answerQuestion(id: string, answers: Record<string, string>) {
    this.approvals.answerQuestion(id, answers);
  }

  answerPermission(id: string, allow: boolean, always?: boolean) {
    this.approvals.answerPermission(id, allow, always);
  }

  eventById(id: string) {
    return this.index.get(id);
  }

  agentOf(toolUseId: string) {
    return this.index.agent(toolUseId);
  }

  blocked(toolUseId: string, tool: string, reason: string) {
    const use = this.index.get(toolUseId);
    const command = use?.kind === 'tool_use' && typeof use.input.command === 'string' ? use.input.command : '';
    if (tool === 'Bash' && !command) return;
    const rule = tool === 'Bash' && command ? `Bash(${command.replace(/[\\()]/g, '\\$&')})` : tool;
    this.pushEvent({ id: `${toolUseId}:blocked`, kind: 'blocked', rule, reason, allowed: false, at: Date.now() });
  }

  async allowBlocked(id: string) {
    const ev = this.index.get(id);
    if (ev?.kind !== 'blocked' || ev.allowed) return;
    const added = await this.driver.allow(ev.rule);
    for (const e of this.state.events) {
      if (e.kind === 'blocked' && e.rule === ev.rule && !e.allowed) {
        e.allowed = true;
        this.emit({ type: 'event', event: e });
      }
    }
    if (added) void this.prompt(`I allowed ${ev.rule} for this chat. Retry it.`);
  }

  reportFindings(input: unknown) {
    void saveFindings(this.cwd, this.reviewTarget ?? 'local', parseFindings(input)).then((review) => this.emit({ type: 'findings', review }), () => {});
  }

  notePr(toolUseId: string, text: string) {
    const pr = PR_URL.exec(text)?.[1];
    const use = pr ? this.index.get(toolUseId) : undefined;
    if (pr && use && createsPr(use)) this.setSession({ pr: Number(pr) });
  }

  sendPrompt(text: string, id: string = randomUUID(), mark?: { auto: 'loop' | 'goal'; round: number }) {
    this.pushEvent({ id, kind: 'user', text, at: Date.now(), ...mark });
    if (mark) this.roundTurn = true;
    this.enqueue(mark ? `${text}\n\n${ROUND_INSTRUCTION}` : text, id);
  }

  private startRun(r: Repeat) {
    const what = r.goal ?? r.prompt;
    return this.runs.start({ kind: r.goal ? 'goal' : 'loop', sessionId: this.state.session.sessionId ?? '', chatId: this.id, title: this.runTitle(what), what, round: r.round, max: r.goal && !r.every ? MAX_GOAL_ROUNDS : 0, nextAt: r.nextAt, ...(r.goal && r.every && { every: r.every }) });
  }

  // A restart keeps the run of a loop or goal; the chat has a new id.
  private resumeRun(r: Repeat) {
    const run = this.runs.get(r.runId);
    if (!run || run.state === 'done') return this.startRun(r);
    this.runs.update(run.id, { chatId: this.id });
    return run.id;
  }

  private runTitle(what: string) {
    return (this.title || what.split('\n')[0]).slice(0, 80);
  }

  private waitingOnUser(on: boolean) {
    for (const id of [this.state.session.repeat?.runId, this.cycleRun]) {
      const run = this.runs.get(id);
      if (on && run?.state === 'running') this.runs.update(id, { state: 'paused', why: WAITING });
      else if (!on && run?.why === WAITING) this.runs.update(id, { state: 'running', why: '' });
    }
  }

  // A client resends a message it got no echo for; the id tells a repeat from a new message.
  private known(id: string) {
    return this.index.get(id) !== undefined;
  }

  private enqueue(text: string, id?: string) {
    this.reviewTarget = reviewTarget(text) ?? this.reviewTarget;
    this.start();
    this.turns++;
    this.failed = false;
    this.setSession({ running: true });
    if (/^\/compact\b/.test(text.trim())) this.startCompacting();
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

  async interrupt() {
    if (!this.driver.attached || !this.state.session.running || this.state.session.stopping) return;
    this.planChange = null;
    if (looping(this.state.session.loop)) {
      this.setSession({ loop: { ...this.state.session.loop, phase: null } });
      this.endLoop('Build cycle stopped', 'you stopped it');
    }
    this.turns -= this.driver.dropInput();
    this.dropQueue();
    const dropped = new Set(this.pending.splice(0));
    if (dropped.size) this.removeEvents((e) => dropped.has(e as UserEvent));
    if (this.turns <= 0) {
      this.turns = 0;
      this.setSession({ running: false, compacting: false });
      this.repeater.defer();
      return;
    }
    await this.stop(true);
  }

  async stopTask(toolUseId: string) {
    if (await this.driver.stopTask(toolUseId)) return;
    const a = this.index.agent(toolUseId);
    if (!a || a.status !== 'running') return;
    if (this.driver.attached && this.state.session.running && !a.background) return this.interrupt();
    this.orphan([toolUseId]);
  }

  private orphan(ids: string[]) {
    for (const id of ids) this.orphans.add(id);
    for (const ev of stopAgents(this.state.events, ids, Date.now())) {
      this.emit({ type: 'event', event: this.index.agent((ev as { toolUseId: string }).toolUseId)! });
      this.pushEvent(ev);
    }
  }

  adopt(toolUseId: string) {
    this.orphans.delete(toolUseId);
  }

  private queue(text: string, id: string = randomUUID()) {
    this.hold(this.queued, text, id);
  }

  private dropQueue() {
    if (!this.queued.length) return;
    const ids = new Set(this.queued.map((e) => e.id));
    this.queued = [];
    this.removeEvents((e) => ids.has(e.id));
  }

  // Messages waiting behind a turn, saved when the host exits so a restart does not drop them.
  get queuedMessages() {
    return this.queued.map(({ id, text }) => ({ id, text }));
  }

  // Scheduled jobs live in the CLI process, so a new process has to create them again. The loop does not take this prompt as a task.
  restoreCrons(crons: Cron[], why = 'AgentView restarted') {
    this.crons = crons;
    this.system(`${why}, so Claude is recreating ${crons.length} scheduled ${crons.length === 1 ? 'job' : 'jobs'}`);
    this.promptOrQueue(restorePrompt(crons, why));
  }

  resumeStopped(stopped: Stopped) {
    this.promptOrQueue(resumePrompt(stopped));
  }

  private promptOrQueue(text: string) {
    if (this.state.session.running) this.queue(text);
    else this.sendPrompt(text);
  }

  restarted(why: string) {
    this.orphan(this.runningAgents());
    if (this.crons.length) this.restoreCrons(this.crons, why);
  }

  async prompt(text: string, id: string = randomUUID()) {
    if (this.known(id)) return;
    if (this.loopCommand(text, id)) return;
    if (this.state.session.running) return this.queue(text, id);
    if (!(await this.planFirst())) return this.queue(text, id);
    // Another prompt may have started a turn while plan mode was being set.
    if (this.state.session.running) return this.queue(text, id);
    const loop = this.state.session.loop;
    if (loop.on && !this.state.session.running && !text.trim().startsWith('/')) return this.startLoop(text, id);
    this.sendPrompt(text, id);
  }

  async retryLast() {
    const last = this.state.events.filter((e): e is UserEvent => e.kind === 'user').at(-1);
    if (!last || !last.text.trim() || last.text.trim().startsWith('/') || this.state.session.running) throw new Error('Nothing to retry');
    return this.prompt(last.text);
  }

  private loopCommand(text: string, id: string) {
    return this.repeater.command(text, () => this.pushEvent({ id, kind: 'user', text, at: Date.now() }));
  }

  setRepeat(r: Repeat | null, note?: string) {
    this.repeater.set(r, note);
  }

  holdRepeat() {
    this.repeater.hold();
  }

  resumeRepeat(r: Repeat) {
    this.repeater.resume(r);
  }

  runControl(run: string, op: RunOp) {
    if (this.cycleRun === run) return op === 'stop' ? this.setLoop(false) : undefined;
    if (op === 'restore') return this.repeater.restore(run);
    if (this.state.session.repeat?.runId !== run) return;
    if (op === 'pause') this.repeater.pause();
    else if (op === 'resume') this.repeater.unpause();
    else if (op === 'now') this.repeater.runNow();
    else if (op === 'stop') this.repeater.stopRun();
  }

  setLoop(on: boolean, max?: number) {
    if (!on) this.runs.end(this.cycleRun, 'you stopped it');
    const next = withLoop(this.state.session.loop, on, max);
    this.setSession({ loop: next });
    this.system(on ? `Build cycle on: Opus plans and builds, Sonnet tests, up to ${next.max} ${next.max === 1 ? 'round' : 'rounds'}` : 'Build cycle off');
  }

  restoreLoop(loop: LoopState) {
    if (!looping(loop)) return this.setSession({ loop });
    this.setSession({ loop: loopOff(loop.max) });
    this.system('Build cycle interrupted by a restart. Send a message to start it again.');
  }

  private async startLoop(task: string, id: string) {
    this.pushEvent({ id, kind: 'user', text: task, at: Date.now() });
    this.loopPrevModel = this.state.session.model;
    this.planDenied = false;
    this.setSession({ loop: { ...this.state.session.loop, round: 1, phase: 'plan' } });
    this.cycleRun = this.runs.start({ kind: 'cycle', sessionId: this.state.session.sessionId ?? '', chatId: this.id, title: this.runTitle(task), what: task, round: 1, max: this.state.session.loop.max });
    await this.runStep(planStep(task), false);
  }

  private async runStep(step: LoopStep, marker = true) {
    this.turns++;
    this.setSession({ running: true });
    try {
      if (this.state.session.model !== step.model) await this.setModel(step.model);
      if (this.state.session.permissionMode !== step.mode) await this.setPermissionMode(step.mode);
    } catch (err) {
      // Nothing was sent, so no turn will end and clear running; stop the loop here.
      this.setSession({ running: this.turns > 1, loop: { ...this.state.session.loop, phase: 'failed' } });
      this.endLoop(`Build cycle stopped: could not switch to the ${step.phase} step (${errText(err)})`);
      if (this.turns === 1) this.dequeue();
      return;
    } finally {
      // An exit during the switch already reset the count.
      this.turns = Math.max(0, this.turns - 1);
    }
    // Stop pressed while the model or mode was switching: send nothing.
    if (!looping(this.state.session.loop)) {
      if (this.turns === 0) this.setSession({ running: false, stopping: false });
      return;
    }
    if (marker) this.pushEvent({ id: randomUUID(), kind: 'user', text: step.label, at: Date.now(), phase: step.phase });
    this.enqueue(step.prompt);
  }

  private loopPlanDone(toolName: string, input: Record<string, unknown>, opts: AskOptions): Promise<Decision> | null {
    const plan = toolName === 'ExitPlanMode' && this.state.session.loop.phase === 'plan';
    if (plan && needsApproval(String(input.plan ?? ''))) {
      return this.approvals.ask(toolName, input, opts).then((d) => {
        this.planDenied = d.behavior === 'deny';
        return d;
      });
    }
    const allow = plan || toolName.endsWith('__set_status');
    return allow ? Promise.resolve({ behavior: 'allow' as const, updatedInput: input }) : null;
  }

  private endLoop(note: string | null, why = note?.replace(/^Build cycle (?:stopped|passed): /, '') ?? 'ended') {
    this.runs.end(this.cycleRun, why);
    this.cycleRun = undefined;
    this.setSession({ loop: { ...this.state.session.loop, on: false } });
    if (note) this.system(note);
    const model = this.loopPrevModel;
    this.loopPrevModel = null;
    if (model && model !== this.state.session.model) this.setModel(model).catch((err) => this.system(`Could not switch back to ${model}: ${errText(err)}`));
  }

  async steer(text: string, id: string = randomUUID()) {
    if (this.known(id)) return;
    if (this.loopCommand(text, id)) return;
    if (this.state.session.compacting) return this.queue(text, id);
    const running = this.state.session.running;
    const ev: UserEvent = { id, kind: 'user', text, at: Date.now(), stopping: running };
    this.pushEvent(ev);
    if (running) {
      this.release();
      this.approvals.denyAll('The user sent a new message instead of answering.');
      this.turns++;
      await this.driver.interrupt().catch(() => {});
      this.turns = Math.max(0, this.turns - 1);
      ev.stopping = false;
      this.emit({ type: 'event', event: ev });
    } else if (!(await this.planFirst())) {
      this.removeEvents((e) => e === ev);
      return this.queue(text, id);
    }
    this.enqueue(text, id);
  }

  changePlan(next: string[]) {
    this.pushEvent({ id: randomUUID(), kind: 'plan', next, at: Date.now() });
    const text = planChangeText(next);
    if (this.state.session.running) this.planChange = text;
    else this.sendPrompt(text);
  }

  takePlanChange() {
    const text = this.planChange;
    this.planChange = null;
    return text;
  }

  // A message that cannot start in plan mode waits in the queue, where Send now retries it.
  private async planFirst() {
    if (!this.state.session.team || this.state.session.permissionMode === 'plan') return true;
    try {
      await this.setPermissionMode('plan');
      return true;
    } catch (err) {
      this.system(`Could not switch to plan mode (${errText(err)}), so the message is queued`);
      return false;
    }
  }

  startCompacting() {
    this.setSession({ compacting: true });
    this.setStatus('Compacting the conversation');
  }

  compacted(pre: number, post: number | null | undefined) {
    this.setSession({ context: post ?? null, compacting: false });
    this.setStatus('Compacted');
    this.autoCompact = true;
    this.compactFailedAt = null;
    this.system(`Compacted from ${Math.round(pre / 1000)}k${post ? ` to ${Math.round(post / 1000)}k` : ''} tokens`);
    this.rearmWakeups();
  }

  compactFailed(error: string) {
    this.setSession({ compacting: false });
    this.compactFailedAt = this.state.session.context ?? 0;
    this.system(`Compact failed: ${error}`);
  }

  private rearmWakeups() {
    const since = Date.now();
    for (const c of this.crons.filter((x) => !x.recurring)) {
      const at = fireTime(c.schedule, since);
      if (at === null) continue;
      after(at + 5000, () => {
        if (this.closed || this.wokeAt > since || this.crons.some((x) => !x.recurring && x.prompt === c.prompt && x.schedule !== c.schedule)) return;
        // Each compaction arms its own check; the first to send counts as the wakeup for the rest.
        this.wokeAt = Date.now();
        this.system('Compacting dropped the scheduled wakeup, so AgentView sent it');
        void this.prompt(c.prompt);
      });
    }
  }

  turnStarted(why?: string) {
    this.wokeAt = Date.now();
    this.turns++;
    this.setSession({ running: true });
    if (this.expectTurn && !why) {
      this.expectTurn = false;
      return;
    }
    this.setStatus(why ?? 'Woke up for a scheduled or background task');
    const cron = !why && this.crons.length === 1 ? this.crons[0] : null;
    this.system(why ?? (cron ? `Claude woke up: ${cron.prompt.slice(0, 100)}` : 'Claude woke up on its own'));
  }

  noteLimit(text: string) {
    this.limitReset = limitReset(text) ?? this.limitReset;
  }

  // The turn was stopped before it ran on extra usage; it ends like one that hit the usage limit.
  overage(until: number) {
    if (this.limitReset) return;
    // A report while idle (a background agent) has no turn to end, so the account changes now.
    if (!this.state.session.running) {
      const from = this.driver.account;
      const to = this.limitHit(until);
      this.system(`Extra usage reported on the ${accountName(from)} account${to ? `, next turn runs on the ${accountName(to)} account` : ''}`);
      return;
    }
    this.limitReset = until;
    this.system(`Stopped before using extra usage on the ${accountName(this.driver.account)} account`);
  }

  turnResult(r: TurnResult) {
    // Before a switch to the other account the messages stay held, since the CLI that has them is replaced.
    if (this.pending.length && !this.limitReset) {
      this.expectTurn = true;
      this.release();
    }
    this.lastResult = r.ok ? r.text : '';
    this.lastError = !r.ok || Boolean(r.isError);
    this.failed = this.lastError;
    const repeat = this.state.session.repeat;
    const met = Boolean(repeat?.goal && goalMet(this.lastResult));
    this.turnCost = r.costUsd > 0 ? costRise(r.costUsd, this.lastCost) : 0;
    if (r.costUsd > 0) this.lastCost = r.costUsd;
    const report = this.reportTurn;
    this.roundNote = this.roundTurn && repeat?.runId ? { ...roundResult(r.text, { failed: this.lastError, met }), ends: met || this.repeater.ends() } : null;
    if (report && this.roundNote && !this.lastError && !met) this.roundNote.outcome = 'progress';
    this.roundTurn = false;
    this.reportTurn = undefined;
    this.pushEvent({ id: r.id, kind: 'result', text: r.text, costUsd: r.costUsd, isError: r.isError, at: Date.now(), model: this.state.session.model });
    if (repeat?.runId && this.roundNote) this.runs.addRound(repeat.runId, { n: repeat.round, outcome: this.roundNote.outcome, line: this.roundNote.line, costUsd: this.turnCost, ...(report && { report }) });
    if (repeat?.goal && met) this.repeater.set(null, `Goal met after ${repeat.round} ${repeat.round === 1 ? 'check' : 'checks'}: ${repeat.goal}`, 'goal met');
    this.turnEnded();
  }

  turnEnded() {
    this.turns = Math.max(0, this.turns - 1);
    const stopped = this.turns === 0 && this.state.session.stopping;
    const idle = this.turns === 0 && !this.state.session.stopping;
    if (idle && this.limitReset && this.failOver(this.limitReset)) {
      this.queued.unshift(...this.pending.splice(0));
      this.limitReset = null;
      this.setSession({ compacting: false });
      return;
    }
    if (this.pending.length && this.limitReset) {
      this.expectTurn = true;
      this.release();
    }
    const before = this.state.session.loop;
    const loop = idle ? advance(before, this.lastResult, { planDenied: this.planDenied, failed: this.lastError }) : null;
    if (loop) {
      this.setSession({ loop: loop.state });
      if (looping(before)) this.cycleRound(before, loop.state);
    }
    const next = idle && !loop?.step ? this.followUp() : null;
    this.setSession({ running: this.turns > 0 || next !== null || Boolean(loop?.step), compacting: false, stopping: false });
    if (loop && !loop.step && loop.note) this.endLoop(loop.note);
    if (loop?.step) void this.runStep(loop.step);
    else if (next) this.sendPrompt(next);
    else if (stopped) {
      // Messages typed while the stop was in flight go on in a fresh turn.
      this.dequeue();
      this.repeater.defer();
    } else if (idle && this.limitReset && this.state.session.repeat) this.repeater.defer(this.limitReset, 'Usage limit reached, loop round', true);
    else if (idle && this.limitReset) this.system(`Usage limit reached, resets at ${clock(this.limitReset)}`);
    else if (idle && this.lastError) this.repeater.defer();
    else if (idle && (this.repeater.due || this.state.session.repeat?.every === 0)) this.repeater.fire();
    // A turn that ends without a result (a local command) must not read the last one's.
    this.limitReset = null;
    this.lastResult = '';
    this.lastError = false;
    this.turnCost = 0;
  }

  private cycleRound(before: LoopState, after: LoopState) {
    const run = this.runs.get(this.cycleRun);
    if (!run) return;
    this.runs.addRound(run.id, { n: (run.rounds.at(-1)?.n ?? 0) + 1, ...phaseRound(before, this.lastResult, this.lastError), costUsd: this.turnCost });
    this.runs.update(run.id, { round: after.round });
  }

  // The agent process is gone; its queued input went with it, but the events stay.
  exited() {
    this.queued.unshift(...this.pending.splice(0));
    this.expectTurn = false;
    this.turns = 0;
    this.setSession({ running: false, stopping: false, compacting: false });
    this.planChange = null;
    this.approvals.denyAll('Claude exited before this was answered.');
    const repeat = this.state.session.repeat;
    if (this.roundTurn && repeat?.runId) this.runs.addRound(repeat.runId, { n: repeat.round, outcome: 'failed', line: 'Claude exited', costUsd: 0 });
    this.roundTurn = false;
    // No result comes for the step that was running, so the loop cannot advance.
    const loop = this.state.session.loop;
    if (looping(loop)) {
      this.setSession({ loop: { ...loop, phase: 'failed' } });
      this.endLoop(`Build cycle stopped: Claude exited during the ${loop.phase} step`);
    }
    // Queued messages are not lost with the process; the first one starts a fresh CLI.
    if (!this.dequeue()) this.repeater.defer();
    this.orphan(this.runningAgents());
  }

  private runningAgents() {
    return this.state.events.flatMap((e) => (e.kind === 'agent' && e.status === 'running' ? [e.toolUseId] : []));
  }

  private followUp() {
    const plan = this.takePlanChange();
    if (plan) return plan;
    const context = this.state.session.context ?? 0;
    if (!this.autoCompact && this.compactFailedAt !== null && context >= this.compactFailedAt + RETRY_COMPACT_GROWTH) {
      this.autoCompact = true;
      this.compactFailedAt = null;
    }
    if (this.autoCompact && context >= COMPACT_AT) {
      this.autoCompact = false;
      return '/compact';
    }
    this.dequeue();
    return null;
  }

  // The sent message and the ones still waiting move below the finished turn, in the order they were typed.
  private dequeue() {
    const ev = this.queued.shift();
    if (!ev) return false;
    ev.queued = false;
    ev.at = Date.now();
    const tail = new Set<ChatEvent>([ev, ...this.queued]);
    this.state.events = [...this.state.events.filter((e) => !tail.has(e)), ev, ...this.queued];
    this.emit({ type: 'init', state: this.state });
    this.enqueue(ev.text, ev.id);
    return true;
  }
}
