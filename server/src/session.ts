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
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { ChatEvent, PendingRequest, ServerMessage, ServerState, SessionInfo } from '../../shared/protocol.js';

type Resolver = (r: PermissionResult) => void;

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

export class AgentSession {
  private q: Query | null = null;
  private inputQueue: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private closed = false;

  private resolvers = new Map<string, Resolver>();
  private pendingMeta = new Map<string, { suggestions?: PermissionUpdate[]; input: Record<string, unknown> }>();

  state: ServerState;
  private listeners = new Set<(m: ServerMessage) => void>();

  constructor(public cwd: string, private resume?: string) {
    this.state = {
      session: { sessionId: resume ?? null, model: null, cwd, running: false, permissionMode: null, apiKeySource: null, models: [], commands: [] },
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
        } else if (m.type === 'assistant' && b.type === 'tool_use') {
          const input = (b.input ?? {}) as Record<string, unknown>;
          this.state.events.push({ id: b.id, kind: 'tool_use', name: b.name, input, summary: summarizeTool(b.name, input), at });
        }
      }
      if (at) lastAt = at;
    }
    endTurn();
  }

  start() {
    if (this.q || this.closed) return;
    const statusServer = createSdkMcpServer({
      name: 'agentview',
      alwaysLoad: true,
      instructions:
        'Call set_status when you begin a multi-step task, whenever your plan changes, and when you finish. Keep it to one short sentence about what you are doing right now.',
      tools: [
        tool(
          'set_status',
          'Update the one-line status shown to the user about what you are doing right now.',
          { text: z.string().max(200) },
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
        models: models.map((m) => ({ value: m.value, displayName: m.displayName, description: m.description })),
        commands: commands.map((c) => ({ name: c.name, description: c.description })),
      });
    } catch (err) {
      process.stderr.write(`loadMeta failed: ${String(err)}\n`);
    }
  }

  async setModel(model: string) {
    this.start();
    await this.q?.setModel(model);
    this.setSession({ model });
    this.pushEvent({ id: randomUUID(), kind: 'system', text: `Model set to ${model}`, at: Date.now() });
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

  sendPrompt(text: string) {
    this.start();
    this.pushEvent({ id: randomUUID(), kind: 'user', text, at: Date.now() });
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
            title: opts.title ?? opts.displayName ?? toolName,
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
        } else if (msg.subtype === 'local_command_output') {
          this.pushEvent({ id: msg.uuid, kind: 'assistant', text: msg.content, streaming: false, at: Date.now() });
          this.setSession({ running: false });
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
        for (const block of msg.message.content) {
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
        this.setSession({ running: false });
        return;
      }

      default:
        return;
    }
  }
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
    default:
      return name;
  }
}
