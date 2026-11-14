import path from 'node:path';
import type { AgentHost } from '../types.js';
import { finishedEvents, startedEvents } from './events.js';
import { limitUntil } from './usage.js';
import { LiveText } from '../liveText.js';
import type { FileUpdateChange, ThreadItem, TokenUsage, Turn } from './protocol.js';

type Sink = Pick<AgentHost, 'cwd' | 'state' | 'limit' | 'pushEvent' | 'emit' | 'system' | 'setSession' | 'turnResult' | 'compacted' | 'noteFile' | 'captureEdit'>;

// Turns the app-server's notifications into chat events: assistant text streams in, commands, file changes and MCP calls become tool steps.
export class CodexStream {
  private text: LiveText;
  private lastText = '';
  private context = 0;
  private compactedTurn: string | null = null;
  // The files each file change item announced, for its approval card.
  readonly files = new Map<string, FileUpdateChange[]>();

  constructor(private host: Sink) {
    this.text = new LiveText(host);
  }

  handle(method: string, params: any) {
    switch (method) {
      case 'item/started': return this.started(params.item);
      case 'item/agentMessage/delta': return this.text.delta(params.itemId, params.delta);
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
    this.text.end();
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

  // The finished text replaces what streamed, in case a delta was missed.
  private message(id: string, text: string) {
    this.lastText = text;
    if (!this.text.finish(id, text)) this.host.pushEvent({ id, kind: 'assistant', text, streaming: false, at: Date.now() });
  }

  private turnDone(turn: Turn) {
    this.end();
    const ok = turn.status === 'completed';
    const text = ok ? this.lastText : turn.error?.message ?? `Turn ended: ${turn.status}`;
    this.lastText = '';
    this.host.turnResult({ id: `${turn.id}:result`, ok, text, costUsd: 0, isError: turn.status === 'failed' });
  }
}
