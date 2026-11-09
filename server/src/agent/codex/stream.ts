import path from 'node:path';
import type { ChatEvent } from '../../../../shared/protocol.js';
import type { AgentHost } from '../types.js';
import { finishedEvents, startedEvents } from './events.js';
import type { FileUpdateChange, ThreadItem, TokenUsage, Turn } from './protocol.js';

const FLUSH_MS = 80;

type Sink = Pick<AgentHost, 'cwd' | 'pushEvent' | 'emit' | 'system' | 'setSession' | 'turnResult' | 'noteFile' | 'captureEdit'>;
type Live = { ev: Extract<ChatEvent, { kind: 'assistant' }>; sent: number; timer?: ReturnType<typeof setTimeout> };

// Turns the app-server's notifications into chat events: assistant text streams in, commands, file changes and MCP calls become tool steps.
export class CodexStream {
  private live = new Map<string, Live>();
  private lastText = '';
  // The files each file change item announced, for its approval card.
  readonly files = new Map<string, FileUpdateChange[]>();

  constructor(private host: Sink) {}

  handle(method: string, params: any) {
    switch (method) {
      case 'item/started': return this.started(params.item);
      case 'item/agentMessage/delta': return this.delta(params.itemId, params.delta);
      case 'item/completed': return this.completed(params.item);
      case 'turn/completed': return this.turnDone(params.turn);
      case 'thread/tokenUsage/updated': return this.host.setSession({ context: (params.tokenUsage as TokenUsage).last.totalTokens || null });
      case 'error': return params.willRetry ? undefined : this.host.system(`Codex: ${params.error.message}`, true);
    }
  }

  // The process is gone; text still streaming ends as it is.
  end() {
    for (const id of [...this.live.keys()]) this.finish(id);
  }

  private started(item: ThreadItem) {
    if (item.type === 'fileChange') {
      this.files.set(item.id, item.changes);
      for (const c of item.changes) this.host.captureEdit(this.abs(c.path));
    }
    for (const ev of startedEvents(item, Date.now())) this.host.pushEvent(ev);
  }

  private completed(item: ThreadItem) {
    if (item.type === 'agentMessage') return this.message(item.id, item.text);
    if (item.type === 'contextCompaction') return this.host.system('Context compacted');
    for (const ev of finishedEvents(item, Date.now())) this.host.pushEvent(ev);
    if (item.type === 'fileChange' && item.status === 'completed') for (const c of item.changes) this.host.noteFile(path.relative(this.host.cwd, this.abs(c.path)), 'tool');
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
