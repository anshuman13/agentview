import type { Ring } from './stream.js';

export const GRACE_MS = 5 * 60_000;

// Keeps appends for chats nobody has open out of the ring. A chat stays watched for a grace window after its last
// viewer leaves so a dropped stream can resume it; a skipped append leaves one null marker so a later resume gets an init.
export class RingGate {
  private left = new Map<string, number>();
  private marked = new Set<string>();

  constructor(private ring: Ring, private viewed: (chat: string) => boolean, private now = Date.now) {}

  push(data: string | null, chat: string | null) {
    const t = this.now();
    for (const [c, at] of this.left) if (t - at > GRACE_MS) this.left.delete(c);
    if (data === null || chat === null || this.viewed(chat) || this.left.has(chat)) return this.ring.push(data, chat);
    if (!this.marked.has(chat)) {
      this.marked.add(chat);
      this.ring.push(null, chat);
    }
    return undefined;
  }

  leave(chat: string) {
    this.left.set(chat, this.now());
  }

  attach(chat: string) {
    this.left.delete(chat);
    this.marked.delete(chat);
  }

  get graced() {
    return this.left.size;
  }
}
