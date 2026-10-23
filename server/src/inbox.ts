import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import path from 'node:path';

export type InboxItem = { cid: string; chat: string; session: string | null; cwd: string; kind: 'prompt' | 'steer'; text: string; at: number };

export const SEEN_TTL = 48 * 3600_000;

// Client message ids seen recently, and prompts accepted but not yet handed to Claude.
// Every change is written with fsync before the client gets its ack, so a restart neither loses nor repeats a message.
export class Inbox {
  private seen = new Map<string, number>();
  private items: InboxItem[] = [];

  constructor(private file: string, private now = () => Date.now()) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      this.seen = new Map(Object.entries(saved.seen ?? {}).filter((e): e is [string, number] => typeof e[1] === 'number'));
      this.items = Array.isArray(saved.pending) ? saved.pending : [];
    } catch {}
  }

  has(cid: string) {
    return this.seen.has(cid);
  }

  // Nothing is recorded unless it reached the disk, so a retry after a failed write is not mistaken for a duplicate.
  accept(cid: string, item?: Omit<InboxItem, 'cid' | 'at'>) {
    const items = this.items;
    this.seen.set(cid, this.now());
    if (item) this.items = [...items, { ...item, cid, at: this.now() }];
    try {
      this.save();
    } catch (err) {
      this.seen.delete(cid);
      this.items = items;
      throw err;
    }
  }

  done(cid: string) {
    const n = this.items.length;
    this.items = this.items.filter((i) => i.cid !== cid);
    if (this.items.length !== n) this.save();
  }

  dropChat(chat: string) {
    const n = this.items.length;
    this.items = this.items.filter((i) => i.chat !== chat);
    if (this.items.length !== n) this.save();
  }

  pending() {
    return this.items.slice();
  }

  private save() {
    const cut = this.now() - SEEN_TTL;
    for (const [cid, at] of this.seen) if (at < cut) this.seen.delete(cid);
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    const fd = openSync(tmp, 'w', 0o600);
    try {
      writeSync(fd, JSON.stringify({ seen: Object.fromEntries(this.seen), pending: this.items }));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.file);
  }
}
