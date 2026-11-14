import { randomUUID } from 'node:crypto';
import type { Account, Capabilities, Effort, LoopRole, McpServer, Provider } from '../../../../shared/protocol.js';
import { reviewPrompt } from '../../../../shared/reviewPrompt.js';
import { errText } from '../../../../shared/util.js';
import type { AgentDriver, AgentHost, Decision, DriverFactory, History } from '../types.js';
import { answersFor, askFor, decisionFor, elicitationAsk, elicitationFor, hasFields, permissionsAsk, permissionsFor, policyFor, questionsAsk, type Ask } from './approvals.js';
import { NOT_SIGNED_IN } from './binary.js';
import { historyEvents } from './events.js';
import { codexInstructionFiles } from './instructions.js';
import { threadParams } from './options.js';
import type { ApprovalMethod, CodexModel, ElicitationParams, McpServerStatus, PermissionProfile, RateLimits, Thread, UserInput, UserInputQuestion } from './protocol.js';
import { CodexRpc, type RpcHandlers } from './rpc.js';
import { CodexStream } from './stream.js';
import { noteThread } from './threads.js';
import { planUsage } from './usage.js';

const USAGE_EVERY = 10 * 60_000;
// The rate limits are the Codex account's, so the chats share one read a minute.
const USAGE_TTL = 60_000;
let lastRead: { at: number; read: Promise<{ rateLimits: RateLimits }> } | null = null;
// How long the process that read the history waits for the chat to start.
const SPARE_MS = 5_000;
const MCP_STATUS: Record<string, string> = { connected: 'connected', authenticationRequired: 'needs-auth', failed: 'failed', disabled: 'disabled' };

const ROLE_EFFORT: Record<LoopRole, Effort> = { plan: 'high', build: 'high', test: 'medium' };

export const codexDriver = (resume?: string, fork = false): DriverFactory => (host) => new CodexDriver(host, resume, fork);

// Runs a chat on `codex app-server`: one process per chat, one thread in it, resumed by thread id when the process ends.
export class CodexDriver implements AgentDriver {
  readonly provider: Provider = 'codex';
  readonly compactEndsTurn = true;
  readonly capabilities: Capabilities = { rewind: false, mcp: true, mcpEdit: false, connectors: false, effort: true, build: false, stopTask: false, subagents: false };
  readonly account: Account = 'main';
  readonly instructionFiles: string[];

