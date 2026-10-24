import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { watch, type FSWatcher } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { JsonlTail } from './tail.js';
import { query, getSessionMessages, getSubagentMessages, type McpServerConfig, type SessionMessage, type Query, type SDKMessage, type SDKUserMessage, type PermissionMode, type HookInput, type HookJSONOutput, type SessionCronSummary } from '@anthropic-ai/claude-agent-sdk';
import { COMPACT_AT, EFFORT_LEVELS, type AgentEvent, type AgentStatus, type ChatEvent, type Effort, type LoopState, type Repeat, type ServerMessage, type ServerState, type SessionInfo } from '../../shared/protocol.js';
import { Approvals } from './approvals.js';
import { STATUS_REMINDER, TEAM, agentOptions, userMessage } from './options.js';
import { inSettings, mcpFrom } from './mcp.js';
import { advance, loopOff, planStep, type LoopStep } from './loop.js';
import { USAGE, after, clock, describeLoop, limitReset, parseLoop } from './repeat.js';
import { parseFindings, reviewTarget, saveFindings } from './findings.js';
import { AGENT_TOOLS, ASYNC_LAUNCH, BIG_BRO, advisorEvent, agentEvent, usageFrom, finalText, handbackOf, liveReport, cacheFrom, contextFrom, historyFrom, noteLaunch, notificationResults, stopAgents, toolResultText, toolUseEvent, type AgentIds } from './transcript.js';

export { BIG_BRO };

type McpAuth = { mcpAuthenticate(name: string): Promise<{ authUrl?: string; callbackPort?: number }> };

const STREAM_FLUSH_MS = 80;
// A loop goes on after Stop or a CLI exit, with time to type /loop off first.
const REPEAT_GRACE_MS = 2 * 60_000;
const MIN_ROUND_MS = 60_000;
const MAX_EVENTS = 3000;
// A chat keeps its last few thousand events; the CLI transcript still has everything.
function trimHistory(events: ChatEvent[]) {
  if (events.length <= MAX_EVENTS) return events;
  const kept = events.slice(-MAX_EVENTS);
  return [{ id: randomUUID(), kind: 'system' as const, text: `${events.length - MAX_EVENTS} older events are not shown`, at: kept[0].at }, ...kept];
}

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

type SubFile = { sig: string; toolUseId: string; msgs: SessionMessage[] };

// Re-reads only the subagent transcripts whose file changed since the last call.
async function subagentMessages(cwd: string, sessionId: string, cache = new Map<string, SubFile>()) {
  const dir = path.join(projectDir(cwd), sessionId, 'subagents');
  const metas = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.meta.json'));
  let changed = false;
  await Promise.all(metas.map(async (f) => {
    const agentId = f.slice('agent-'.length, -'.meta.json'.length);
    const st = await stat(path.join(dir, `agent-${agentId}.jsonl`)).catch(() => null);
    const sig = st ? `${st.ino}:${st.size}:${st.mtimeMs}` : 'missing';
    const prev = cache.get(f);
    if (prev && prev.sig === sig) return;
    const toolUseId = prev?.toolUseId ?? (await readFile(path.join(dir, f), 'utf8').then(JSON.parse).catch(() => null))?.toolUseId;
    if (!toolUseId) return;
    let ok = true;
    const msgs = await getSubagentMessages(sessionId, agentId, { dir: cwd }).catch(() => ((ok = false), []));
    cache.set(f, { sig: ok ? sig : '', toolUseId, msgs });
    changed = true;
  }));
  for (const f of cache.keys()) if (!metas.includes(f)) (cache.delete(f), (changed = true));
  const subs: Record<string, SessionMessage[]> = {};
  for (const { toolUseId, msgs } of cache.values()) subs[toolUseId] = msgs;
  return { subs, changed };
}

