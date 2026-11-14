import path from 'node:path';
import type { ChatEvent } from '../../../../shared/protocol.js';
import type { AgentHost } from '../types.js';
import { finishedEvents, startedEvents } from './events.js';
import { limitUntil } from './usage.js';
import type { FileUpdateChange, ThreadItem, TokenUsage, Turn } from './protocol.js';

const FLUSH_MS = 80;

type Sink = Pick<AgentHost, 'cwd' | 'state' | 'limit' | 'pushEvent' | 'emit' | 'system' | 'setSession' | 'turnResult' | 'compacted' | 'noteFile' | 'captureEdit'>;
type Live = { ev: Extract<ChatEvent, { kind: 'assistant' }>; sent: number; timer?: ReturnType<typeof setTimeout> };

// Turns the app-server's notifications into chat events: assistant text streams in, commands, file changes and MCP calls become tool steps.
export class CodexStream {
  private live = new Map<string, Live>();
  private lastText = '';
  private context = 0;
  private compactedTurn: string | null = null;
  // The files each file change item announced, for its approval card.
  readonly files = new Map<string, FileUpdateChange[]>();

  constructor(private host: Sink) {}

  handle(method: string, params: any) {
    switch (method) {
      case 'item/started': return this.started(params.item);
      case 'item/agentMessage/delta': return this.delta(params.itemId, params.delta);
      case 'item/completed': return this.completed(params.item, params.turnId);
      case 'turn/completed': return this.turnDone(params.turn);
      case 'thread/tokenUsage/updated': return this.usage(params.tokenUsage);
      case 'thread/compacted': return this.compacted(params.turnId);
      case 'error': return params.willRetry ? undefined : this.failed(params.error);
    }
  }

  private failed(error: { message: string; codexErrorInfo?: unknown }) {
    this.host.system(`Codex: ${error.message}`, true);
    if (error.codexErrorInfo === 'usageLimitExceeded') this.host.limit(limitUntil(this.host.state.session.usage));
  }

  // The process is gone; text still streaming ends as it is.
  end() {
    for (const id of [...this.live.keys()]) this.finish(id);
    this.files.clear();
  }

  private started(item: ThreadItem) {
    if (item.type === 'fileChange') {
      this.files.set(item.id, item.changes);
      for (const c of item.changes) this.host.captureEdit(this.abs(c.path));
    }
    for (const ev of startedEvents(item, Date.now())) this.host.pushEvent(ev);
  }

  private completed(item: ThreadItem, turnId: string) {
    if (item.type === 'agentMessage') return this.message(item.id, item.text);
    if (item.type === 'contextCompaction') return this.compacted(turnId);
    for (const ev of finishedEvents(item, Date.now())) this.host.pushEvent(ev);
    if (item.type === 'fileChange') this.files.delete(item.id);
    if (item.type === 'fileChange' && item.status === 'completed') for (const c of item.changes) this.host.noteFile(path.relative(this.host.cwd, this.abs(c.path)), 'tool');
  }

  private usage(u: TokenUsage) {
    this.context = u.last.totalTokens;
    this.host.setSession({ context: this.context || null, contextWindow: u.modelContextWindow });
  }

  // The item and the thread notification both announce one compaction.
  private compacted(turnId: string) {
    if (this.compactedTurn === turnId) return;
    this.compactedTurn = turnId;
    this.host.compacted(this.context, null);
  }

  private abs(file: string) {
    return path.resolve(this.host.cwd, file);
  }

  private delta(id: string, text: string) {
    const live = this.live.get(id);
    if (!live) {
      const ev = { id, kind: 'assistant' as const, text, streaming: true, at: Date.now() };
      this.live.set(id, { ev, sent: text.length });
      return this.host.pushEvent(ev);
    }
    live.ev.text += text;
    live.timer ??= setTimeout(() => {
      live.timer = undefined;
      const offset = live.sent;
      live.sent = live.ev.text.length;
      this.host.emit({ type: 'append', id, offset, text: live.ev.text.slice(offset) });
    }, FLUSH_MS);
  }

  // The finished text replaces what streamed, in case a delta was missed.
  private message(id: string, text: string) {
    this.lastText = text;
    const live = this.live.get(id);
    if (!live) return this.host.pushEvent({ id, kind: 'assistant', text, streaming: false, at: Date.now() });
    live.ev.text = text;
    this.finish(id);
  }

  private finish(id: string) {
    const live = this.live.get(id);
    if (!live) return;
    clearTimeout(live.timer);
    this.live.delete(id);
    live.ev.streaming = false;
    this.host.emit({ type: 'event', event: live.ev });
  }

  private turnDone(turn: Turn) {
    this.end();
    const ok = turn.status === 'completed';
    const text = ok ? this.lastText : turn.error?.message ?? `Turn ended: ${turn.status}`;
    this.lastText = '';
    this.host.turnResult({ id: `${turn.id}:result`, ok, text, costUsd: 0, isError: turn.status === 'failed' });
  }
}
