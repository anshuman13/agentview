import { COMPACT_AT } from '../../../shared/protocol.js';

const RETRY_GROWTH = 20_000;

export class Compaction {
  private armed = true;
  private failedAt: number | null = null;

  rearm() {
    this.armed = true;
    this.failedAt = null;
  }

  failed(context: number) {
    this.failedAt = context;
  }

  // True once per threshold crossing; after a failure it waits for the context to grow before it tries again.
  due(context: number) {
    if (!this.armed && this.failedAt !== null && context >= this.failedAt + RETRY_GROWTH) this.rearm();
    if (!this.armed || context < COMPACT_AT) return false;
    this.armed = false;
    return true;
  }
}
