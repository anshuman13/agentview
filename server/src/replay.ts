import { randomUUID } from 'node:crypto';
import type { ServerMessage } from '../../shared/protocol.js';

// Numbers a chat's messages and keeps the latest ones, so a client that reconnects gets only what it missed.
export class Replay {
  readonly epoch = randomUUID();
  seq = 0;
  private buf: { seq: number; data: string }[] = [];
  private bytes = 0;

  constructor(private max = 1000, private maxBytes = 4_000_000) {}

  stamp(m: ServerMessage) {
    const data = JSON.stringify({ ...m, seq: ++this.seq });
    this.buf.push({ seq: this.seq, data });
    this.bytes += data.length;
    while (this.buf.length && (this.buf.length > this.max || this.bytes > this.maxBytes)) this.bytes -= this.buf.shift()!.data.length;
    return data;
  }

  // The messages after seq, or null when the client needs a full init.
  since(epoch: string, seq: number) {
    if (epoch !== this.epoch || !Number.isInteger(seq) || seq < 0 || seq > this.seq) return null;
    if (seq === this.seq) return [];
    if (!this.buf.length || this.buf[0].seq > seq + 1) return null;
    return this.buf.filter((b) => b.seq > seq).map((b) => b.data);
  }
}
