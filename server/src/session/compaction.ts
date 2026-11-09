import { compactAt } from '../../../shared/protocol.js';
import type { AgentSession } from './session.js';

const RETRY_GROWTH = 20_000;

export class Compaction {
  private armed = true;
  private failedAt: number | null = null;

  constructor(private s: AgentSession) {}

  start() {
    this.s.setSession({ compacting: true });
    this.s.setStatus('Compacting the conversation');
  }

  done(pre: number, post: number | null | undefined) {
    const s = this.s;
    s.setSession({ context: post ?? null, compacting: false });
    s.setStatus('Compacted');
    this.rearm();
    s.system(`Compacted from ${Math.round(pre / 1000)}k${post ? ` to ${Math.round(post / 1000)}k` : ''} tokens`);
    s.wakeups.rearm();
    s.waiting.dequeue();
  }

  fail(error: string) {
    this.s.setSession({ compacting: false });
    this.failedAt = this.s.state.session.context ?? 0;
    this.s.system(`Compact failed: ${error}`);
    this.s.waiting.dequeue();
  }

  private rearm() {
    this.armed = true;
    this.failedAt = null;
  }

  // True once per threshold crossing; after a failure it waits for the context to grow before it tries again.
  due(context: number, contextWindow?: number | null) {
    if (!this.armed && this.failedAt !== null && context >= this.failedAt + RETRY_GROWTH) this.rearm();
    if (!this.armed || context < compactAt(contextWindow)) return false;
    this.armed = false;
    return true;
  }
}