// The SDK builds the conversation chain from the raw entries we already hold, so nothing is re-read from disk.
// A retry message can point at a parent the CLI never saved; the SDK then drops everything before it.
async function sessionMessages(sessionId: string, cwd: string, entries: any[]) {
  const msgs = await getSessionMessages(sessionId, { dir: cwd, sessionStore: { load: async () => entries, append: async () => {} } });
  const first = msgs[0];
  if (!first) return msgs;
  const raw = entries.filter((e) => e?.uuid && !e.isSidechain);
  const byId = new Map(raw.map((e) => [e.uuid, e]));
  let root = byId.get(first.uuid);
  while (root?.parentUuid && byId.has(root.parentUuid)) root = byId.get(root.parentUuid);
  if (!root?.parentUuid) return msgs;
  const before = raw.slice(0, raw.indexOf(root)).filter((e) => e.type === 'user' || e.type === 'assistant');
  return [...before.map((e) => ({ type: e.type, uuid: e.uuid, session_id: sessionId, message: e.message, parent_tool_use_id: null, parent_agent_id: null, timestamp: e.timestamp }) as SessionMessage), ...msgs];
}

const ENDED: Record<string, AgentStatus> = { completed: 'done', failed: 'failed', stopped: 'stopped', killed: 'stopped' };

const usageOf = (u: { total_tokens: number; tool_uses: number; duration_ms: number }) => ({ tokens: u.total_tokens, toolUses: u.tool_uses, durationMs: u.duration_ms });

const countAll = (subs: Record<string, SessionMessage[]>) => Object.values(subs).reduce((n, m) => n + m.length, 0);

const lastUuid = (msgs: SessionMessage[]) => msgs.filter((m) => m.type !== 'system').at(-1)?.uuid;

const looping = (loop: LoopState) => Boolean(loop.phase) && loop.phase !== 'passed' && loop.phase !== 'failed';

export class AgentSession {
  private q: Query | null = null;
  private inputQueue: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private closed = false;
  private gen = 0;
  crons: SessionCronSummary[] = [];
  private wokeAt = 0;
  private endedAt = 0;

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
  private repeatTimer: NodeJS.Timeout | undefined;
  // PR number or "local" of the last /code-review, so a ReportFindings call knows what it reviewed.
  private reviewTarget: string | null = null;
  private repeatDue = false;
  private roundAt = 0;
  private limitReset: number | null = null;
  private lastError = false;
  private repeatHeld = false;

  private live = new Map<string, Extract<ChatEvent, { kind: 'assistant' }>>();
  private liveFlush = new Map<string, ReturnType<typeof setTimeout>>();
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
  private log: JsonlTail | null = null;
  private subFiles = new Map<string, SubFile>();
  private dirty = true;
  private agents: AgentIds = new Map();
  private tasks = new Set<string>();
  private taskIds = new Map<string, string>();
  private orphans = new Set<string>();
  private restore: { model: string | null; team: boolean; permissionMode: string | null } | null = null;