  private rpc: CodexRpc | null = null;
  private spare: CodexRpc | null = null;
  private ready: Promise<void> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private stream: CodexStream;
  private threadId: string | undefined;
  private turnId: string | null = null;
  private closed = false;
  private titled: boolean;
  // Bumped by Stop, so a prompt still waiting for the process is dropped.
  private stops = 0;
  private models: CodexModel[] = [];
  private asks = new Set<AbortController>();
  private usageTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private host: AgentHost, resume?: string, private fork = false) {
    this.threadId = resume;
    this.instructionFiles = codexInstructionFiles(host.cwd);
    this.titled = Boolean(resume) && !fork;
    this.stream = new CodexStream(host);
  }

  get attached() {
    return this.rpc !== null;
  }

  accounts(): Account[] {
    return [];
  }

  setAccount() {}

  limitHit() {
    return null;
  }

  start() {
    if (this.rpc || this.closed) return;
    const handlers: RpcHandlers = {
      notification: (method, params) => this.onNotification(method, params),
      request: (method, params) => this.onRequest(method, params),
      exit: () => this.lost(),
    };
    const spare = this.spare?.adopt(handlers);
    this.spare = null;
    const rpc = spare ?? new CodexRpc(this.host.cwd, handlers);
    this.rpc = rpc;
    this.ready = this.open(rpc, !spare).catch((err) => {
      if (this.rpc === rpc) this.detach();
      rpc.close();
      this.host.system(`Codex: ${errText(err)}`, true);
      throw err;
    });
    this.ready.catch(() => undefined);
  }

  private async open(rpc: CodexRpc, init: boolean) {
    if (init) await rpc.initialize();
    const { account, requiresOpenaiAuth } = await rpc.request<{ account: unknown; requiresOpenaiAuth: boolean }>('account/read', { refreshToken: false });
    if (!account && requiresOpenaiAuth) throw new Error(NOT_SIGNED_IN);
    const { approvalPolicy, sandbox } = policyFor(this.mode);
    const params = { cwd: this.host.cwd, approvalPolicy, sandbox, ...threadParams(this.host.state.session.id) };
    const method = this.threadId ? (this.fork ? 'thread/fork' : 'thread/resume') : 'thread/start';
    const res = await rpc.request<{ thread: Thread; model: string }>(method, this.threadId ? { threadId: this.threadId, ...params, ...(!this.fork && { excludeTurns: true }) } : params);
    if (this.fork) this.host.system('Forked into a new chat');
    this.fork = false;
    this.threadId = res.thread.id;
    this.host.setSession({ sessionId: res.thread.id, model: res.model, permissionMode: this.mode, commands: [] });
    void noteThread(res.thread.id, { cwd: this.host.cwd, ...(res.thread.path && { path: res.thread.path }) });
    void this.loadModels(rpc);
    void this.loadUsage();
    clearInterval(this.usageTimer);
    this.usageTimer = setInterval(() => void this.loadUsage(), USAGE_EVERY);
    this.usageTimer.unref?.();
  }

  private get mode() {
    return this.host.state.session.permissionMode ?? 'auto';
  }

  private async loadModels(rpc: CodexRpc) {
    try {
      const { data } = await rpc.request<{ data: CodexModel[] }>('model/list', {});
      this.models = data.filter((m) => !m.hidden);
      this.host.setSession({ models: this.models.map((m) => ({ value: m.id, displayName: m.displayName, description: m.description, efforts: m.supportedReasoningEfforts.map((e) => e.reasoningEffort) })) });
    } catch (err) {
      process.stderr.write(`codex model/list failed: ${errText(err)}\n`);
    }
  }

  private async loadUsage() {
    const rpc = this.rpc;
    if (!rpc) return;
    try {
      const now = Date.now();
      if (!lastRead || now - lastRead.at >= USAGE_TTL) {
        const fresh = { at: now, read: rpc.request<{ rateLimits: RateLimits }>('account/rateLimits/read') };
        fresh.read.catch(() => lastRead === fresh && (lastRead = null));
        lastRead = fresh;
      }
      const { rateLimits } = await lastRead.read;
      if (rpc === this.rpc) this.host.setSession({ usage: planUsage(rateLimits) });
    } catch (err) {
      process.stderr.write(`codex rateLimits failed: ${errText(err)}\n`);
    }
  }

  refreshUsage() {
    return this.loadUsage();
  }

  private onNotification(method: string, params: any) {
    if (method === 'turn/started') this.turnId = params.turn.id;
    else if (method === 'turn/completed' && params.turn?.id === this.turnId) this.turnId = null;
    else if (method === 'account/rateLimits/updated') return this.host.setSession({ usage: planUsage(params.rateLimits) });
    try {
      this.stream.handle(method, params);
    } catch (err) {
      process.stderr.write(`codex ${method} failed: ${err instanceof Error ? err.stack : String(err)}\n`);
    }
  }

  private async onRequest(method: string, params: any): Promise<unknown> {
    switch (method) {
      case 'item/commandExecution/requestApproval':
      case 'item/fileChange/requestApproval': return this.approve(method, params);
      case 'item/tool/requestUserInput': return this.answer(params.questions);
      case 'item/permissions/requestApproval': return this.grant(params);
      case 'mcpServer/elicitation/request': return this.elicit(params);
      default: throw new Error(`Unsupported request ${method}`);
    }
  }

  private async prompt(ask: Ask, always = false) {
    const ac = new AbortController();
    this.asks.add(ac);
    try {
      const d = await this.host.ask(ask.tool, ask.input, { signal: ac.signal, title: ask.title, description: ask.detail, ...(always && { suggestions: [{ type: 'acceptForSession' }] }) });
      return { d, cancelled: ac.signal.aborted };
    } finally {
      this.asks.delete(ac);
    }
  }

  private async approve(method: ApprovalMethod, params: any) {
    const { d, cancelled } = await this.prompt(askFor(method, params, this.stream.files), true);
    return { decision: decisionFor(d, cancelled) };
  }

  private async answer(questions: UserInputQuestion[]) {
    const { d } = await this.prompt(questionsAsk(questions));
    return answersFor(questions, d);
  }

  private async grant(params: { reason: string | null; permissions: PermissionProfile }) {
    const { d, cancelled } = await this.prompt(permissionsAsk(params), true);
    return permissionsFor(params.permissions, d, cancelled);
  }

  private async elicit(params: ElicitationParams) {
    if (hasFields(params)) {
      this.host.system(`${params.serverName} asked for form input, which AgentView does not show yet`);
      return elicitationFor(null, false);
    }
    const { d, cancelled } = await this.prompt(elicitationAsk(params));
    return elicitationFor(d, cancelled);
  }

  private abortAsks() {
    for (const ac of this.asks) ac.abort();
  }

  // The process is gone; the next prompt starts a new one that resumes the thread.
  private detach() {
    clearInterval(this.usageTimer);
    this.abortAsks();
    this.stream.end();
    this.rpc = null;
    this.ready = null;
    this.turnId = null;
  }

  private lost() {
    if (!this.rpc) return;
    this.detach();
    if (!this.closed) this.host.exited();
  }

  send(text: string, _id?: string, priority?: 'next') {
    this.start();
    const title = !this.titled;
    this.titled = true;
    const stops = this.stops;
    this.queue = this.queue.then(() => this.deliver(text, priority === 'next', title, stops));
  }

  // A message sent mid-turn joins the running turn; otherwise it starts one.
  private async deliver(text: string, steer: boolean, title = false, stops = this.stops) {
    const input: UserInput[] = [{ type: 'text', text, text_elements: [] }];
    try {
      await this.ready;
      const rpc = this.rpc;
      if (!rpc) throw new Error('The codex process ended');
      // A new thread has its id only once the process is ready.
      if (title && this.threadId) void noteThread(this.threadId, { cwd: this.host.cwd, summary: text.replace(/\s+/g, ' ').trim().slice(0, 80) });
      if (stops !== this.stops) return this.host.turnResult({ id: randomUUID(), ok: false, text: 'Stopped', costUsd: 0, isError: true });
      // A steer that misses because the turn ended starts a new turn with the text.
      if (steer && (await this.steer(rpc, input))) return;
      const { approvalPolicy, sandboxPolicy } = policyFor(this.mode);
      const { turn } = await rpc.request<{ turn: { id: string } }>('turn/start', { threadId: this.threadId, input, approvalPolicy, sandboxPolicy, ...this.modelParams() });
      this.turnId = turn.id;
      // Stop came while the turn was starting.
      if (stops !== this.stops) return void (await rpc.request('turn/interrupt', { threadId: this.threadId, turnId: turn.id }));
      if (steer && !this.host.state.session.running) this.host.turnStarted('Codex started a turn for your message');
    } catch (err) {
      this.host.turnResult({ id: randomUUID(), ok: false, text: errText(err), costUsd: 0, isError: true });
    }
  }

  private async steer(rpc: CodexRpc, input: UserInput[]) {
    if (!this.turnId) return false;
    try {
      await rpc.request('turn/steer', { threadId: this.threadId, input, expectedTurnId: this.turnId });
      return true;
    } catch {
      return false;
    }
  }

  async inject(text: string) {
    await this.ready?.catch(() => undefined);
    return this.rpc ? this.steer(this.rpc, [{ type: 'text', text, text_elements: [] }]) : false;
  }

  clearInjected() {}

  // An effort the model does not list is left out, so the model keeps its own default.
  private modelParams() {
    const { model, effort } = this.host.state.session;
    const info = this.models.find((m) => m.id === model);
    return { ...(model && { model }), ...(effort && info?.supportedReasoningEfforts.some((e) => e.reasoningEffort === effort) && { effort }) };
  }

  dropInput() {
    return 0;
  }

  compact() {
    this.start();
    this.queue = this.queue.then(async () => {
      try {
        await this.ready;
        await this.rpc!.request('thread/compact/start', { threadId: this.threadId });
      } catch (err) {
        this.host.compactFailed(errText(err));
        this.host.turnResult({ id: randomUUID(), ok: true, text: '', costUsd: 0, isError: false });
      }
    });
  }

  command(name: string) {
    this.host.system(`/${name} is not available on Codex`);
    return true;
  }

  review(target: 'local' | number) {
    this.send(reviewPrompt(target));
  }

  roleModel(role: LoopRole) {
    const model = this.models.find((m) => m.isDefault)?.id ?? this.host.state.session.model;
    return model ? { model, effort: ROLE_EFFORT[role] } : null;
  }

  async interrupt() {
    this.stops++;
    this.abortAsks();
    const rpc = this.rpc;
    if (rpc && this.turnId) await rpc.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId });
  }

  async setModel(model: string) {
    return { model };
  }

  async setEffort() {}

  async setPermissionMode() {}

  async allow() {
    return false;
  }

  async rewind() {
    return { canRewind: false, error: 'Codex chats cannot rewind files' };
  }

  async stopTask() {
    return false;
  }

  async mcpStatus(): Promise<McpServer[] | null> {
    this.start();
    await this.ready;
    const { data } = await this.rpc!.request<{ data: McpServerStatus[] }>('mcpServerStatus/list', { threadId: this.threadId });
    return data.map((s) => ({
      name: s.name,
      status: MCP_STATUS[s.runtimeStatus ?? ''] ?? 'pending',
      ...(s.serverInfo && { version: s.serverInfo.version }),
      ...(s.toolsError && { error: s.toolsError }),
      tools: Object.values(s.tools).flatMap((t) => (t ? [{ name: t.name, description: t.description ?? undefined, readOnly: t.annotations?.readOnlyHint ?? undefined, destructive: t.annotations?.destructiveHint ?? undefined }] : [])),
    }));
  }

  async reconnectMcp() {
    this.start();
    await this.ready;
    await this.rpc!.request('config/mcpServer/reload');
  }

  async toggleMcp(): Promise<void> {
    throw new Error('Codex MCP servers are set in ~/.codex/config.toml');
  }

  async addMcp() {
    return { error: 'Codex MCP servers are set in ~/.codex/config.toml' };
  }

  async loginMcp(): Promise<{ authUrl?: string; callbackPort?: number }> {
    throw new Error('Sign in to Codex MCP servers with codex mcp login');
  }

  // The thread is read through a short-lived process, so a reopened chat starts none until its first prompt.
  // A chat viewed right after takes that process over in start() instead of starting a second one.
  async loadHistory(): Promise<History | null> {
    if (!this.threadId) return null;
    const rpc = await CodexRpc.openQuiet(this.host.cwd).catch(() => null);
    if (!rpc) return null;
    try {
      const { thread } = await rpc.request<{ thread: Thread }>('thread/read', { threadId: this.threadId, includeTurns: true });
      this.keepSpare(rpc);
      return { events: historyEvents(thread.turns, thread.updatedAt * 1000), context: null, cache: null };
    } catch {
      rpc.close();
      return null;
    }
  }

  private keepSpare(rpc: CodexRpc) {
    this.spare?.close();
    this.spare = rpc;
    setTimeout(() => {
      if (this.spare !== rpc) return;
      this.spare = null;
      rpc.close();
    }, SPARE_MS);
  }

  watchHistory() {}

  settled() {
    if (this.threadId) void noteThread(this.threadId, { cwd: this.host.cwd });
    void this.loadUsage();
  }

  kill() {
    const rpc = this.rpc;
    this.detach();
    rpc?.close();
    this.host.exited();
  }

  close() {
    this.closed = true;
    this.spare?.close();
    this.spare = null;
    const rpc = this.rpc;
    this.detach();
    rpc?.close();
  }
}
