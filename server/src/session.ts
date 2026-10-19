import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { watch, type FSWatcher } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { query, getSessionMessages, getSubagentMessages, type McpServerConfig, type SessionMessage, type Query, type SDKMessage, type SDKUserMessage, type PermissionMode, type HookInput, type HookJSONOutput, type SessionCronSummary } from '@anthropic-ai/claude-agent-sdk';
import { COMPACT_AT, type ChatEvent, type ServerMessage, type ServerState, type SessionInfo } from '../../shared/protocol.js';
import { Approvals } from './approvals.js';
import { STATUS_REMINDER, TEAM, agentOptions, userMessage } from './options.js';
import { mcpFrom } from './mcp.js';
import { advance, loopOff, planStep, type LoopStep } from './loop.js';
import { ASYNC_LAUNCH, BIG_BRO, advisorEvent, cacheFrom, contextFrom, historyFrom, toolResultText, toolUseEvent } from './transcript.js';

export { BIG_BRO };

type McpAuth = { mcpAuthenticate(name: string): Promise<{ authUrl?: string; callbackPort?: number }> };

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const STATUS_EVERY = 8;
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
export function fireTime(schedule: string, now = Date.now()) {
  const [m, h, dom, mon] = schedule.trim().split(/\s+/).slice(0, 4).map(Number);
  if ([m, h, dom, mon].some((n) => !Number.isInteger(n))) return null;
  const at = new Date(new Date(now).getFullYear(), mon - 1, dom, h, m);
  if (at.getTime() < now - 60_000) at.setFullYear(at.getFullYear() + 1);
  return at.getTime();
}

const projectDir = (cwd: string) => path.join(CLAUDE_DIR, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));

async function subagentMessages(cwd: string, sessionId: string) {
  const dir = path.join(projectDir(cwd), sessionId, 'subagents');
  const files = await readdir(dir).catch(() => [] as string[]);
  const out: Record<string, SessionMessage[]> = {};
  await Promise.all(files.filter((f) => f.endsWith('.meta.json')).map(async (f) => {
    const meta = await readFile(path.join(dir, f), 'utf8').then(JSON.parse).catch(() => null);
    if (!meta?.toolUseId) return;
    out[meta.toolUseId] = await getSubagentMessages(sessionId, f.slice('agent-'.length, -'.meta.json'.length), { dir: cwd }).catch(() => []);
  }));
  return out;
}

// A retry message can point at a parent the CLI never saved; the SDK then drops everything before it.
export async function sessionMessages(sessionId: string, cwd: string) {
  const msgs = await getSessionMessages(sessionId, { dir: cwd });
  const first = msgs[0];
  if (!first) return msgs;
  const lines = (await readFile(path.join(projectDir(cwd), `${sessionId}.jsonl`), 'utf8').catch(() => '')).split('\n');
  const raw = lines.flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }).filter((e) => e.uuid && !e.isSidechain);
  const byId = new Map(raw.map((e) => [e.uuid, e]));
  let root = byId.get(first.uuid);
  while (root?.parentUuid && byId.has(root.parentUuid)) root = byId.get(root.parentUuid);
  if (!root?.parentUuid) return msgs;
  const before = raw.slice(0, raw.indexOf(root)).filter((e) => e.type === 'user' || e.type === 'assistant');
  return [...before.map((e) => ({ type: e.type, uuid: e.uuid, session_id: sessionId, message: e.message, parent_tool_use_id: null, parent_agent_id: null, timestamp: e.timestamp }) as SessionMessage), ...msgs];
}

const countAll = (subs: Record<string, SessionMessage[]>) => Object.values(subs).reduce((n, m) => n + m.length, 0);

export class AgentSession {
  private q: Query | null = null;
  private inputQueue: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private closed = false;
  private gen = 0;
  crons: SessionCronSummary[] = [];
  private wokeAt = 0;

  id = randomUUID();
  title = '';
  created = Date.now();
  state: ServerState;
  private listeners = new Set<(m: ServerMessage) => void>();
  private approvals: Approvals;

  private turns = 0;
  private planChange: string | null = null;
  private queued: Extract<ChatEvent, { kind: 'user' }>[] = [];
  private sinceStatus = 0;
  private autoCompact = true;
  private lastResult = '';
  private loopPrevModel: string | null = null;

