import { query, type Query, type SDKMessage, type SDKUserMessage, type PermissionMode, type PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { ACCOUNT_LABEL, type Account, type Capabilities, type Effort, type LoopRole, type Provider } from '../../../../shared/protocol.js';
import type { AgentDriver, AgentHost, DriverFactory, History } from '../types.js';
import { AgentSession } from '../../session/session.js';
import { InputQueue } from './inputQueue.js';
import { TranscriptWatch } from './transcriptWatch.js';
import type { SystemMessage } from './sdkTypes.js';
import { TaskTracker } from './taskTracker.js';
import { Rewinds } from './rewinds.js';
import { Messages } from './messages.js';
import { SystemMessages } from './systemMessages.js';
import { claudeInstructionFiles } from './memory.js';
import { TEAM, agentOptions, userMessage } from './options.js';
import { mcpFrom } from './mcp.js';
import { loadOpenRouter, openRouterModels, openRouterValue } from './openrouter.js';
import { McpControl } from './mcpControl.js';
import { loadMeta, loadUsage } from './queryInfo.js';
import { configDir, loggedInAccounts, markLimited, otherAccount, overageUntil, reopenAccount } from './accounts.js';
import { ToolHooks } from './toolHooks.js';
import { continuedTurn } from './subagents.js';
import { LiveText } from './stream.js';
import { historyFrom } from './transcript.js';
import { OPENROUTER_PREFIX } from '../../../../shared/openrouter.js';

const LOOP_MODELS = { plan: 'claude-opus-5-5', build: 'claude-opus-5-5', test: 'claude-sonnet-5-5' } as const;

const USAGE_EVERY = 10 * 60_000;

export const claudeDriver = (cwd: string, resume?: string, fork = false, openrouter = false, account = reopenAccount(resume, cwd)): DriverFactory => (host) => new ClaudeDriver(host, resume, fork, account, openrouter);

export const claudeSession = (cwd: string, resume?: string, fork = false, account = reopenAccount(resume, cwd)) => new AgentSession(cwd, claudeDriver(cwd, resume, fork, false, account), resume ?? null);

// Runs a chat on the Claude Agent SDK: one CLI process at a time, resumed from its transcript when it exits.
export class ClaudeDriver implements AgentDriver {
  private q: Query | null = null;
  private closed = false;
  private input = new InputQueue(() => this.closed);
  private usageTimer: ReturnType<typeof setInterval> | undefined;

  private live: LiveText;

  private resumedAuto = false;
  private allowed: string[] = [];
  private mcp = new McpControl(() => this.cwd, () => this.q, () => this.open());

  private watcher: TranscriptWatch;
  readonly toolHooks: ToolHooks;
  private tasks: TaskTracker;
  private rewinds = new Rewinds();
  private messages: Messages;
  private systemMessages: SystemMessages;
  private restore: { model: string | null; team: boolean; permissionMode: string | null } | null = null;

  constructor(private host: AgentHost, private resume?: string, private fork = false, public account: Account = 'main', private openrouter = false) {
    this.live = new LiveText(host);
    this.toolHooks = new ToolHooks(host);
    this.tasks = new TaskTracker(host);
    this.messages = new Messages(host, this.tasks, this.rewinds, () => this.account);
    this.systemMessages = new SystemMessages(host, this.tasks, (msg) => this.onInit(msg));
    this.watcher = new TranscriptWatch({
      host,
      isClosed: () => this.closed,
      attached: () => this.attached,
      taskCount: () => this.tasks.count,
      restart: () => this.restart(),
      history: (...args) => this.history(...args),
    });
  }

  // On OpenRouter the models, effort and the Opus advisor are not Anthropic's, so they are left out.
  get capabilities(): Capabilities {
    return { rewind: true, mcp: true, mcpEdit: true, connectors: !this.openrouter, effort: !this.openrouter, team: !this.openrouter, stopTask: true };
  }

  get instructionFiles() {
    return claudeInstructionFiles(this.cwd);
  }

  get provider(): Provider {
    return this.openrouter ? 'openrouter' : 'claude';
  }

  accounts(): Account[] {
    return this.openrouter ? [] : loggedInAccounts();
  }

  // The CLI runs with the other provider's environment, so a running chat restarts; it resumes from its transcript.
  private switchProvider(openrouter: boolean) {
    if (openrouter && !loadOpenRouter()) throw new Error('Set an OpenRouter key and models in Settings first');
    if (this.q && this.state.session.running) throw new Error(`Stop Claude before switching to ${openrouter ? 'OpenRouter' : 'Claude'}`);
    this.openrouter = openrouter;
    this.host.setSession({ provider: this.provider, capabilities: this.capabilities, accounts: this.accounts(), usage: null });
    if (!this.q) return;
    this.restart();
    this.host.system(`Restarted on ${openrouter ? 'OpenRouter' : 'Claude'} to change the model`);
    this.host.restarted(`Claude restarted on ${openrouter ? 'OpenRouter' : 'Claude'}`);
  }

  setAccount(a: Account) {
    if (a === this.account) return;
    this.account = a;
    this.host.setSession({ usage: null });
    if (!this.q) return;
    // Started again at once so the new account's usage shows before the next prompt.
    this.restart();
    this.start();
    this.host.restarted('Claude restarted on another account');
  }

  limitHit(until: number) {
    if (this.openrouter) return null;
    markLimited(this.account, until);
    const next = otherAccount(this.account);
    if (next) this.setAccount(next);
    return next;
  }

  // Ends the CLI process; the next prompt resumes the session in a fresh one with the same settings.
  private restart() {
    const q = this.q!;
    this.detach();
    this.live.end();
    q.close();
  }

  runningTasks() {
    return this.tasks.list();
  }

  private detach() {
    const { model, team, permissionMode, sessionId } = this.state.session;
    this.restore = { model, team, permissionMode };
    this.resume = sessionId ?? this.resume;
    this.q = null;
    this.input.release(true);
    this.tasks.clear();
    this.messages.dropEdits();
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
    this.watcher.watchHistory(on);
  }

  settled() {
    void this.loadUsage();
    this.watcher.settled();
  }

  kill() {
    this.q?.close();
  }

  close() {
    this.closed = true;
    clearInterval(this.usageTimer);
    this.watchHistory(false);
    this.input.release(false);
    this.q?.close();
  }

  async loadHistory() {
    if (!this.resume) return null;
    return this.watcher.loadHistory(this.resume);
  }

  private history(...args: Parameters<typeof historyFrom>): History {
    const { events, context, cache, agents } = historyFrom(...args);
    this.tasks.agents = agents;
    return { events, context, cache };
  }

  start() {
    if (this.q || this.closed) return;
    const openrouter = this.openrouter ? loadOpenRouter() : null;
    if (this.openrouter && !openrouter) throw new Error('The OpenRouter key was removed in Settings');
    const options = agentOptions({
      cwd: this.cwd,
      resume: this.resume,
      host: this.host,
      chat: () => this.state.session.sessionId,
      canUseTool: (toolName, input, opts) => this.host.canUseTool(toolName, input, opts) as Promise<PermissionResult>,
      beforeAgent: (input, _id, { signal }) => this.toolHooks.beforeAgent(input, signal),
      beforeEdit: async (input) => this.toolHooks.beforeEdit(input),
      afterTool: async (input) => this.toolHooks.afterTool(input),
      onStop: (input) => this.toolHooks.onStop(input),
      mcp: this.mcp.added,
      effort: (!openrouter && this.state.session.effort) || undefined,
      fork: this.fork,
      configDir: configDir(this.account),
      openrouter,
    });
    this.mcp.servers = options.mcpServers ?? {};
    this.q = query({ prompt: this.input.stream(), options });
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
    // Plan usage also moves from other chats and other devices, so an idle chat reads it again every few minutes.
    clearInterval(this.usageTimer);
    this.usageTimer = setInterval(() => void this.loadUsage(), USAGE_EVERY);
    this.usageTimer.unref?.();
  }

  private async loadMeta() {
    if (this.q) return loadMeta(this.q, this.host, openRouterModels(loadOpenRouter()));
  }

  refreshUsage() {
    return this.loadUsage();
  }

  private async loadUsage() {
    const q = this.q;
    if (q && !this.openrouter) return loadUsage(q, this.host, () => q === this.q);
  }

  async mcpStatus() {
    return this.mcp.status();
  }

  async reconnectMcp(name: string) {
    return this.mcp.reconnect(name);
  }

  async toggleMcp(name: string, enabled: boolean) {
    return this.mcp.toggle(name, enabled);
  }

  private open() {
    this.start();
    if (!this.q) throw new Error('This chat was closed');
    return this.q;
  }

  async addMcp(name: string, def: unknown) {
    return this.mcp.add(name, def);
  }

  async loginMcp(name: string) {
    return this.mcp.login(name);
  }

  async setModel(model: string) {
    const openrouter = model.startsWith(OPENROUTER_PREFIX);
    if (openrouter !== this.openrouter) this.switchProvider(openrouter);
    this.start();
    const team = model === 'team';
    if (team || this.state.session.team) await this.q?.applyFlagSettings({ advisorModel: team ? TEAM.advisor : null });
    await this.q?.setModel(team ? TEAM.model : openrouter ? model.slice(OPENROUTER_PREFIX.length) : model);
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

  send(text: string, id?: string, priority?: 'next') {
    if (id) this.rewinds.track(id, text);
    this.input.push({ ...userMessage(text), ...(priority && { priority }) });
  }

  dropInput() {
    return this.input.drop();
  }

  compact(instructions = '') {
    this.send(`/compact ${instructions}`.trim());
  }

  command() {
    return false;
  }

  async inject(text: string) {
    this.toolHooks.inject(text);
    return true;
  }

  clearInjected() {
    this.toolHooks.clearInjected();
  }

  review(target: 'local' | number) {
    this.send(target === 'local' ? '/code-review' : `/code-review ${target}`);
  }

  roleModel(role: LoopRole) {
    return { model: this.openrouter ? `${OPENROUTER_PREFIX}${role === 'test' ? 'sonnet' : 'opus'}` : LOOP_MODELS[role] };
  }

  async rewind(id: string) {
    return this.open().rewindFiles(this.rewinds.uuidOf(id));
  }

  // The SDK takes cancelQueued at runtime but its types leave the option out.
  async interrupt(cancelQueued = false) {
    await (this.q as unknown as { interrupt(o: { cancelQueued: boolean }): Promise<unknown> } | null)?.interrupt({ cancelQueued });
  }

  async stopTask(toolUseId: string) {
    const id = this.tasks.taskIdOf(toolUseId);
    if (!id || !this.q) return false;
    const live = this.tasks.isRunning(id);
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
        this.detach();
        this.input.clear();
        this.rewinds.forgetSent();
        if (!this.closed) this.live.end();
        this.host.exited();
      }
    }
  }

  private handle(msg: SDKMessage) {
    // Turns the CLI starts by itself (a subagent handing back, a scheduled job) come without a prompt from us.
    if ((msg.type === 'assistant' || msg.type === 'stream_event') && !msg.parent_tool_use_id) continuedTurn(this.host);
    switch (msg.type) {
      case 'rate_limit_event':
        return this.onRateLimit(msg);
      case 'system':
        return this.systemMessages.handle(msg);
      case 'stream_event':
        if (!msg.parent_tool_use_id) this.live.event(msg.event);
        return;
      case 'assistant':
        return msg.parent_tool_use_id ? this.messages.subagent(msg, msg.parent_tool_use_id) : this.messages.assistant(msg);
      case 'user':
        return this.messages.user(msg);
      case 'result':
        return this.onResult(msg);
      default:
        return;
    }
  }

  private onRateLimit(msg: Extract<SDKMessage, { type: 'rate_limit_event' }>) {
    const until = overageUntil(msg);
    if (!until) return;
    // An idle chat moves to the other account at once; the new CLI must not be interrupted.
    const q = this.q;
    const running = this.host.state.session.running;
    if (this.host.limit(until) && running) this.host.system(`Stopped before using extra usage on the ${ACCOUNT_LABEL[this.account]} account`);
    if (this.q === q) this.interrupt().catch(() => undefined);
  }

  private onInit(msg: Extract<SystemMessage, { subtype: 'init' }>) {
    const host = this.host;
    const changed = msg.model !== this.state.session.model;
    if (this.fork) {
      this.fork = false;
      this.watchHistory(false);
      host.system('Forked into a new chat');
    }
    const newId = this.watcher.active && msg.session_id !== this.state.session.sessionId;
    const or = this.openrouter ? loadOpenRouter() : null;
    host.setSession({ sessionId: msg.session_id, model: or ? openRouterValue(or, msg.model) : msg.model, permissionMode: msg.permissionMode, apiKeySource: msg.apiKeySource, mcp: mcpFrom(msg.mcp_servers, msg.tools) });
    if (newId) this.watchHistory(true);
    if (changed) host.system(`Session started with ${msg.model}`);
    if (this.resume && msg.permissionMode !== 'auto' && !this.resumedAuto) {
      this.resumedAuto = true;
      void this.q?.setPermissionMode('auto').then(() => host.setSession({ permissionMode: 'auto' }), () => {});
    }
    if (this.state.session.commands.length === 0) void this.loadMeta();
  }

  private onResult(msg: Extract<SDKMessage, { type: 'result' }>) {
    this.live.end();
    const ok = msg.subtype === 'success';
    this.host.turnResult({ id: msg.uuid, ok, text: ok ? msg.result : `Turn ended: ${msg.subtype}`, costUsd: this.openrouter ? 0 : msg.total_cost_usd, isError: msg.is_error });
  }
}
