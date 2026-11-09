import { randomUUID } from 'node:crypto';
import type { Account, Capabilities, McpServer, Provider } from '../../../../shared/protocol.js';
import { errText } from '../../../../shared/util.js';
import type { AgentDriver, AgentHost, DriverFactory, History } from '../types.js';
import { askFor, decisionFor, policyFor } from './approvals.js';
import { NOT_SIGNED_IN } from './binary.js';
import { historyEvents } from './events.js';
import type { ApprovalMethod, CodexModel, McpServerStatus, RateLimits, Thread, UserInput } from './protocol.js';
import { CodexRpc } from './rpc.js';
import { CodexStream } from './stream.js';
import { noteThread } from './threads.js';
import { planUsage } from './usage.js';

const USAGE_EVERY = 10 * 60_000;
const MCP_STATUS: Record<string, string> = { connected: 'connected', authenticationRequired: 'needs-auth', failed: 'failed', disabled: 'disabled' };

export const codexDriver = (resume?: string, fork = false): DriverFactory => (host) => new CodexDriver(host, resume, fork);

// Runs a chat on `codex app-server`: one process per chat, one thread in it, resumed by thread id when the process ends.
export class CodexDriver implements AgentDriver {
  readonly provider: Provider = 'codex';
  readonly capabilities: Capabilities = { rewind: false, mcp: true, effort: true, team: false, stopTask: false };
  readonly account: Account = 'main';

