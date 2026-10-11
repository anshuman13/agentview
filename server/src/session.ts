import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  query,
  getSessionMessages,
  createSdkMcpServer,
  tool,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type PermissionResult,
  type PermissionUpdate,
  type PermissionMode,
  type HookInput,
  type HookJSONOutput,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { CacheInfo, ChatEvent, PendingRequest, ServerMessage, ServerState, SessionInfo } from '../../shared/protocol.js';

type Resolver = (r: PermissionResult) => void;

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

const TEAM = { model: 'opusplan', advisor: 'claude-opus-5-5' };
export const BIG_BRO = 'big-bro';

export class AgentSession {
  private q: Query | null = null;
  private inputQueue: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private closed = false;

  private resolvers = new Map<string, Resolver>();
  private pendingMeta = new Map<string, { suggestions?: PermissionUpdate[]; input: Record<string, unknown> }>();

  id = randomUUID();
  title = '';
  created = Date.now();
  state: ServerState;
  private listeners = new Set<(m: ServerMessage) => void>();

  constructor(public cwd: string, private resume?: string) {
    this.state = {
      session: { id: this.id, sessionId: resume ?? null, model: null, team: false, cwd, running: false, permissionMode: null, apiKeySource: null, models: [], commands: [], cache: null },
      status: 'Idle',
      events: [],
      pending: [],
      recentFiles: [],
    };
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

  private setStatus(text: string) {
    this.state.status = text;
    this.emit({ type: 'status', text });
    this.pushEvent({ id: randomUUID(), kind: 'status', text, at: Date.now() });
  }

  private setSession(patch: Partial<SessionInfo>) {
    this.state.session = { ...this.state.session, ...patch };
    this.emit({ type: 'session', session: this.state.session });
  }

  private noteFile(rel: string, source: 'tool' | 'watcher') {
    this.state.recentFiles = [rel, ...this.state.recentFiles.filter((f) => f !== rel)].slice(0, 30);
    this.emit({ type: 'file_changed', path: rel, source });
  }

  fileChangedExternally(rel: string) {
    this.noteFile(rel, 'watcher');
  }

  close() {
    this.closed = true;
    this.listeners.clear();
    for (const resolve of this.resolvers.values()) resolve({ behavior: 'deny', message: 'Session closed' });
    this.wake?.();
    this.q?.close();
  }

  async loadHistory() {
    if (!this.resume) return;
    const msgs = await getSessionMessages(this.resume, { dir: this.cwd });
    let lastText = '';
    let lastAt = 0;
    let inTurn = false;
    const endTurn = () => {
      if (inTurn) this.state.events.push({ id: randomUUID(), kind: 'result', text: lastText, costUsd: 0, isError: false, at: lastAt });
      inTurn = false;
    };
    for (const m of msgs) {
      if (m.parent_tool_use_id) continue;
      const at = Date.parse((m as { timestamp?: string }).timestamp ?? '') || 0;
      const content = (m.message as { content?: unknown })?.content;
      const blocks: any[] = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
      for (const b of blocks) {
        if (m.type === 'user' && b.type === 'text' && b.text.startsWith('[Request interrupted')) {
          this.state.events.push({ id: randomUUID(), kind: 'system', text: 'Interrupted', at });
        } else if (m.type === 'user' && b.type === 'text' && !b.text.trimStart().startsWith('<')) {
          endTurn();
          inTurn = true;
          this.state.events.push({ id: randomUUID(), kind: 'user', text: b.text, at });
        } else if (m.type === 'user' && b.type === 'tool_result') {
          this.state.events.push({ id: randomUUID(), kind: 'tool_result', toolUseId: b.tool_use_id, text: toolResultText(b).slice(0, 4000), isError: Boolean(b.is_error), at });
        } else if (m.type === 'assistant' && b.type === 'text') {
          lastText = b.text;
          this.state.events.push({ id: randomUUID(), kind: 'assistant', text: b.text, streaming: false, at });
        } else if (m.type === 'assistant' && b.type === 'server_tool_use' && b.name === 'advisor') {
          this.state.events.push(advisorEvent(b.id, at));
        } else if (m.type === 'assistant' && b.type === 'tool_use') {
          const input = (b.input ?? {}) as Record<string, unknown>;
          this.state.events.push({ id: b.id, kind: 'tool_use', name: b.name, input, summary: summarizeTool(b.name, input), at });
        }
      }
      if (at) lastAt = at;
      if (m.type === 'assistant' && at) this.state.session.cache = cacheFrom((m.message as any)?.usage, at, this.state.session.cache);
    }
    endTurn();
  }

  start() {
    if (this.q || this.closed) return;
    const statusServer = createSdkMcpServer({
      name: 'agentview',
      alwaysLoad: true,
      instructions: [
        'The user follows your work in a brief view instead of reading the whole chat.',
        'Call set_status when you begin a task, whenever you move to a new step or your plan changes, and when you finish. Keep text to one short sentence about what you are doing right now.',
        'Pass next as the remaining steps after the current one, a few words each, in order. Send the full list every time, and an empty list when nothing is left.',
        'Pass important only for something the user must know without reading the chat: a decision you made on their behalf, a risk, a blocker, or something surprising you found. One or two sentences. Leave it out otherwise.',
      ].join(' '),
      tools: [
        tool(
          'set_status',
          'Update the one-line status shown to the user about what you are doing right now, and optionally flag something important for them.',
          {
            text: z.string().max(200),
            next: z.array(z.string().max(120)).max(12).optional().describe('Remaining steps after the current one, in order. Empty when done.'),
            important: z.string().max(500).optional().describe('A decision, risk, blocker or surprise the user must know about. Omit when there is none.'),
          },
          async ({ text }) => {
            this.setStatus(text);
            return { content: [{ type: 'text', text: 'ok' }] };
          },
        ),
      ],
    });

    this.q = query({
      prompt: this.inputStream(),
      options: {
        cwd: this.cwd,
        resume: this.resume,
        settingSources: ['user', 'project', 'local'],
        includePartialMessages: true,
        allowedTools: ['mcp__agentview__set_status'],
        mcpServers: { agentview: statusServer },
        toolConfig: { askUserQuestion: { previewFormat: 'markdown' } },
        canUseTool: (toolName, input, opts) => this.canUseTool(toolName, input, opts),
        agents: {
          [BIG_BRO]: {
            description:
              'Fable, the most capable model. Only for a really hard problem you could not resolve yourself: a bug that survived several attempts, a risky design decision, or subtle correctness reasoning. The user approves every call, so put the full question and context in the prompt. If the call is declined, continue without it.',
            prompt: 'You are Fable, consulted as a senior engineer on one hard problem. Investigate what you need, then answer with a clear recommendation and the reasoning behind it. Be concise.',
            model: 'claude-fable-5-1',
            tools: ['Read', 'Bash', 'WebSearch', 'WebFetch'],
          },
        },
        hooks: { PreToolUse: [{ matcher: 'Agent|Task', hooks: [(input, _id, { signal }) => this.confirmBigBro(input, signal)] }] },
        stderr: (d) => process.stderr.write(d),
      },
    });

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

  async setModel(model: string) {
    this.start();
    const team = model === 'team';
    if (team || this.state.session.team) await this.q?.applyFlagSettings({ advisorModel: team ? TEAM.advisor : null });
    await this.q?.setModel(team ? TEAM.model : model);
    this.setSession({ model: team ? TEAM.model : model, team });
    const text = team ? 'Team mode: Opus plans each task, Sonnet 5.5 builds it with Opus advising, Fable only with your OK' : `Model set to ${model}`;
    this.pushEvent({ id: randomUUID(), kind: 'system', text, at: Date.now() });
  }

  private async confirmBigBro(input: HookInput, signal: AbortSignal): Promise<HookJSONOutput> {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
    if (toolInput.subagent_type !== BIG_BRO) return {};
    const r = await this.canUseTool(input.tool_name, toolInput, { signal, title: `Ask Fable: ${String(toolInput.description ?? 'a hard problem')}` });
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: r.behavior === 'allow' ? 'allow' : 'deny',
        permissionDecisionReason: r.behavior === 'allow' ? undefined : 'The user declined to ask Fable. Continue without it.',
      },
    };
  }

