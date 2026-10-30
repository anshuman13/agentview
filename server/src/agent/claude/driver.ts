import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { watch, type FSWatcher } from 'node:fs';
import { query, type McpServerConfig, type Query, type SDKMessage, type SDKUserMessage, type PermissionMode, type PermissionResult, type HookInput, type HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import type { Account, AgentEvent, ChatEvent, Effort } from '../../../../shared/protocol.js';
import type { AgentDriver, AgentHost, History } from '../types.js';
import { AgentSession } from '../../session/session.js';
import { JsonlTail } from './tail.js';
import { STATUS_REMINDER, TEAM, agentOptions, userMessage } from './options.js';
import { inSettings, mcpFrom } from './mcp.js';
import { configDir, hasAlt, markLimited, otherAccount, overageUntil, reopenAccount } from './accounts.js';
import { countAll, lastUuid, projectDir, sessionMessages, subagentMessages, type SubFile } from './history.js';
import { bigBroRequest, bigBroVerdict } from './approval.js';
import { ENDED, replayText, usageOf } from './tasks.js';
import { agentResult, agentToolUse, isAgent, patchAgent, taskDone, taskToolUse } from './subagents.js';
import { sessionUsage } from './usage.js';
import { AGENT_TOOLS, ASYNC_LAUNCH, advisorEvent, agentEvent, finalText, handbackOf, liveReport, cacheFrom, contextFrom, historyFrom, noteLaunch, notificationResults, toolResultText, toolUseEvent, type AgentIds } from './transcript.js';

type McpAuth = { mcpAuthenticate(name: string): Promise<{ authUrl?: string; callbackPort?: number }> };

const STREAM_FLUSH_MS = 80;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const STATUS_EVERY = 8;

export const claudeSession = (cwd: string, resume?: string, fork = false, account = reopenAccount(resume)) => new AgentSession(cwd, (host) => new ClaudeDriver(host, resume, fork, account), resume ?? null);

// Runs a chat on the Claude Agent SDK: one CLI process at a time, resumed from its transcript when it exits.
export class ClaudeDriver implements AgentDriver {
  readonly capabilities = { rewind: true, mcp: true, effort: true, team: true, stopTask: true };
  private q: Query | null = null;
  private inputQueue: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private closed = false;
  private gen = 0;
  private endedAt = 0;
  private sinceStatus = 0;

  private live = new Map<string, Extract<ChatEvent, { kind: 'assistant' }>>();
  private liveFlush = new Map<string, ReturnType<typeof setTimeout>>();
  private edits = new Map<string, string>();
  private liveMsgId = '';

  private resumedAuto = false;
  private allowed: string[] = [];
  private mcpServers: Record<string, McpServerConfig> = {};
  private addedMcp: Record<string, McpServerConfig> = {};

  private transcript: FSWatcher | null = null;
  private watchedId: string | undefined;
  private transcriptTimer: NodeJS.Timeout | undefined;
  private seen = '';
  private seenSubs = 0;
  private log: JsonlTail | null = null;
  private subFiles = new Map<string, SubFile>();
  private dirty = true;
  private agents: AgentIds = new Map();
  private tasks = new Set<string>();
  private sent: { id: string; text: string }[] = [];
  private rewindIds = new Map<string, string>();
  private taskIds = new Map<string, string>();
  private restore: { model: string | null; team: boolean; permissionMode: string | null } | null = null;

  constructor(private host: AgentHost, private resume?: string, private fork = false, public account: Account = 'main') {}

  accounts(): Account[] {
    return hasAlt() ? ['main', 'alt'] : ['main'];
  }

  setAccount(a: Account) {
    if (a === this.account) return;
    this.account = a;
    this.host.setSession({ usage: null });
    if (!this.q) return;
    // Started again at once so the new account's usage shows before the next prompt.
    this.restart();
    this.start();
  }

  limitHit(until: number) {
    markLimited(this.account, until);
    const next = otherAccount(this.account);
    if (next) this.setAccount(next);
    return next;
  }

  // Ends the CLI process; the next prompt resumes the session in a fresh one with the same settings.
  private restart() {
    const q = this.q!;
    const { model, team, permissionMode, sessionId } = this.state.session;
    this.restore = { model, team, permissionMode };
    this.resume = sessionId ?? this.resume;
    this.q = null;
    this.gen++;
    this.wake?.();
    this.endLive();
    q.close();
  }

  get attached() {
    return this.q !== null;
  }

  private get state() {
    return this.host.state;
  }

  private get cwd() {
    return this.host.cwd;
  }

  watchHistory(on: boolean) {
    const sessionId = this.state.session.sessionId;
    if (!on || !sessionId || this.closed) {
      this.transcript?.close();
      this.transcript = null;
      this.log = null;
      this.subFiles = new Map();
      this.dirty = true;
      return;
    }
    if (this.transcript && this.watchedId === sessionId) return;
    // A new session id (after /clear) needs a watcher on its own transcript.
    this.transcript?.close();
    this.watchedId = sessionId;
    try {
      this.transcript = watch(projectDir(this.cwd), { recursive: true }, (_, file) => {
        if (file && !file.startsWith(sessionId)) return;
        clearTimeout(this.transcriptTimer);
        this.transcriptTimer = setTimeout(() => void this.syncTranscript(false), 300);
      }).on('error', () => this.watchHistory(false));
    } catch {
      return;
    }
    void this.syncTranscript(false);
  }

  settled() {
    this.endedAt = Date.now();
    void this.loadUsage();
    setTimeout(() => void this.syncTranscript(true), 500);
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
    this.host.replaceHistory(this.history(msgs, subs));
    if (this.q) this.restart();
  }

  close() {
    this.closed = true;
    this.watchHistory(false);
    this.wake?.();
    this.q?.close();
  }

  async loadHistory() {
    if (!this.resume) return null;
    const { entries, subs } = await this.readTranscript(this.resume);
    const msgs = await sessionMessages(this.resume, this.cwd, entries);
    this.dirty = false;
    this.seen = lastUuid(msgs) ?? '';
    this.seenSubs = countAll(subs);
    return this.history(msgs, subs);
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

  private history(...args: Parameters<typeof historyFrom>): History {
    const { events, context, cache, agents } = historyFrom(...args);
    this.agents = agents;
    return { events, context, cache };
  }

  start() {
    if (this.q || this.closed) return;
    const options = agentOptions({
      cwd: this.cwd,
      resume: this.resume,
      onStatus: (text) => this.host.setStatus(text),
      chat: () => this.state.session.sessionId,
      canUseTool: (toolName, input, opts) => this.host.canUseTool(toolName, input, opts) as Promise<PermissionResult>,
      beforeAgent: (input, _id, { signal }) => this.confirmBigBro(input, signal),
      afterTool: async (input) => this.afterTool(input),
      onStop: async (input) => {
        if (input.hook_event_name === 'Stop' && !input.agent_id) this.host.crons = input.session_crons ?? [];
        return {};
      },
      mcp: this.addedMcp,
      effort: this.state.session.effort ?? undefined,
      fork: this.fork,
      configDir: configDir(this.account),
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
    void this.loadUsage();
  }

  private async loadMeta() {
    if (!this.q) return;
    try {
      const [models, commands] = await Promise.all([this.q.supportedModels(), this.q.supportedCommands()]);
      this.host.setSession({
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

  private async loadUsage() {
    const q = this.q;
    if (!q) return;
    try {
      const u = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
      if (q === this.q) this.host.setSession({ usage: sessionUsage(u) });
    } catch (err) {
      process.stderr.write(`loadUsage failed: ${String(err)}\n`);
    }
  }

  async mcpStatus() {
    const list = await this.q?.mcpServerStatus().catch(() => null);
    return list ? mcpFrom(list) : null;
  }

  async reconnectMcp(name: string) {
    await this.q?.reconnectMcpServer(name);
  }

  async toggleMcp(name: string, enabled: boolean) {
    await this.q?.toggleMcpServer(name, enabled);
  }

  async addMcp(name: string, def: unknown) {
    this.start();
    if (!this.q) throw new Error('This chat was closed');
    if (await inSettings(this.cwd, name)) return { error: undefined };
    this.addedMcp[name] = def as McpServerConfig;
    this.mcpServers = { ...this.mcpServers, [name]: def as McpServerConfig };
    const r = await this.q!.setMcpServers(this.mcpServers);
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
    return { model: team ? TEAM.model : model, team };
  }

  async setEffort(level: Effort) {
    this.start();
    await this.q?.applyFlagSettings({ effortLevel: level });
  }

  async setPermissionMode(mode: string) {
    this.start();
    await this.q?.setPermissionMode(mode as PermissionMode);
  }

  async allow(rule: string) {
    const known = this.allowed.includes(rule);
    this.start();
    if (known) return false;
    this.allowed = [...this.allowed, rule];
    await this.q?.applyFlagSettings({ permissions: { allow: this.allowed } });
    return true;
  }

  private async confirmBigBro(input: HookInput, signal: AbortSignal): Promise<HookJSONOutput> {
    const req = bigBroRequest(input);
    if (!req) return {};
    const r = await this.host.ask(req.toolName, req.toolInput, { signal, title: req.title });
    return bigBroVerdict(r.behavior);
  }

  afterTool(input: HookInput): HookJSONOutput {
    if (input.agent_id || input.hook_event_name !== 'PostToolUse') return {};
    const notes: string[] = [];
    const plan = this.host.takePlanChange();
    if (plan) notes.push(plan);
    if (input.tool_name.endsWith('__set_status')) this.sinceStatus = 0;
    else if (++this.sinceStatus >= STATUS_EVERY) {
      this.sinceStatus = 0;
      notes.push(STATUS_REMINDER);
    }
    return notes.length ? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notes.join('\n\n') } } : {};
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

  send(text: string, id?: string, priority?: 'next') {
    if (id) this.sent.push({ id, text });
    this.inputQueue.push({ ...userMessage(text), ...(priority && { priority }) });
    this.wake?.();
  }

  dropInput() {
    const n = this.inputQueue.filter((m) => !m.priority).length;
    this.inputQueue = [];
    return n;
  }

  // The CLI echoes each prompt with the uuid it saved it under; that uuid is what a file rewind points at.
  private noteReplay(msg: { uuid?: string; message: { content: unknown } }) {
    const text = replayText(msg.message.content);
    const at = this.sent.findIndex((s) => s.text === text);
    if (at < 0 || !msg.uuid) return;
    this.rewindIds.set(this.sent[at].id, msg.uuid);
    this.sent.splice(0, at + 1);
  }

  async rewind(id: string) {
    this.start();
    if (!this.q) throw new Error('This chat was closed');
    return this.q.rewindFiles(this.rewindIds.get(id) ?? id.replace(/:\d+$/, ''));
  }

  // The SDK takes cancelQueued at runtime but its types leave the option out.
  async interrupt(cancelQueued = false) {
    await (this.q as unknown as { interrupt(o: { cancelQueued: boolean }): Promise<unknown> } | null)?.interrupt({ cancelQueued });
  }

  async stopTask(toolUseId: string) {
    const id = this.taskIds.get(toolUseId) ?? [...this.agents].find(([, t]) => t === toolUseId)?.[0];
    if (!id || !this.q) return false;
    const live = this.tasks.has(id);
    const ok = await this.q.stopTask(id).then(() => true, () => false);
    return ok && live;
  }

  private async consume() {
    const q = this.q;
    if (!q) return;
    try {
      for await (const msg of q) {
        // A bug in handling one message must not end the CLI and the turn with it.
        try {
          this.handle(msg);
        } catch (err) {
          process.stderr.write(`handle ${msg.type} failed: ${err instanceof Error ? err.stack : String(err)}\n`);
        }
      }
    } catch (err) {
      if (this.q === q) this.host.system(`Session error: ${String(err)}`);
    } finally {
      if (this.q === q) {
        // The CLI is gone; drop it so the next prompt resumes the session in a fresh process.
        const { model, team, permissionMode, sessionId } = this.state.session;
        this.restore = { model, team, permissionMode };
        this.resume = sessionId ?? this.resume;
        this.q = null;
        this.gen++;
        this.inputQueue = [];
        this.sent = [];
        this.wake?.();
        this.tasks.clear();
        if (!this.closed) this.endLive();
        this.host.exited();
      }
    }
  }

  private toolUse(block: { id: string; name: string; input: unknown }, parent?: string) {
    this.host.pushEvent(toolUseEvent(block.id, block.name, block.input, Date.now(), parent, this.agents));
    if (AGENT_TOOLS.has(block.name)) this.host.pushEvent(agentEvent(block.id, block.input, Date.now(), parent));
    if (block.name === 'ReportFindings') this.host.reportFindings(block.input);
    const file = (block.input as { file_path?: unknown })?.file_path;
    if (EDIT_TOOLS.has(block.name) && typeof file === 'string') this.edits.set(block.id, file);
  }

  // A turn can end before content_block_stop; send the partial text once more as finished so it stops streaming.
  private endLive() {
    for (const t of this.liveFlush.values()) clearTimeout(t);
    this.liveFlush.clear();
    for (const live of this.live.values()) {
      live.streaming = false;
      this.host.emit({ type: 'event', event: live });
    }
    this.live.clear();
  }

  private handle(msg: SDKMessage) {
    const host = this.host;
    // Turns the CLI starts by itself (a subagent handing back, a scheduled job) come without a prompt from us.
    if (!this.state.session.running && (msg.type === 'assistant' || msg.type === 'stream_event') && !msg.parent_tool_use_id) host.turnStarted('Claude continued after a background task');
    switch (msg.type) {
      case 'rate_limit_event': {
        const until = overageUntil(msg);
        if (until) {
          host.overage(until);
          this.interrupt().catch(() => undefined);
        }
        break;
      }
      case 'system':
        if (msg.subtype === 'init') {
          const changed = msg.model !== this.state.session.model;
          if (this.fork) {
            this.fork = false;
            this.watchHistory(false);
            host.system('Forked into a new chat');
          }
          const newId = this.transcript && msg.session_id !== this.state.session.sessionId;
          host.setSession({ sessionId: msg.session_id, model: msg.model, permissionMode: msg.permissionMode, apiKeySource: msg.apiKeySource, mcp: mcpFrom(msg.mcp_servers, msg.tools) });
          if (newId) this.watchHistory(true);
          if (changed) host.system(`Session started with ${msg.model}`);
          if (this.resume && msg.permissionMode !== 'auto' && !this.resumedAuto) {
            this.resumedAuto = true;
            void this.q?.setPermissionMode('auto').then(() => host.setSession({ permissionMode: 'auto' }), () => {});
          }
          if (this.state.session.commands.length === 0) void this.loadMeta();
        } else if (msg.subtype === 'session_state_changed') {
          if (msg.state === 'running' && !this.state.session.running) host.turnStarted();
        } else if (msg.subtype === 'status') {
          if (msg.permissionMode) host.setSession({ permissionMode: msg.permissionMode });
          if (msg.status === 'compacting') host.startCompacting();
          if (msg.compact_result) host.setSession({ compacting: false });
          if (msg.compact_result === 'failed') host.system(`Compact failed: ${msg.compact_error || 'no reason given'}`);
        } else if (msg.subtype === 'compact_boundary') {
          const { pre_tokens, post_tokens } = msg.compact_metadata;
          host.compacted(pre_tokens, post_tokens);
        } else if (msg.subtype === 'permission_denied') {
          if (msg.decision_reason_type !== 'rule') host.blocked(msg.tool_use_id, msg.tool_name, msg.decision_reason || msg.message);
        } else if (msg.subtype === 'task_started') {
          this.tasks.add(msg.task_id);
          if (msg.tool_use_id) {
            const toolUseId = agentToolUse(this.host, msg.tool_use_id);
            this.taskIds.set(toolUseId, msg.task_id);
            host.adopt(toolUseId);
            patchAgent(this.host, toolUseId, (a) => ({
              status: 'running',
              background: msg.is_backgrounded ?? a.background,
              prompt: msg.prompt || a.prompt,
              subagentType: msg.subagent_type || a.subagentType,
              ...(a.status !== 'running' && { startedAt: Date.now(), endedAt: null }),
            }));
          }
        } else if (msg.subtype === 'task_progress') {
          if (msg.tool_use_id) patchAgent(this.host, agentToolUse(this.host, msg.tool_use_id), (a) => ({ usage: usageOf(msg.usage), progress: msg.summary || a.progress }));
        } else if (msg.subtype === 'task_updated') {
          if (msg.patch.status && !['pending', 'running', 'paused'].includes(msg.patch.status)) this.tasks.delete(msg.task_id);
          const toolUseId = taskToolUse(this.taskIds, this.agents, msg.task_id);
          const { status, end_time, is_backgrounded } = msg.patch;
          if (toolUseId) patchAgent(this.host, toolUseId, () => ({
            ...(status && ENDED[status] && { status: ENDED[status], endedAt: end_time ?? Date.now() }),
            ...(is_backgrounded !== undefined && { background: is_backgrounded }),
          }));
        } else if (msg.subtype === 'task_notification') {
          this.tasks.delete(msg.task_id);
          const toolUseId = msg.tool_use_id ? agentToolUse(this.host, msg.tool_use_id) : taskToolUse(this.taskIds, this.agents, msg.task_id);
          if (toolUseId) {
            // The CLI writes the report to the transcript before it streams; without this the watcher takes it for another process and restarts the CLI.
            if (!this.state.session.running) host.turnStarted('Claude continued after a background task');
            const usage = msg.usage && usageOf(msg.usage);
            patchAgent(this.host, toolUseId, (a) => ({ status: ENDED[msg.status], endedAt: a.status === 'running' ? Date.now() : a.endedAt ?? Date.now(), usage: usage || a.usage }));
            taskDone(this.host, this.agents, toolUseId, msg.task_id, msg.status, msg.summary);
          }
        } else if (msg.subtype === 'local_command_output') {
          host.pushEvent({ id: msg.uuid, kind: 'assistant', text: msg.content, streaming: false, at: Date.now() });
          host.turnEnded();
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
            host.pushEvent(e);
          } else {
            live.text += ev.delta.text;
            if (!this.liveFlush.has(key)) {
              this.liveFlush.set(key, setTimeout(() => {
                this.liveFlush.delete(key);
                host.emit({ type: 'event', event: live });
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
            host.emit({ type: 'event', event: live });
          }
          this.live.delete(key);
        }
        return;
      }

      case 'assistant': {
        const parent = msg.parent_tool_use_id ?? undefined;
        if (parent) {
          const model = msg.message.model;
          if (model) patchAgent(this.host, parent, () => ({ model }));
          for (const block of msg.message.content) {
            if (block.type === 'text' && block.text.trim()) host.pushEvent({ id: randomUUID(), kind: 'assistant', text: block.text, streaming: false, at: Date.now(), parent });
            if (block.type === 'tool_use') this.toolUse(block, parent);
          }
          return;
        }
        host.setSession({ cache: cacheFrom(msg.message.usage, Date.now(), this.state.session.cache), context: contextFrom(msg.message.usage) ?? this.state.session.context });
        for (const block of msg.message.content) {
          if (block.type === 'server_tool_use' && block.name === 'advisor') host.pushEvent(advisorEvent(block.id, Date.now()));
          if (block.type === 'tool_use') this.toolUse(block);
          if (block.type === 'text') host.noteReply(block.text);
        }
        return;
      }

      case 'user': {
        const parent = msg.parent_tool_use_id ?? undefined;
        const content = msg.message.content;
        if (!parent && this.sent.length) this.noteReplay(msg);
        if (typeof content === 'string' && content.startsWith('<task-notification>')) for (const ev of notificationResults(content, Date.now(), this.agents)) host.pushEvent(ev);
        if (!Array.isArray(content)) return;
        const output = (msg as { tool_use_result?: unknown }).tool_use_result;
        for (const block of content) {
          if (block.type !== 'tool_result') continue;
          const edited = this.edits.get(block.tool_use_id);
          this.edits.delete(block.tool_use_id);
          if (edited && !block.is_error) host.noteFile(path.relative(this.cwd, edited), 'tool');
          const text = toolResultText(block);
          const agent = isAgent(this.host, block.tool_use_id);
          if (agent) agentResult(this.host, block.tool_use_id, text, Boolean(block.is_error), output);
          if (!parent && text.startsWith(ASYNC_LAUNCH)) {
            noteLaunch(this.agents, block.tool_use_id, text);
            continue;
          }
          const report = agent ? liveReport(text, output) : text.slice(0, 4000);
          host.pushEvent({ id: randomUUID(), kind: 'tool_result', toolUseId: block.tool_use_id, text: report, isError: Boolean(block.is_error), at: Date.now(), ...(parent && { parent }) });
          if (!parent) host.notePr(block.tool_use_id, text);
        }
        return;
      }

      case 'result': {
        this.endLive();
        const ok = msg.subtype === 'success';
        host.turnResult({ id: msg.uuid, ok, text: ok ? msg.result : `Turn ended: ${msg.subtype}`, costUsd: msg.total_cost_usd, isError: msg.is_error });
        return;
      }

      default:
        return;
    }
  }
}