  private rpc: CodexRpc | null = null;
  private ready: Promise<void> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private stream: CodexStream;
  private threadId: string | undefined;
  private turnId: string | null = null;
  private closed = false;
  private titled: boolean;
  private models: CodexModel[] = [];
  private asks = new Set<AbortController>();
  private usageTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private host: AgentHost, resume?: string, private fork = false) {
    this.threadId = resume;
    this.titled = Boolean(resume);
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
    const rpc = new CodexRpc(this.host.cwd, {
      notification: (method, params) => this.onNotification(method, params),
      request: (method, params) => this.onRequest(method, params),
      exit: () => this.lost(),
    });
    this.rpc = rpc;
    this.ready = this.open(rpc).catch((err) => {
      if (this.rpc === rpc) this.detach();
      rpc.close();
      this.host.system(`Codex: ${errText(err)}`, true);
      throw err;
    });
    this.ready.catch(() => undefined);
  }

  private async open(rpc: CodexRpc) {
    await rpc.request('initialize', { clientInfo: { name: 'agentview', title: 'AgentView', version: '1' }, capabilities: null });
    const { account, requiresOpenaiAuth } = await rpc.request<{ account: unknown; requiresOpenaiAuth: boolean }>('account/read', { refreshToken: false });
    if (!account && requiresOpenaiAuth) throw new Error(NOT_SIGNED_IN);
    const { approvalPolicy, sandbox } = policyFor(this.mode);
    const params = { cwd: this.host.cwd, approvalPolicy, sandbox };
    const method = this.threadId ? (this.fork ? 'thread/fork' : 'thread/resume') : 'thread/start';
    const res = await rpc.request<{ thread: Thread; model: string }>(method, this.threadId ? { threadId: this.threadId, ...params, ...(!this.fork && { excludeTurns: true }) } : params);
    if (this.fork) this.host.system('Forked into a new chat');
    this.fork = false;
    this.threadId = res.thread.id;
    this.host.setSession({ sessionId: res.thread.id, model: res.model, permissionMode: this.mode });
    void noteThread(res.thread.id, { cwd: this.host.cwd });
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
      this.host.setSession({ models: this.models.map((m) => ({ value: m.id, displayName: m.displayName, description: m.description })) });
    } catch (err) {
      process.stderr.write(`codex model/list failed: ${errText(err)}\n`);
    }
  }

  private async loadUsage() {
    const rpc = this.rpc;
    if (!rpc) return;
    try {
      const { rateLimits } = await rpc.request<{ rateLimits: RateLimits }>('account/rateLimits/read');
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
    else if (method === 'turn/completed') this.turnId = null;
    else if (method === 'account/rateLimits/updated') return this.host.setSession({ usage: planUsage(params.rateLimits) });
    try {
      this.stream.handle(method, params);
    } catch (err) {
      process.stderr.write(`codex ${method} failed: ${err instanceof Error ? err.stack : String(err)}\n`);
    }
  }

  private async onRequest(method: string, params: any): Promise<unknown> {
    if (method !== 'item/commandExecution/requestApproval' && method !== 'item/fileChange/requestApproval') throw new Error(`Unsupported request ${method}`);
    return this.approve(method, params);
  }

  private async approve(method: ApprovalMethod, params: any) {
    const ask = askFor(method, params, this.stream.files);
    const ac = new AbortController();
    this.asks.add(ac);
    try {
      const d = await this.host.ask(ask.tool, ask.input, { signal: ac.signal, title: ask.title, description: ask.detail, suggestions: [{ type: 'acceptForSession' }] });
      return { decision: decisionFor(d, ac.signal.aborted) };
    } finally {
      this.asks.delete(ac);
    }
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
    if (!this.titled) {
      this.titled = true;
      if (this.threadId) void noteThread(this.threadId, { cwd: this.host.cwd, summary: text.replace(/\s+/g, ' ').trim().slice(0, 80) });
    }
    this.queue = this.queue.then(() => this.deliver(text, priority === 'next'));
  }

  // A message sent mid-turn joins the running turn; otherwise it starts one.
  private async deliver(text: string, steer: boolean) {
    const input: UserInput[] = [{ type: 'text', text, text_elements: [] }];
    try {
      await this.ready;
      const rpc = this.rpc;
      if (!rpc) throw new Error('The codex process ended');
      if (steer && this.turnId) return void (await rpc.request('turn/steer', { threadId: this.threadId, input, expectedTurnId: this.turnId }));
      const { approvalPolicy, sandboxPolicy } = policyFor(this.mode);
      const { turn } = await rpc.request<{ turn: { id: string } }>('turn/start', { threadId: this.threadId, input, approvalPolicy, sandboxPolicy, ...this.modelParams() });
      this.turnId = turn.id;
    } catch (err) {
      if (steer) return this.host.system(`Codex: ${errText(err)}`, true);
      this.host.turnResult({ id: randomUUID(), ok: false, text: errText(err), costUsd: 0, isError: true });
    }
  }

  // An effort the model does not list is left out, so the model keeps its own default.
  private modelParams() {
    const { model, effort } = this.host.state.session;
    const info = this.models.find((m) => m.id === model);
    return { ...(model && { model }), ...(effort && info?.supportedReasoningEfforts.some((e) => e.reasoningEffort === effort) && { effort }) };
  }

  dropInput() {
    return 0;
  }

  async interrupt() {
    this.abortAsks();
    const rpc = this.rpc;
    if (rpc && this.turnId) await rpc.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId });
  }

  async setModel(model: string) {
    return { model, team: false };
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
    const { data } = await this.rpc!.request<{ data: McpServerStatus[] }>('mcpServerStatus/list', {});
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
  async loadHistory(): Promise<History | null> {
    if (!this.threadId) return null;
    const rpc = await CodexRpc.open(this.host.cwd, { notification: () => undefined, request: () => Promise.reject(new Error('unsupported')), exit: () => undefined }).catch(() => null);
    if (!rpc) return null;
    try {
      const { thread } = await rpc.request<{ thread: Thread }>('thread/read', { threadId: this.threadId, includeTurns: true });
      return { events: historyEvents(thread.turns, thread.updatedAt * 1000), context: null, cache: null };
    } catch {
      return null;
    } finally {
      rpc.close();
    }
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
    const rpc = this.rpc;
    this.detach();
    rpc?.close();
  }
}