  async setPermissionMode(mode: string) {
    this.start();
    await this.q?.setPermissionMode(mode as PermissionMode);
    this.setSession({ permissionMode: mode });
    this.pushEvent({ id: randomUUID(), kind: 'system', text: `Permission mode: ${mode}`, at: Date.now() });
  }

  private async *inputStream(): AsyncGenerator<SDKUserMessage> {
    while (!this.closed) {
      if (this.inputQueue.length === 0) {
        await new Promise<void>((r) => (this.wake = r));
        this.wake = null;
        continue;
      }
      yield this.inputQueue.shift()!;
    }
  }

  private turns = 0;

  sendPrompt(text: string) {
    this.start();
    this.pushEvent({ id: randomUUID(), kind: 'user', text, at: Date.now() });
    this.turns++;
    this.setSession({ running: true });
    this.inputQueue.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
    });
    this.wake?.();
  }

  async interrupt() {
    await this.q?.interrupt();
  }

  async prompt(text: string) {
    if (!this.state.session.running) await this.planFirst();
    this.sendPrompt(text);
  }

  async steer(text: string) {
    if (this.state.session.running) await this.q?.interrupt().catch(() => {});
    else await this.planFirst();
    this.sendPrompt(text);
  }

  private async planFirst() {
    if (this.state.session.team && this.state.session.permissionMode !== 'plan') await this.setPermissionMode('plan');
  }

  private turnEnded() {
    this.turns = Math.max(0, this.turns - 1);
    this.setSession({ running: this.turns > 0 });
  }

  private async canUseTool(
    toolName: string,
    input: Record<string, unknown>,
    opts: { suggestions?: PermissionUpdate[]; title?: string; displayName?: string; signal: AbortSignal },
  ): Promise<PermissionResult> {
    const id = randomUUID();
    const req: PendingRequest =
      toolName === 'AskUserQuestion'
        ? { id, kind: 'question', questions: (input as any).questions ?? [] }
        : {
            id,
            kind: 'permission',
            toolName,
            title: toolName === 'ExitPlanMode' ? 'Approve the plan to start building' : opts.title ?? opts.displayName ?? toolName,
            input,
            canAlwaysAllow: Boolean(opts.suggestions?.length),
          };

    this.pendingMeta.set(id, { suggestions: opts.suggestions, input });
    this.state.pending.push(req);
    this.emit({ type: 'pending', request: req });

    return new Promise<PermissionResult>((resolve) => {
      this.resolvers.set(id, resolve);
      opts.signal.addEventListener('abort', () => {
        this.finish(id);
        resolve({ behavior: 'deny', message: 'aborted' });
      });
    });
  }

  private finish(id: string) {
    this.resolvers.delete(id);
    this.pendingMeta.delete(id);
    this.state.pending = this.state.pending.filter((p) => p.id !== id);
    this.emit({ type: 'resolved', id });
  }

  answerQuestion(id: string, answers: Record<string, string>) {
    const resolve = this.resolvers.get(id);
    const meta = this.pendingMeta.get(id);
    if (!resolve || !meta) return;
    this.finish(id);
    resolve({ behavior: 'allow', updatedInput: { ...meta.input, answers } });
  }

  answerPermission(id: string, allow: boolean, always?: boolean) {
    const resolve = this.resolvers.get(id);
    const meta = this.pendingMeta.get(id);
    if (!resolve || !meta) return;
    this.finish(id);
    if (!allow) {
      resolve({ behavior: 'deny', message: 'User denied this action in the AgentView UI.' });
      return;
    }
    resolve({
      behavior: 'allow',
      updatedInput: meta.input,
      updatedPermissions: always ? meta.suggestions : undefined,
    });
  }

  private liveText = new Map<string, string>();
  private liveMsgId = '';

  private async consume() {
    if (!this.q) return;
    try {
      for await (const msg of this.q) this.handle(msg);
    } catch (err) {
      this.pushEvent({ id: randomUUID(), kind: 'system', text: `Session error: ${String(err)}`, at: Date.now() });
    } finally {
      this.turns = 0;
      this.setSession({ running: false });
    }
  }

  private handle(msg: SDKMessage) {
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          this.setSession({ sessionId: msg.session_id, model: msg.model, permissionMode: msg.permissionMode, apiKeySource: msg.apiKeySource });
          this.pushEvent({ id: randomUUID(), kind: 'system', text: `Session started with ${msg.model}`, at: Date.now() });
          if (this.state.session.commands.length === 0) void this.loadMeta();
        } else if (msg.subtype === 'status' && msg.permissionMode) {
          this.setSession({ permissionMode: msg.permissionMode });
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
          const prev = this.liveText.get(key) ?? '';
          const text = prev + ev.delta.text;
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
        if (msg.parent_tool_use_id) return;
        this.setSession({ cache: cacheFrom(msg.message.usage, Date.now(), this.state.session.cache) });
        for (const block of msg.message.content) {
          if (block.type === 'server_tool_use' && block.name === 'advisor') this.pushEvent(advisorEvent(block.id, Date.now()));
          if (block.type === 'tool_use') {
            const input = (block.input ?? {}) as Record<string, unknown>;
            this.pushEvent({
              id: block.id,
              kind: 'tool_use',
              name: block.name,
              input,
              summary: summarizeTool(block.name, input),
              at: Date.now(),
            });
            if (EDIT_TOOLS.has(block.name) && typeof input.file_path === 'string') {
              this.noteFile(path.relative(this.cwd, input.file_path), 'tool');
            }
          }
        }
        return;
      }

      case 'user': {
        if (msg.parent_tool_use_id) return;
        const content = msg.message.content;
        if (!Array.isArray(content)) return;
        for (const block of content) {
          if (block.type === 'tool_result') {
            const text = toolResultText(block);
            this.pushEvent({
              id: randomUUID(),
              kind: 'tool_result',
              toolUseId: block.tool_use_id,
              text: text.slice(0, 4000),
              isError: Boolean(block.is_error),
              at: Date.now(),
            });
          }
        }
        return;
      }

      case 'result': {
        this.liveText.clear();
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

function advisorEvent(id: string, at: number): ChatEvent {
  return { id, kind: 'tool_use', name: 'Advisor', input: {}, summary: 'Consulted the advisor', at };
}

function cacheFrom(usage: any, at: number, prev: CacheInfo | null): CacheInfo | null {
  if (!usage) return prev;
  const c = usage.cache_creation;
  const ttlMs = c?.ephemeral_1h_input_tokens > 0 ? 3_600_000 : c?.ephemeral_5m_input_tokens > 0 ? 300_000 : prev?.ttlMs ?? 300_000;
  return { at, ttlMs, readTokens: usage.cache_read_input_tokens ?? 0, writeTokens: usage.cache_creation_input_tokens ?? 0 };
}

function toolResultText(block: { content?: unknown }): string {
  if (typeof block.content === 'string') return block.content;
  return ((block.content as any[]) ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('\n');
}

function summarizeTool(name: string, input: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (name) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
      return `${name} ${s(input.file_path)}`;
    case 'Bash':
      return `$ ${s(input.command).slice(0, 120)}`;
    case 'Grep':
      return `grep ${s(input.pattern)}`;
    case 'Glob':
      return `glob ${s(input.pattern)}`;
    case 'AskUserQuestion':
      return 'Asked you a question';
    case 'Agent':
    case 'Task':
      return input.subagent_type === BIG_BRO ? `Asked Fable: ${s(input.description)}` : `Agent: ${s(input.description)}`;
    default:
      return name;
  }
}