  private liveText = new Map<string, string>();
  private edits = new Map<string, string>();
  private liveMsgId = '';

  private resumedAuto = false;
  private allowed: string[] = [];
  private mcpServers: Record<string, McpServerConfig> = {};
  private addedMcp: Record<string, McpServerConfig> = {};

  private transcript: FSWatcher | null = null;
  private transcriptTimer: NodeJS.Timeout | undefined;
  private seen = '';
  private seenSubs = 0;
  private restore: { model: string | null; team: boolean; permissionMode: string | null } | null = null;

  constructor(public cwd: string, private resume?: string) {
    this.state = {
      session: { id: this.id, sessionId: resume ?? null, model: null, team: false, cwd, running: false, permissionMode: 'auto', apiKeySource: null, models: [], commands: [], cache: null, context: null, compacting: false, stopping: false, mcp: [], loop: loopOff() },
      status: 'Idle',
      events: [],
      pending: [],
      recentFiles: [],
    };
    this.approvals = new Approvals(this.state, (m) => this.emit(m));
  }

  onMessage(fn: (m: ServerMessage) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(m: ServerMessage) {
    for (const l of this.listeners) l(m);
  }

  private pushEvent(ev: ChatEvent) {
    this.state.events.push(ev);
    this.emit({ type: 'event', event: ev });
  }

  private system(text: string) {
    this.pushEvent({ id: randomUUID(), kind: 'system', text, at: Date.now() });
  }

  private setStatus(text: string) {
    this.state.status = text;
    this.emit({ type: 'status', text });
    this.pushEvent({ id: randomUUID(), kind: 'status', text, at: Date.now() });
  }

  private setSession(patch: Partial<SessionInfo>) {
    const wasRunning = this.state.session.running;
    this.state.session = { ...this.state.session, ...patch };
    if (wasRunning && patch.running === false) setTimeout(() => void this.syncTranscript(true), 500);
    this.emit({ type: 'session', session: this.state.session });
  }

  private noteFile(rel: string, source: 'tool' | 'watcher') {
    this.state.recentFiles = [rel, ...this.state.recentFiles.filter((f) => f !== rel)].slice(0, 30);
    this.emit({ type: 'file_changed', path: rel, source });
  }

  fileChangedExternally(rel: string) {
    this.noteFile(rel, 'watcher');
  }

  watchTranscript(on: boolean) {
    const sessionId = this.state.session.sessionId;
    if (!on || !sessionId || this.closed) {
      this.transcript?.close();
      this.transcript = null;
      return;
    }
    if (this.transcript) return;
    try {
      this.transcript = watch(projectDir(this.cwd), { recursive: true }, (_, file) => {
        if (file && !file.startsWith(sessionId)) return;
        clearTimeout(this.transcriptTimer);
        this.transcriptTimer = setTimeout(() => void this.syncTranscript(false), 300);
      }).on('error', () => this.watchTranscript(false));
    } catch {
      return;
    }
    void this.syncTranscript(false);
  }

  private async syncTranscript(ownTurn: boolean) {
    const sessionId = this.state.session.sessionId;
    if (!sessionId || this.closed || this.state.session.running) return;
    const msgs = await sessionMessages(sessionId, this.cwd).catch(() => null);
    const subs = await subagentMessages(this.cwd, sessionId);
    const last = msgs?.filter((m) => m.type !== 'system').at(-1)?.uuid;
    if (!msgs || !last || this.state.session.running) return;
    const subsMoved = !this.q && countAll(subs) !== this.seenSubs;
    this.seenSubs = countAll(subs);
    if (last === this.seen && !subsMoved) return;
    if (last !== this.seen) {
      const baseline = ownTurn || !this.seen;
      this.seen = last;
      if (baseline) return;
    }
    const { events, context, cache } = historyFrom(msgs, subs);
    this.state.events = events;
    Object.assign(this.state.session, { context, cache });
    this.emit({ type: 'init', state: this.state });
    if (!this.q) return;
    const { model, team, permissionMode } = this.state.session;
    this.restore = { model, team, permissionMode };
    this.resume = sessionId;
    const q = this.q;
    this.q = null;
    this.gen++;
    this.wake?.();
    q.close();
  }

  close() {
    this.closed = true;
    this.watchTranscript(false);
    this.listeners.clear();
    this.approvals.denyAll();
    this.wake?.();
    this.q?.close();
  }

  async loadHistory() {
    if (!this.resume) return;
    const msgs = await sessionMessages(this.resume, this.cwd);
    const subs = await subagentMessages(this.cwd, this.resume);
    this.seen = msgs.filter((m) => m.type !== 'system').at(-1)?.uuid ?? '';
    this.seenSubs = countAll(subs);
    const { events, context, cache } = historyFrom(msgs, subs);
    this.state.events.push(...events);
    Object.assign(this.state.session, { context, cache });
  }

  start() {
    if (this.q || this.closed) return;
    const options = agentOptions({
      cwd: this.cwd,
      resume: this.resume,
      onStatus: (text) => this.setStatus(text),
      canUseTool: (toolName, input, opts) => this.loopPlanDone(toolName, input) ?? this.approvals.ask(toolName, input, opts),
      beforeAgent: (input, _id, { signal }) => this.confirmBigBro(input, signal),
      afterTool: async (input) => this.afterTool(input),
      onStop: async (input) => {
        if (input.hook_event_name === 'Stop' && !input.agent_id) this.crons = input.session_crons ?? [];
        return {};
      },
      mcp: this.addedMcp,
    });
    this.mcpServers = options.mcpServers ?? {};
    this.q = query({ prompt: this.inputStream(this.gen), options });
    if (this.restore) {
      const { model, team, permissionMode } = this.restore;
      this.restore = null;
      if (team) void this.q.applyFlagSettings({ advisorModel: TEAM.advisor }).catch(() => {});
      if (model) void this.q.setModel(model).catch(() => {});
      if (permissionMode) void this.q.setPermissionMode(permissionMode as PermissionMode).catch(() => {});
    }
    if (this.allowed.length) void this.q.applyFlagSettings({ permissions: { allow: this.allowed } }).catch(() => {});
    void this.consume();
    void this.loadMeta();
  }

  private async loadMeta() {
    if (!this.q) return;
    try {
      const [models, commands] = await Promise.all([this.q.supportedModels(), this.q.supportedCommands()]);
      this.setSession({
        models: [
          { value: 'team', displayName: 'Team: Opus plans, Sonnet builds', description: 'Opus plans each task, Sonnet 5.5 builds it with Opus advising. Fable only with your OK' },
          ...models.map((m) => ({ value: m.value, displayName: m.displayName, description: m.description })),
        ],
        commands: commands.map((c) => ({ name: c.name, description: c.description })),
      });
    } catch (err) {
      process.stderr.write(`loadMeta failed: ${String(err)}\n`);
    }
  }

  async refreshMcp() {
    const list = await this.q?.mcpServerStatus().catch(() => null);
    if (list) this.setSession({ mcp: mcpFrom(list) });
  }

  async reconnectMcp(name: string) {
    await this.q?.reconnectMcpServer(name).catch((err) => this.system(`Reconnecting ${name} failed: ${err instanceof Error ? err.message : String(err)}`));
    await this.refreshMcp();
  }

  async toggleMcp(name: string, enabled: boolean) {
    await this.q?.toggleMcpServer(name, enabled).catch((err) => this.system(`${enabled ? 'Enabling' : 'Disabling'} ${name} failed: ${err instanceof Error ? err.message : String(err)}`));
    await this.refreshMcp();
  }

  async addMcp(name: string, def: McpServerConfig) {
    this.start();
    this.addedMcp[name] = def;
    this.mcpServers = { ...this.mcpServers, [name]: def };
    const r = await this.q!.setMcpServers(this.mcpServers);
    await this.refreshMcp();
    return { error: r.errors[name] };
  }

  async loginMcp(name: string): Promise<{ authUrl?: string; callbackPort?: number }> {
    this.start();
    return (this.q as Query & McpAuth).mcpAuthenticate(name);
  }

  async setModel(model: string) {
    this.start();
    const team = model === 'team';
    if (team || this.state.session.team) await this.q?.applyFlagSettings({ advisorModel: team ? TEAM.advisor : null });
    await this.q?.setModel(team ? TEAM.model : model);
    this.setSession({ model: team ? TEAM.model : model, team });
    this.system(team ? 'Team mode: Opus plans each task, Sonnet 5.5 builds it with Opus advising, Fable only with your OK' : `Model set to ${model}`);
  }

  async setPermissionMode(mode: string) {
    this.start();
    await this.q?.setPermissionMode(mode as PermissionMode);
    this.setSession({ permissionMode: mode });
    this.system(`Permission mode: ${mode}`);
  }

  private async confirmBigBro(input: HookInput, signal: AbortSignal): Promise<HookJSONOutput> {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
    if (toolInput.subagent_type !== BIG_BRO) return {};
    const r = await this.approvals.ask(input.tool_name, toolInput, { signal, title: `Ask Fable: ${String(toolInput.description ?? 'a hard problem')}` });
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: r.behavior === 'allow' ? 'allow' : 'deny',
        permissionDecisionReason: r.behavior === 'allow' ? undefined : 'The user declined to ask Fable. Continue without it.',
      },
    };
  }

  answerQuestion(id: string, answers: Record<string, string>) {
    this.approvals.answerQuestion(id, answers);
  }

  answerPermission(id: string, allow: boolean, always?: boolean) {
    this.approvals.answerPermission(id, allow, always);
  }

  private blocked(toolUseId: string, tool: string, reason: string) {
    const use = this.state.events.find((e) => e.id === toolUseId);
    const command = use?.kind === 'tool_use' && typeof use.input.command === 'string' ? use.input.command : '';
    if (tool === 'Bash' && !command) return;
    const rule = tool === 'Bash' && command ? `Bash(${command.replace(/[\\()]/g, '\\$&')})` : tool;
    this.pushEvent({ id: `${toolUseId}:blocked`, kind: 'blocked', rule, reason, allowed: false, at: Date.now() });
  }

  async allowBlocked(id: string) {
    const ev = this.state.events.find((e) => e.id === id);
    if (ev?.kind !== 'blocked' || ev.allowed) return;
    this.start();
    this.allowed = [...new Set([...this.allowed, ev.rule])];
    await this.q?.applyFlagSettings({ permissions: { allow: this.allowed } });
    ev.allowed = true;
    this.emit({ type: 'event', event: ev });
    void this.prompt(`I allowed ${ev.rule} for this chat. Retry it.`);
  }

  private async *inputStream(gen: number): AsyncGenerator<SDKUserMessage> {
    while (!this.closed && gen === this.gen) {
      if (this.inputQueue.length === 0) {
        await new Promise<void>((r) => (this.wake = r));
        continue;
      }
      yield this.inputQueue.shift()!;
    }
  }

  sendPrompt(text: string) {
    this.pushEvent({ id: randomUUID(), kind: 'user', text, at: Date.now() });
    this.enqueue(text);
  }

  private enqueue(text: string) {
    this.start();
    this.turns++;
    this.setSession({ running: true });
    if (/^\/compact\b/.test(text.trim())) this.startCompacting();
    this.inputQueue.push(userMessage(text));
    this.wake?.();
  }

  async interrupt() {
    if (!this.q || !this.state.session.running || this.state.session.stopping) return;
    this.planChange = null;
    if (this.state.session.loop.phase && !['passed', 'failed'].includes(this.state.session.loop.phase)) {
      this.setSession({ loop: { ...this.state.session.loop, phase: null } });
      this.endLoop('Loop stopped');
    }
    this.turns -= this.inputQueue.length;
    this.inputQueue = [];
    this.dropQueue();
    if (this.turns <= 0) {
      this.turns = 0;
      this.setSession({ running: false, compacting: false });
      return;
    }
    this.setSession({ stopping: true });
    try {
      await this.q.interrupt();
    } catch (err) {
      this.setSession({ stopping: false });
      this.system(`Stop failed: ${String(err)}`);
    }
  }

  private queue(text: string, id: string = randomUUID()) {
    const ev: Extract<ChatEvent, { kind: 'user' }> = { id, kind: 'user', text, at: Date.now(), queued: true };
    this.queued.push(ev);
    this.pushEvent(ev);
  }

  private dropQueue() {
    if (!this.queued.length) return;
    const ids = new Set(this.queued.map((e) => e.id));
    this.queued = [];
    this.state.events = this.state.events.filter((e) => !ids.has(e.id));
    this.emit({ type: 'init', state: this.state });
  }

  restoreCrons(crons: SessionCronSummary[]) {
    this.crons = crons;
    this.system(`AgentView restarted, so Claude is recreating ${crons.length} scheduled ${crons.length === 1 ? 'job' : 'jobs'}`);
    void this.prompt(`AgentView restarted, which cleared your scheduled jobs. It is now ${new Date().toString()}. Recreate each job below with CronCreate, using the same cron, prompt and recurring flag. If a one-shot job's time has already passed, run its prompt now instead. Reply in one line.\n\n${JSON.stringify(crons.map(({ schedule, prompt, recurring }) => ({ cron: schedule, prompt, recurring })), null, 2)}`);
  }

  async prompt(text: string) {
    if (this.state.session.running) return this.queue(text);
    await this.planFirst();
    const loop = this.state.session.loop;
    if (loop.on && !this.state.session.running && !text.trim().startsWith('/')) return this.startLoop(text);
    this.sendPrompt(text);
  }

  setLoop(on: boolean, max?: number) {
    const loop = this.state.session.loop;
    const next = { ...loop, on, max: Math.min(9, Math.max(1, Math.round(max ?? loop.max))) };
    if (!on && loop.phase && !['passed', 'failed'].includes(loop.phase)) next.phase = null;
    this.setSession({ loop: next });
    this.system(on ? `Loop on: Opus plans and builds, Sonnet tests, up to ${next.max} ${next.max === 1 ? 'round' : 'rounds'}` : 'Loop off');
  }

  private async startLoop(task: string) {
    this.pushEvent({ id: randomUUID(), kind: 'user', text: task, at: Date.now() });
    this.loopPrevModel = this.state.session.model;
    this.setSession({ loop: { ...this.state.session.loop, round: 1, phase: 'plan' } });
    await this.runStep(planStep(task), false);
  }

  private async runStep(step: LoopStep, marker = true) {
    this.turns++;
    this.setSession({ running: true });
    try {
      if (this.state.session.model !== step.model) await this.setModel(step.model);
      if (this.state.session.permissionMode !== step.mode) await this.setPermissionMode(step.mode);
    } finally {
      this.turns--;
    }
    if (marker) this.pushEvent({ id: randomUUID(), kind: 'user', text: step.label, at: Date.now(), phase: step.phase });
    this.enqueue(step.prompt);
  }

  private loopPlanDone(toolName: string, input: Record<string, unknown>) {
    const loop = this.state.session.loop;
    if (toolName.endsWith('__set_status')) return Promise.resolve({ behavior: 'allow' as const, updatedInput: input });
    if (toolName !== 'ExitPlanMode' || loop.phase !== 'plan') return null;
    return Promise.resolve({ behavior: 'allow' as const, updatedInput: input });
  }

  private endLoop(note: string | null) {
    if (note) this.system(note);
    const model = this.loopPrevModel;
    this.loopPrevModel = null;
    if (model && model !== this.state.session.model) void this.setModel(model);
  }

  async steer(text: string, id: string = randomUUID()) {
    if (this.state.session.compacting) return this.queue(text, id);
    const running = this.state.session.running;
    const ev: Extract<ChatEvent, { kind: 'user' }> = { id, kind: 'user', text, at: Date.now(), stopping: running };
    this.pushEvent(ev);
    if (running) {
      this.turns++;
      await this.q?.interrupt().catch(() => {});
      this.turns--;
      ev.stopping = false;
      this.emit({ type: 'event', event: ev });
    } else await this.planFirst();
    this.enqueue(text);
  }

  changePlan(next: string[]) {
    this.pushEvent({ id: randomUUID(), kind: 'plan', next, at: Date.now() });
    const text = next.length
      ? `I changed your plan. The remaining steps are now:\n${next.map((s, i) => `${i + 1}. ${s}`).join('\n')}\nFollow this plan from here and update set_status to match.`
      : 'I removed the remaining steps of your plan. Finish the current step, then stop and tell me where things stand.';
    if (this.state.session.running) this.planChange = text;
    else this.sendPrompt(text);
  }

  afterTool(input: HookInput): HookJSONOutput {
    if (input.agent_id || input.hook_event_name !== 'PostToolUse') return {};
    const notes: string[] = [];
    if (this.planChange) notes.push(this.planChange);
    this.planChange = null;
    if (input.tool_name.endsWith('__set_status')) this.sinceStatus = 0;
    else if (++this.sinceStatus >= STATUS_EVERY) {
      this.sinceStatus = 0;
      notes.push(STATUS_REMINDER);
    }
    return notes.length ? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notes.join('\n\n') } } : {};
  }

  private async planFirst() {
    if (this.state.session.team && this.state.session.permissionMode !== 'plan') await this.setPermissionMode('plan');
  }

  private startCompacting() {
    this.setSession({ compacting: true });
    this.setStatus('Compacting the conversation');
  }

  private rearmWakeups() {
    const since = Date.now();
    for (const c of this.crons.filter((x) => !x.recurring)) {
      const at = fireTime(c.schedule, since);
      if (at === null) continue;
      setTimeout(() => {
        if (this.closed || this.wokeAt > since || this.crons.some((x) => !x.recurring && x.prompt === c.prompt && x.schedule !== c.schedule)) return;
        this.system('Compacting dropped the scheduled wakeup, so AgentView sent it');
        void this.prompt(c.prompt);
      }, Math.max(0, at - Date.now()) + 5000);
    }
  }

  private turnStartedByClaude() {
    this.wokeAt = Date.now();
    this.turns++;
    this.setSession({ running: true });
    this.setStatus('Woke up for a scheduled or background task');
    const cron = this.crons.length === 1 ? this.crons[0] : null;
    this.system(cron ? `Claude woke up: ${cron.prompt.slice(0, 100)}` : 'Claude woke up on its own');
  }

  private turnEnded() {
    this.turns = Math.max(0, this.turns - 1);
    const idle = this.turns === 0 && !this.state.session.stopping;
    const loop = idle ? advance(this.state.session.loop, this.lastResult) : null;
    if (loop) this.setSession({ loop: loop.state });
    const next = idle && !loop?.step ? this.followUp() : null;
    this.setSession({ running: this.turns > 0 || next !== null || Boolean(loop?.step), compacting: false, stopping: false });
    if (loop && !loop.step && loop.note) this.endLoop(loop.note);
    if (loop?.step) void this.runStep(loop.step);
    else if (next) this.sendPrompt(next);
  }

  private followUp() {
    if (this.planChange) {
      const text = this.planChange;
      this.planChange = null;
      return text;
    }
    if (this.autoCompact && (this.state.session.context ?? 0) >= COMPACT_AT) {
      this.autoCompact = false;
      return '/compact';
    }
    const ev = this.queued.shift();
    if (!ev) return null;
    ev.queued = false;
    ev.at = Date.now();
    this.state.events = [...this.state.events.filter((e) => e !== ev), ev];
    this.emit({ type: 'init', state: this.state });
    this.enqueue(ev.text);
    return null;
  }

  private async consume() {
    const q = this.q;
    if (!q) return;
    try {
      for await (const msg of q) this.handle(msg);
    } catch (err) {
      if (this.q === q) this.system(`Session error: ${String(err)}`);
    } finally {
      this.turns = 0;
      this.setSession({ running: false, stopping: false });
    }
  }

  private toolUse(block: { id: string; name: string; input: unknown }, parent?: string) {
    this.pushEvent(toolUseEvent(block.id, block.name, block.input, Date.now(), parent));
    const file = (block.input as { file_path?: unknown })?.file_path;
    if (EDIT_TOOLS.has(block.name) && typeof file === 'string') this.edits.set(block.id, file);
  }

  private handle(msg: SDKMessage) {
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          const changed = msg.model !== this.state.session.model;
          this.setSession({ sessionId: msg.session_id, model: msg.model, permissionMode: msg.permissionMode, apiKeySource: msg.apiKeySource, mcp: mcpFrom(msg.mcp_servers, msg.tools) });
          if (changed) this.system(`Session started with ${msg.model}`);
          if (this.resume && msg.permissionMode !== 'auto' && !this.resumedAuto) {
            this.resumedAuto = true;
            void this.q?.setPermissionMode('auto').then(() => this.setSession({ permissionMode: 'auto' }));
          }
          if (this.state.session.commands.length === 0) void this.loadMeta();
        } else if (msg.subtype === 'session_state_changed') {
          if (msg.state === 'running' && !this.state.session.running) this.turnStartedByClaude();
        } else if (msg.subtype === 'status') {
          if (msg.permissionMode) this.setSession({ permissionMode: msg.permissionMode });
          if (msg.status === 'compacting') this.startCompacting();
          if (msg.compact_result) this.setSession({ compacting: false });
          if (msg.compact_result === 'failed') this.system(`Compact failed: ${msg.compact_error || 'no reason given'}`);
        } else if (msg.subtype === 'compact_boundary') {
          const { pre_tokens, post_tokens } = msg.compact_metadata;
          this.setSession({ context: post_tokens ?? null, compacting: false });
          this.setStatus('Compacted');
          this.autoCompact = true;
          this.system(`Compacted from ${Math.round(pre_tokens / 1000)}k${post_tokens ? ` to ${Math.round(post_tokens / 1000)}k` : ''} tokens`);
          this.rearmWakeups();
        } else if (msg.subtype === 'permission_denied') {
          if (msg.decision_reason_type !== 'rule') this.blocked(msg.tool_use_id, msg.tool_name, msg.decision_reason || msg.message);
        } else if (msg.subtype === 'task_notification' && msg.tool_use_id) {
          this.pushEvent({ id: randomUUID(), kind: 'tool_result', toolUseId: msg.tool_use_id, text: msg.summary.slice(0, 4000), isError: msg.status === 'failed', at: Date.now() });
        } else if (msg.subtype === 'local_command_output') {
          this.pushEvent({ id: msg.uuid, kind: 'assistant', text: msg.content, streaming: false, at: Date.now() });
          this.turnEnded();
        }
        return;

      case 'stream_event': {
        if (msg.parent_tool_use_id) return;
        const ev = msg.event;
        if (ev.type === 'message_start') this.liveMsgId = ev.message.id;
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          const key = `${this.liveMsgId}:${ev.index}`;
          const text = (this.liveText.get(key) ?? '') + ev.delta.text;
          this.liveText.set(key, text);
          const existing = this.state.events.find((e) => e.id === key);
          if (existing && existing.kind === 'assistant') {
            existing.text = text;
            this.emit({ type: 'event', event: existing });
          } else {
            this.pushEvent({ id: key, kind: 'assistant', text, streaming: true, at: Date.now() });
          }
        }
        if (ev.type === 'content_block_stop') {
          const key = `${this.liveMsgId}:${ev.index}`;
          const existing = this.state.events.find((e) => e.id === key);
          if (existing && existing.kind === 'assistant') {
            existing.streaming = false;
            this.emit({ type: 'event', event: existing });
          }
          this.liveText.delete(key);
        }
        return;
      }

      case 'assistant': {
        const parent = msg.parent_tool_use_id ?? undefined;
        if (parent) {
          for (const block of msg.message.content) if (block.type === 'tool_use') this.toolUse(block, parent);
          return;
        }
        this.setSession({ cache: cacheFrom(msg.message.usage, Date.now(), this.state.session.cache), context: contextFrom(msg.message.usage) ?? this.state.session.context });
        for (const block of msg.message.content) {
          if (block.type === 'server_tool_use' && block.name === 'advisor') this.pushEvent(advisorEvent(block.id, Date.now()));
          if (block.type === 'tool_use') this.toolUse(block);
        }
        return;
      }

      case 'user': {
        const parent = msg.parent_tool_use_id ?? undefined;
        const content = msg.message.content;
        if (!Array.isArray(content)) return;
        for (const block of content) {
          if (block.type !== 'tool_result') continue;
          const edited = this.edits.get(block.tool_use_id);
          this.edits.delete(block.tool_use_id);
          if (edited && !block.is_error) this.noteFile(path.relative(this.cwd, edited), 'tool');
          const text = toolResultText(block);
          if (!parent && text.startsWith(ASYNC_LAUNCH)) continue;
          this.pushEvent({ id: randomUUID(), kind: 'tool_result', toolUseId: block.tool_use_id, text: text.slice(0, 4000), isError: Boolean(block.is_error), at: Date.now(), ...(parent && { parent }) });
        }
        return;
      }

      case 'result': {
        this.liveText.clear();
        this.lastResult = msg.subtype === 'success' ? msg.result : '';
        this.pushEvent({
          id: msg.uuid,
          kind: 'result',
          text: msg.subtype === 'success' ? msg.result : `Turn ended: ${msg.subtype}`,
          costUsd: msg.total_cost_usd,
          isError: msg.is_error,
          at: Date.now(),
        });
        this.turnEnded();
        return;
      }

      default:
        return;
    }
  }
}