  constructor(public cwd: string, private resume?: string) {
    this.state = {
      session: { id: this.id, sessionId: resume ?? null, model: null, effort: null, team: false, cwd, running: false, permissionMode: 'auto', apiKeySource: null, models: [], commands: [], cache: null, context: null, compacting: false, stopping: false, mcp: [], loop: loopOff(), repeat: null },
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
    if (this.state.events.length > MAX_EVENTS + 500) this.state.events = trimHistory(this.state.events);
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
    if (wasRunning && patch.running === false) {
      this.endedAt = Date.now();
      setTimeout(() => void this.syncTranscript(true), 500);
    }
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
      this.log = null;
      this.subFiles = new Map();
      this.dirty = true;
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
    const t = await this.readTranscript(sessionId).catch(() => null);
    if (!t || this.state.session.running) return;
    this.dirty ||= t.read !== 'same' || t.changed;
    if (!this.dirty) return;
    const { subs } = t;
    const msgs = await sessionMessages(sessionId, this.cwd, t.entries).catch(() => null);
    const last = msgs && lastUuid(msgs);
    if (!msgs || !last || this.state.session.running) return;
    this.dirty = false;
    const subsMoved = !this.q && countAll(subs) !== this.seenSubs;
    this.seenSubs = countAll(subs);
    if (last === this.seen && !subsMoved) return;
    if (last !== this.seen) {
      // The CLI's last transcript write lands just before `result`, so the watcher fires before the own-turn sync.
      const baseline = ownTurn || !this.seen || this.tasks.size > 0 || Date.now() - this.endedAt < 3000;
      this.seen = last;
      if (baseline) return;
    }
    this.state.events = this.applyHistory(msgs, subs);
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
    clearTimeout(this.repeatTimer);
    this.watchTranscript(false);
    this.listeners.clear();
    this.approvals.denyAll();
    this.wake?.();
    this.q?.close();
  }

  async loadHistory() {
    if (!this.resume) return;
    const { entries, subs } = await this.readTranscript(this.resume);
    const msgs = await sessionMessages(this.resume, this.cwd, entries);
    this.dirty = false;
    this.seen = lastUuid(msgs) ?? '';
    this.seenSubs = countAll(subs);
    this.state.events.push(...this.applyHistory(msgs, subs));
  }

  // Only bytes appended since the last read are parsed; unchanged subagent files are not re-read.
  private async readTranscript(sessionId: string) {
    const file = path.join(projectDir(this.cwd), `${sessionId}.jsonl`);
    if (this.log?.file !== file) {
      this.log = new JsonlTail(file);
      this.subFiles = new Map();
    }
    const log = this.log;
    const [read, { subs, changed }] = await Promise.all([log.read(), subagentMessages(this.cwd, sessionId, this.subFiles)]);
    return { read, entries: log.entries.slice(), subs, changed };
  }

  private applyHistory(msgs: SessionMessage[], subs: Record<string, SessionMessage[]>) {
    const { events, context, cache, agents } = historyFrom(msgs, subs);
    this.agents = agents;
    Object.assign(this.state.session, { context, cache });
    return trimHistory([...events, ...stopAgents(events, this.orphans, Date.now())]);
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
      effort: this.state.session.effort ?? undefined,
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
    if (await inSettings(this.cwd, name)) {
      await this.refreshMcp();
      return { error: undefined };
    }
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

  async setEffort(level: string) {
    if (!EFFORT_LEVELS.includes(level as Effort)) return;
    this.start();
    await this.q?.applyFlagSettings({ effortLevel: level as Effort });
    this.setSession({ effort: level as Effort });
    this.system(`Effort set to ${level}`);
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
    const known = this.allowed.includes(ev.rule);
    this.start();
    if (!known) {
      this.allowed = [...this.allowed, ev.rule];
      await this.q?.applyFlagSettings({ permissions: { allow: this.allowed } });
    }
    for (const e of this.state.events) {
      if (e.kind === 'blocked' && e.rule === ev.rule && !e.allowed) {
        e.allowed = true;
        this.emit({ type: 'event', event: e });
      }
    }
    if (!known) void this.prompt(`I allowed ${ev.rule} for this chat. Retry it.`);
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

  sendPrompt(text: string, id: string = randomUUID()) {
    this.pushEvent({ id, kind: 'user', text, at: Date.now() });
    this.enqueue(text);
  }

  // A client resends a message it got no echo for; the id tells a repeat from a new message.
  private known(id: string) {
    return this.state.events.some((e) => e.id === id);
  }

  private enqueue(text: string) {
    this.reviewTarget = reviewTarget(text) ?? this.reviewTarget;
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
    if (looping(this.state.session.loop)) {
      this.setSession({ loop: { ...this.state.session.loop, phase: null } });
      this.endLoop('Loop stopped');
    }
    this.turns -= this.inputQueue.length;
    this.inputQueue = [];
    this.dropQueue();
    if (this.turns <= 0) {
      this.turns = 0;
      this.setSession({ running: false, compacting: false });
      this.deferRepeat();
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

  async stopTask(toolUseId: string) {
    const id = this.taskIds.get(toolUseId) ?? [...this.agents].find(([, t]) => t === toolUseId)?.[0];
    if (id && this.q) {
      const live = this.tasks.has(id);
      const ok = await this.q.stopTask(id).then(() => true, () => false);
      if (ok && live) return;
    }
    const a = this.agentOf(toolUseId);
    if (!a || a.status !== 'running') return;
    if (this.q && this.state.session.running && !a.background) return this.interrupt();
    this.orphan([toolUseId]);
  }

  private orphan(ids: string[]) {
    for (const id of ids) this.orphans.add(id);
    for (const ev of stopAgents(this.state.events, ids, Date.now())) {
      this.emit({ type: 'event', event: this.agentOf((ev as { toolUseId: string }).toolUseId)! });
      this.pushEvent(ev);
    }
  }

  private agentOf(toolUseId: string) {
    return this.state.events.find((e): e is AgentEvent => e.kind === 'agent' && e.toolUseId === toolUseId);
  }

  // A SendMessage that resumes an agent carries its own tool id; follow the link back to the Agent call.
  private agentToolUse(toolUseId: string) {
    const link = this.state.events.find((e) => e.kind === 'tool_use' && e.id === toolUseId);
    return link?.kind === 'tool_use' && link.agent ? link.agent : toolUseId;
  }

  private taskToolUse(taskId: string) {
    return [...this.taskIds].find(([, t]) => t === taskId)?.[0] ?? this.agents.get(taskId);
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
    void this.prompt(`AgentView restarted. It is now ${new Date().toString()}. Your scheduled jobs are below. First run CronList: a job that is still listed survived the restart but will not fire, so CronDelete it. Then CronCreate each job below once, with the same cron, prompt and recurring flag, so exactly one copy exists. If a one-shot job's time has already passed, run its prompt now instead. Reply in one line.\n\n${JSON.stringify(crons.map(({ schedule, prompt, recurring }) => ({ cron: schedule, prompt, recurring })), null, 2)}`);
  }

  async prompt(text: string, id: string = randomUUID()) {
    if (this.known(id)) return;
    if (this.loopCommand(text, id)) return;
    if (this.state.session.running) return this.queue(text, id);
    await this.planFirst();
    const loop = this.state.session.loop;
    if (loop.on && !this.state.session.running && !text.trim().startsWith('/')) return this.startLoop(text, id);
    this.sendPrompt(text, id);
  }

  private loopCommand(text: string, id: string) {
    const parsed = parseLoop(text);
    if (!parsed) return false;
    this.pushEvent({ id, kind: 'user', text, at: Date.now() });
    if (parsed === 'usage') this.system(USAGE);
    else if (parsed === 'off') this.setRepeat(null, this.state.session.repeat ? 'Loop off' : 'No loop is running');
    else this.setRepeat(parsed);
    return true;
  }

  setRepeat(r: Repeat | null, note?: string) {
    clearTimeout(this.repeatTimer);
    this.repeatDue = false;
    this.setSession({ repeat: r });
    if (!r) return this.system(note ?? 'Loop off');
    this.system(`Loop on, ${describeLoop(r)}`);
    if (r.nextAt && r.nextAt > Date.now()) this.armRepeat();
    else this.fireRepeat();
  }

  // A back to back loop never goes idle, so a pending restart holds it; the restarted server resumes it.
  holdRepeat() {
    this.repeatHeld = true;
    clearTimeout(this.repeatTimer);
  }

  resumeRepeat(r: Repeat) {
    this.setSession({ repeat: r });
    this.system(`AgentView restarted, the loop continues ${describeLoop(r)}`);
    if (!r.nextAt || r.nextAt <= Date.now()) this.fireRepeat();
    else this.armRepeat();
  }

  private fireRepeat() {
    const r = this.state.session.repeat;
    if (!r || this.repeatHeld) return;
    if (r.until && Date.now() >= r.until) return this.setRepeat(null, `Loop finished at ${clock(r.until)} after ${r.round} ${r.round === 1 ? 'round' : 'rounds'}`);
    if (this.state.session.running) {
      this.repeatDue = true;
      return;
    }
    // A round that ended within a minute of starting did no work; wait before the next one instead of spinning.
    if (Date.now() - this.roundAt < MIN_ROUND_MS) return this.deferRepeat(this.roundAt + REPEAT_GRACE_MS);
    this.repeatDue = false;
    this.roundAt = Date.now();
    const round = r.round + 1;
    this.setSession({ repeat: { ...r, round, nextAt: r.every ? Date.now() + r.every : null } });
    this.armRepeat();
    this.system(`Loop round ${round}`);
    this.sendPrompt(r.prompt);
  }

  private armRepeat() {
    clearTimeout(this.repeatTimer);
    const r = this.state.session.repeat;
    const at = Math.min(r?.nextAt ?? Infinity, r?.until ?? Infinity);
    if (!r || at === Infinity) return;
    this.repeatTimer = after(at, () => this.fireRepeat());
  }

  setLoop(on: boolean, max?: number) {
    const loop = this.state.session.loop;
    const next = { ...loop, on, max: Math.min(9, Math.max(1, Math.round(max ?? loop.max))) };
    if (!on && looping(loop)) next.phase = null;
    this.setSession({ loop: next });
    this.system(on ? `Loop on: Opus plans and builds, Sonnet tests, up to ${next.max} ${next.max === 1 ? 'round' : 'rounds'}` : 'Loop off');
  }

  private async startLoop(task: string, id: string) {
    this.pushEvent({ id, kind: 'user', text: task, at: Date.now() });
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
    const allow = toolName.endsWith('__set_status') || (toolName === 'ExitPlanMode' && this.state.session.loop.phase === 'plan');
    return allow ? Promise.resolve({ behavior: 'allow' as const, updatedInput: input }) : null;
  }

  private endLoop(note: string | null) {
    if (note) this.system(note);
    const model = this.loopPrevModel;
    this.loopPrevModel = null;
    if (model && model !== this.state.session.model) void this.setModel(model);
  }

  async steer(text: string, id: string = randomUUID()) {
    if (this.known(id)) return;
    if (this.loopCommand(text, id)) return;
    if (this.state.session.compacting) return this.queue(text, id);
    const running = this.state.session.running;
    const ev: Extract<ChatEvent, { kind: 'user' }> = { id, kind: 'user', text, at: Date.now(), stopping: running };
    this.pushEvent(ev);
    if (running) {
      this.approvals.denyAll('The user sent a new message instead of answering.');
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
      after(at + 5000, () => {
        if (this.closed || this.wokeAt > since || this.crons.some((x) => !x.recurring && x.prompt === c.prompt && x.schedule !== c.schedule)) return;
        this.system('Compacting dropped the scheduled wakeup, so AgentView sent it');
        void this.prompt(c.prompt);
      });
    }
  }

  private turnStartedByClaude(why?: string) {
    this.wokeAt = Date.now();
    this.turns++;
    this.setSession({ running: true });
    this.setStatus(why ?? 'Woke up for a scheduled or background task');
    const cron = !why && this.crons.length === 1 ? this.crons[0] : null;
    this.system(why ?? (cron ? `Claude woke up: ${cron.prompt.slice(0, 100)}` : 'Claude woke up on its own'));
  }

  private turnEnded() {
    this.turns = Math.max(0, this.turns - 1);
    const stopped = this.turns === 0 && this.state.session.stopping;
    const idle = this.turns === 0 && !this.state.session.stopping;
    const loop = idle ? advance(this.state.session.loop, this.lastResult) : null;
    if (loop) this.setSession({ loop: loop.state });
    const next = idle && !loop?.step ? this.followUp() : null;
    this.setSession({ running: this.turns > 0 || next !== null || Boolean(loop?.step), compacting: false, stopping: false });
    if (loop && !loop.step && loop.note) this.endLoop(loop.note);
    if (loop?.step) void this.runStep(loop.step);
    else if (next) this.sendPrompt(next);
    else if (stopped) {
      // Messages typed while the stop was in flight go on in a fresh turn.
      this.dequeue();
      this.deferRepeat();
    } else if (idle && this.limitReset && this.state.session.repeat) this.deferRepeat(this.limitReset, 'Usage limit reached, loop round');
    else if (idle && this.limitReset) this.system(`Usage limit reached, resets at ${clock(this.limitReset)}`);
    else if (idle && this.lastError) this.deferRepeat();
    else if (idle && (this.repeatDue || this.state.session.repeat?.every === 0)) this.fireRepeat();
    this.limitReset = null;
  }

  // A round that failed waits before the next one, so a loop never spins on an error.
  private deferRepeat(until = Date.now() + REPEAT_GRACE_MS, why = 'Loop round') {
    const r = this.state.session.repeat;
    if (!r) return;
    this.repeatDue = false;
    const nextAt = Math.max(r.nextAt ?? 0, until);
    this.setSession({ repeat: { ...r, nextAt } });
    this.armRepeat();
    this.system(`${why} ${r.round + 1} at ${clock(nextAt)}, /loop off to end it`);
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
    this.enqueue(ev.text);
    return true;
  }

  private async consume() {
    const q = this.q;
    if (!q) return;
    try {
      for await (const msg of q) this.handle(msg);
    } catch (err) {
      if (this.q === q) this.system(`Session error: ${String(err)}`);
    } finally {
      if (this.q === q) {
        // The CLI is gone; drop it so the next prompt resumes the session in a fresh process.
        const { model, team, permissionMode, sessionId } = this.state.session;
        this.restore = { model, team, permissionMode };
        this.resume = sessionId ?? this.resume;
        this.q = null;
        this.gen++;
        this.inputQueue = [];
        this.wake?.();
        this.turns = 0;
        this.setSession({ running: false, stopping: false, compacting: false });
        this.planChange = null;
        this.approvals.denyAll('Claude exited before this was answered.');
        this.tasks.clear();
        // Queued messages are not lost with the process; the first one starts a fresh CLI.
        if (!this.dequeue()) this.deferRepeat();
        this.orphan(this.state.events.flatMap((e) => (e.kind === 'agent' && e.status === 'running' ? [e.toolUseId] : [])));
      }
    }
  }

  private toolUse(block: { id: string; name: string; input: unknown }, parent?: string) {
    this.pushEvent(toolUseEvent(block.id, block.name, block.input, Date.now(), parent, this.agents));
    if (AGENT_TOOLS.has(block.name)) this.pushEvent(agentEvent(block.id, block.input, Date.now(), parent));
    if (block.name === 'ReportFindings') void saveFindings(this.cwd, this.reviewTarget ?? 'local', parseFindings(block.input)).then((review) => this.emit({ type: 'findings', review }), () => {});
    const file = (block.input as { file_path?: unknown })?.file_path;
    if (EDIT_TOOLS.has(block.name) && typeof file === 'string') this.edits.set(block.id, file);
  }

  private patchAgent(toolUseId: string, patch: (a: AgentEvent) => Partial<AgentEvent>) {
    const a = this.agentOf(toolUseId);
    if (!a) return;
    const next = patch(a);
    if (Object.entries(next).every(([k, v]) => JSON.stringify(a[k as keyof AgentEvent]) === JSON.stringify(v))) return;
    Object.assign(a, next);
    this.emit({ type: 'event', event: a });
  }

  private agentResult(toolUseId: string, text: string, isError: boolean, output: any) {
    const model = typeof output?.resolvedModel === 'string' ? { model: output.resolvedModel as string } : {};
    if (text.startsWith(ASYNC_LAUNCH)) return this.patchAgent(toolUseId, () => ({ background: true, ...model }));
    const usage = typeof output?.totalTokens === 'number' ? { tokens: output.totalTokens, toolUses: output.totalToolUseCount ?? 0, durationMs: output.totalDurationMs ?? 0 } : usageFrom(text);
    this.patchAgent(toolUseId, (a) => ({ status: isError ? 'failed' : 'done', endedAt: Date.now(), ...model, ...(usage ? { usage } : { usage: a.usage }) }));
  }

  private isAgent(toolUseId: string) {
    const use = this.state.events.find((e) => e.id === toolUseId);
    return use?.kind === 'tool_use' && AGENT_TOOLS.has(use.name);
  }

  private taskDone(toolUseId: string, taskId: string, status: 'completed' | 'failed' | 'stopped', summary: string) {
    const last = [...this.state.events].reverse().find((e) => e.kind === 'tool_result' && e.toolUseId === toolUseId);
    if (last && !this.resumed(toolUseId, last.at)) return;
    const ev: Extract<ChatEvent, { kind: 'tool_result' }> = { id: randomUUID(), kind: 'tool_result', toolUseId, text: summary, isError: status === 'failed', at: Date.now(), ...(status === 'stopped' && { stopped: true }) };
    this.pushEvent(ev);
    const sessionId = this.state.session.sessionId;
    if (!sessionId || !this.isAgent(toolUseId) || status !== 'completed') return;
    const agentId = [...this.agents].find(([, t]) => t === toolUseId)?.[0] ?? taskId;
    void getSubagentMessages(sessionId, agentId, { dir: this.cwd }).catch(() => []).then((sub) => {
      const text = handbackOf(sub) ?? finalText(sub);
      if (!text) return;
      ev.text = text;
      this.emit({ type: 'event', event: ev });
    });
  }

  private resumed(toolUseId: string, since: number) {
    return this.state.events.some((e) => e.kind === 'tool_use' && e.agent === toolUseId && e.at > since);
  }

  private handle(msg: SDKMessage) {
    // Turns the CLI starts by itself (a subagent handing back, a scheduled job) come without a prompt from us.
    if (!this.state.session.running && (msg.type === 'assistant' || msg.type === 'stream_event') && !msg.parent_tool_use_id) this.turnStartedByClaude('Claude continued after a background task');
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
        } else if (msg.subtype === 'task_started') {
          this.tasks.add(msg.task_id);
          if (msg.tool_use_id) {
            const toolUseId = this.agentToolUse(msg.tool_use_id);
            this.taskIds.set(toolUseId, msg.task_id);
            this.orphans.delete(toolUseId);
            this.patchAgent(toolUseId, (a) => ({
              status: 'running',
              background: msg.is_backgrounded ?? a.background,
              prompt: msg.prompt || a.prompt,
              subagentType: msg.subagent_type || a.subagentType,
              ...(a.status !== 'running' && { startedAt: Date.now(), endedAt: null }),
            }));
          }
        } else if (msg.subtype === 'task_progress') {
          if (msg.tool_use_id) this.patchAgent(this.agentToolUse(msg.tool_use_id), (a) => ({ usage: usageOf(msg.usage), progress: msg.summary || a.progress }));
        } else if (msg.subtype === 'task_updated') {
          if (msg.patch.status && !['pending', 'running', 'paused'].includes(msg.patch.status)) this.tasks.delete(msg.task_id);
          const toolUseId = this.taskToolUse(msg.task_id);
          const { status, end_time, is_backgrounded } = msg.patch;
          if (toolUseId) this.patchAgent(toolUseId, () => ({
            ...(status && ENDED[status] && { status: ENDED[status], endedAt: end_time ?? Date.now() }),
            ...(is_backgrounded !== undefined && { background: is_backgrounded }),
          }));
        } else if (msg.subtype === 'task_notification') {
          this.tasks.delete(msg.task_id);
          const toolUseId = msg.tool_use_id ? this.agentToolUse(msg.tool_use_id) : this.taskToolUse(msg.task_id);
          if (toolUseId) {
            const usage = msg.usage && usageOf(msg.usage);
            this.patchAgent(toolUseId, (a) => ({ status: ENDED[msg.status], endedAt: a.status === 'running' ? Date.now() : a.endedAt ?? Date.now(), usage: usage || a.usage }));
            this.taskDone(toolUseId, msg.task_id, msg.status, msg.summary);
          }
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
          const live = this.live.get(key);
          if (!live) {
            const e = { id: key, kind: 'assistant' as const, text: ev.delta.text, streaming: true, at: Date.now() };
            this.live.set(key, e);
            this.pushEvent(e);
          } else {
            live.text += ev.delta.text;
            if (!this.liveFlush.has(key)) {
              this.liveFlush.set(key, setTimeout(() => {
                this.liveFlush.delete(key);
                this.emit({ type: 'event', event: live });
              }, STREAM_FLUSH_MS));
            }
          }
        }
        if (ev.type === 'content_block_stop') {
          const key = `${this.liveMsgId}:${ev.index}`;
          const live = this.live.get(key);
          if (live) {
            clearTimeout(this.liveFlush.get(key));
            this.liveFlush.delete(key);
            live.streaming = false;
            this.emit({ type: 'event', event: live });
          }
          this.live.delete(key);
        }
        return;
      }

      case 'assistant': {
        const parent = msg.parent_tool_use_id ?? undefined;
        if (parent) {
          const model = msg.message.model;
          if (model) this.patchAgent(parent, () => ({ model }));
          for (const block of msg.message.content) {
            if (block.type === 'text' && block.text.trim()) this.pushEvent({ id: randomUUID(), kind: 'assistant', text: block.text, streaming: false, at: Date.now(), parent });
            if (block.type === 'tool_use') this.toolUse(block, parent);
          }
          return;
        }
        this.setSession({ cache: cacheFrom(msg.message.usage, Date.now(), this.state.session.cache), context: contextFrom(msg.message.usage) ?? this.state.session.context });
        for (const block of msg.message.content) {
          if (block.type === 'server_tool_use' && block.name === 'advisor') this.pushEvent(advisorEvent(block.id, Date.now()));
          if (block.type === 'tool_use') this.toolUse(block);
          if (block.type === 'text') this.limitReset = limitReset(block.text) ?? this.limitReset;
        }
        return;
      }

      case 'user': {
        const parent = msg.parent_tool_use_id ?? undefined;
        const content = msg.message.content;
        if (typeof content === 'string' && content.startsWith('<task-notification>')) for (const ev of notificationResults(content, Date.now(), this.agents)) this.pushEvent(ev);
        if (!Array.isArray(content)) return;
        const output = (msg as { tool_use_result?: unknown }).tool_use_result;
        for (const block of content) {
          if (block.type !== 'tool_result') continue;
          const edited = this.edits.get(block.tool_use_id);
          this.edits.delete(block.tool_use_id);
          if (edited && !block.is_error) this.noteFile(path.relative(this.cwd, edited), 'tool');
          const text = toolResultText(block);
          const agent = this.isAgent(block.tool_use_id);
          if (agent) this.agentResult(block.tool_use_id, text, Boolean(block.is_error), output);
          if (!parent && text.startsWith(ASYNC_LAUNCH)) {
            noteLaunch(this.agents, block.tool_use_id, text);
            continue;
          }
          const report = agent ? liveReport(text, output) : text.slice(0, 4000);
          this.pushEvent({ id: randomUUID(), kind: 'tool_result', toolUseId: block.tool_use_id, text: report, isError: Boolean(block.is_error), at: Date.now(), ...(parent && { parent }) });
        }
        return;
      }

      case 'result': {
        for (const t of this.liveFlush.values()) clearTimeout(t);
        this.liveFlush.clear();
        this.live.clear();
        this.lastResult = msg.subtype === 'success' ? msg.result : '';
        this.lastError = msg.subtype !== 'success' || Boolean(msg.is_error);
        if (msg.subtype === 'success') this.limitReset = limitReset(msg.result) ?? this.limitReset;
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
